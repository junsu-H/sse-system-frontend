import { useState, useEffect, useRef, useCallback } from 'react';
import { SSE_CONFIG, CONNECTION_STATES, EVENT_TYPES } from '../utils/constants';

const useSSE = (url, options = {}) => {
  // 상태 관리
  const [data, setData] = useState(null);
  const [connectionState, setConnectionState] = useState(CONNECTION_STATES.DISCONNECTED);
  const [error, setError] = useState(null);
  const [lastEventId, setLastEventId] = useState(null);
  const [connectionCount, setConnectionCount] = useState(0);
  const [replayProgress, setReplayProgress] = useState({
    current: 0,
    total: 0,
    isReplaying: false,
    startTime: null,
    estimatedTimeRemaining: null
  });
  const [networkStatus, setNetworkStatus] = useState({
    isOnline: navigator.onLine,
    lastOnlineTime: Date.now(),
    downtime: 0
  });

  // Refs
  const abortControllerRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const eventBufferRef = useRef([]);
  const lastHeartbeatRef = useRef(Date.now());
  const connectionStartTimeRef = useRef(null);
  const optionsRef = useRef(options);
  const metricsRef = useRef({
    totalEvents: 0,
    totalReconnects: 0,
    totalErrors: 0,
    averageEventSize: 0,
    connectionUptime: 0
  });

  // connect 함수를 참조로 저장
  const connectRef = useRef(null);

  // 옵션 업데이트
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  // 기본 설정
  const {
    reconnect = true,
    reconnectInterval = SSE_CONFIG.DEFAULT_RECONNECT_INTERVAL,
    maxReconnectAttempts = SSE_CONFIG.MAX_RECONNECT_ATTEMPTS,
    withCredentials = true,
    enablePaging = true,
    pageSize = SSE_CONFIG.DEFAULT_PAGE_SIZE,
    maxReplayEvents = SSE_CONFIG.MAX_REPLAY_EVENTS,
    maxBufferSize = SSE_CONFIG.MAX_BUFFER_SIZE,
    enableHeartbeat = true,
    heartbeatInterval = 30000,
    enableMetrics = true
  } = options;

  // 재연결 지연 시간 계산
  const getReconnectDelay = useCallback((attempt, errorType) => {
    const config = SSE_CONFIG.RECONNECT_DELAYS[errorType] || SSE_CONFIG.RECONNECT_DELAYS.default;
    const delay = Math.min(
        config.base * Math.pow(config.multiplier, attempt - 1),
        config.max
    );

    // 네트워크 상태에 따른 추가 지연
    if (!networkStatus.isOnline) {
      return delay * 2;
    }

    return delay + (Math.random() * 1000); // 지터 추가
  }, [networkStatus.isOnline]);

  // 오류 타입 분류
  const categorizeError = useCallback((error, response) => {
    if (!networkStatus.isOnline) return 'network';
    if (response?.status === 401 || response?.status === 403) return 'auth_error';
    if (response?.status >= 500) return 'server_error';
    if (error?.name === 'NetworkError' || error?.name === 'TypeError') return 'network';
    if (error?.name === 'TimeoutError') return 'network';
    return 'default';
  }, [networkStatus.isOnline]);

  // 메트릭스 업데이트
  const updateMetrics = useCallback((eventType, data) => {
    if (!enableMetrics) return;

    const metrics = metricsRef.current;
    const now = Date.now();

    switch (eventType) {
      case 'event':
        metrics.totalEvents += 1;
        if (data) {
          const eventSize = JSON.stringify(data).length;
          metrics.averageEventSize = (metrics.averageEventSize + eventSize) / 2;
        }
        break;
      case 'reconnect':
        metrics.totalReconnects += 1;
        break;
      case 'error':
        metrics.totalErrors += 1;
        break;
      case 'connection':
        if (connectionStartTimeRef.current) {
          metrics.connectionUptime = now - connectionStartTimeRef.current;
        }
        break;
    }
  }, [enableMetrics]);

  // 이벤트 데이터 처리
  const processEventData = useCallback((eventData, eventType, eventId) => {
    try {
      const parsed = JSON.parse(eventData);

      // 특수 이벤트 처리
      switch (parsed.type || eventType) {
        case EVENT_TYPES.REPLAY_START:
          const startTime = Date.now();
          setReplayProgress({
            current: 0,
            total: parsed.totalEvents || 0,
            isReplaying: true,
            startTime,
            estimatedTimeRemaining: null
          });
          optionsRef.current.onReplayStart?.(parsed);
          return;

        case EVENT_TYPES.REPLAY_END:
          setReplayProgress({
            current: 0,
            total: 0,
            isReplaying: false,
            startTime: null,
            estimatedTimeRemaining: null
          });
          optionsRef.current.onReplayEnd?.(parsed);
          return;

        case EVENT_TYPES.REPLAY_PROGRESS:
          setReplayProgress(prev => {
            const current = parsed.processedEvents || prev.current + 1;
            const elapsed = Date.now() - prev.startTime;
            const rate = current / (elapsed / 1000);
            const remaining = prev.total - current;
            const estimatedTimeRemaining = remaining / rate * 1000;

            return {
              ...prev,
              current,
              estimatedTimeRemaining: estimatedTimeRemaining > 0 ? estimatedTimeRemaining : null
            };
          });
          return;

        case EVENT_TYPES.HEARTBEAT:
          lastHeartbeatRef.current = Date.now();
          optionsRef.current.onHeartbeat?.(parsed);
          return;

        case EVENT_TYPES.ERROR:
          setError(parsed.message || 'Server error');
          optionsRef.current.onServerError?.(parsed);
          return;
      }

      // 일반 이벤트 처리
      setData(parsed);
      updateMetrics('event', parsed);

      // 이벤트 버퍼 관리
      const eventWithMetadata = {
        data: parsed,
        id: eventId,
        timestamp: Date.now(),
        type: eventType,
        size: JSON.stringify(parsed).length
      };

      eventBufferRef.current.push(eventWithMetadata);

      // 버퍼 크기 관리
      if (eventBufferRef.current.length > maxBufferSize) {
        eventBufferRef.current = eventBufferRef.current.slice(-Math.floor(maxBufferSize * 0.8));
      }

      optionsRef.current.onMessage?.(parsed, { type: eventType, id: eventId });
    } catch (parseError) {
      // JSON 파싱 실패 시 원본 데이터 처리
      setData(eventData);
      optionsRef.current.onMessage?.(eventData, { type: eventType, id: eventId });
      optionsRef.current.onParseError?.(parseError, eventData);
    }
  }, [maxBufferSize, updateMetrics]);

  // SSE 연결 함수 (connectOptions 매개변수 추가)
  const connect = useCallback(async (connectOptions = {}) => {
    if (!url) {
      setError('URL이 제공되지 않았습니다');
      return;
    }

    if (abortControllerRef.current) {
      optionsRef.current.onDuplicateConnection?.();
      return;
    }

    // 네트워크 상태 확인
    if (!networkStatus.isOnline) {
      setError('네트워크 연결을 확인해주세요');
      optionsRef.current.onNetworkUnavailable?.();
      return;
    }

    setConnectionState(CONNECTION_STATES.CONNECTING);
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const currentOptions = optionsRef.current;

    try {
      const headers = {
        'Accept': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Enable-Paging': enablePaging ? 'true' : 'false',
        'X-Page-Size': pageSize.toString(),
        'X-Max-Replay-Events': maxReplayEvents.toString(),
        'X-Enable-Heartbeat': enableHeartbeat ? 'true' : 'false',
        'X-Heartbeat-Interval': heartbeatInterval.toString()
      };

      // optionsRef의 lastEventId가 있으면 기본 헤더에 포함
      if (lastEventId) {
        headers['Last-Event-ID'] = lastEventId;
        currentOptions.onResumeFromLastEvent?.(lastEventId);
      }

      // connect() 호출 시 전달받은 headers 병합 (우선순위 높음)
      if (connectOptions.headers) {
        Object.assign(headers, connectOptions.headers);
      }

      setError(null);
      connectionStartTimeRef.current = Date.now();
      setConnectionCount(prev => prev + 1);

      const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: withCredentials ? 'include' : 'same-origin',
        signal,
      });

      if (!response.ok) {
        const errorType = categorizeError(null, response);
        const errorMessage = `서버 오류: ${response.status} ${response.statusText}`;
        throw Object.assign(new Error(errorMessage), {
          cause: errorType,
          status: response.status,
          statusText: response.statusText
        });
      }

      setConnectionState(CONNECTION_STATES.CONNECTED);
      reconnectAttemptsRef.current = 0;
      lastHeartbeatRef.current = Date.now();
      updateMetrics('connection');
      currentOptions.onOpen?.({
        connectionCount: connectionCount + 1,
        resumedFromEventId: lastEventId
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        let eventData = '';
        let eventType = 'message';
        let eventId = null;

        for (const line of lines) {
          const trimmed = line.trim();

          if (trimmed === '') {
            if (eventData) {
              if (eventId) setLastEventId(eventId);
              processEventData(eventData, eventType, eventId);
            }
            eventData = '';
            eventType = 'message';
            eventId = null;
          } else if (trimmed.startsWith('data: ')) {
            eventData += (eventData ? '\n' : '') + trimmed.slice(6);
          } else if (trimmed.startsWith('event: ')) {
            eventType = trimmed.slice(7);
          } else if (trimmed.startsWith('id: ')) {
            eventId = trimmed.slice(4);
          } else if (trimmed.startsWith('retry: ')) {
            const retryMs = parseInt(trimmed.slice(7), 10);
            if (!isNaN(retryMs) && retryMs > 0) {
              currentOptions.onRetryIntervalUpdate?.(retryMs);
            }
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;

      const errorType = err.cause || categorizeError(err);
      setConnectionState(CONNECTION_STATES.DISCONNECTED);
      setError(`연결 오류 (${errorType}): ${err.message}`);
      updateMetrics('error');
      currentOptions.onError?.(err, errorType, {
        attempt: reconnectAttemptsRef.current + 1,
        maxAttempts: maxReconnectAttempts
      });

      // 재연결 로직
      if (reconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1;
        const delay = getReconnectDelay(reconnectAttemptsRef.current, errorType);

        setConnectionState(CONNECTION_STATES.RECONNECTING);
        updateMetrics('reconnect');
        currentOptions.onReconnectAttempt?.(reconnectAttemptsRef.current, delay, errorType);

        reconnectTimeoutRef.current = setTimeout(() => {
          if (connectRef.current) {
            connectRef.current();
          }
        }, delay);
      } else {
        setConnectionState(CONNECTION_STATES.FAILED);
        currentOptions.onReconnectFailed?.(reconnectAttemptsRef.current, errorType);
      }
    } finally {
      if (abortControllerRef.current?.signal.aborted) {
        setConnectionState(CONNECTION_STATES.DISCONNECTED);
        currentOptions.onClose?.({
          reason: 'aborted',
          uptime: connectionStartTimeRef.current ? Date.now() - connectionStartTimeRef.current : 0
        });
        abortControllerRef.current = null;
      }
    }
  }, [
    url, lastEventId, networkStatus.isOnline, enablePaging, pageSize,
    maxReplayEvents, enableHeartbeat, heartbeatInterval, withCredentials,
    connectionCount, reconnect, maxReconnectAttempts, getReconnectDelay,
    categorizeError, processEventData, updateMetrics
  ]);

  // connect 함수를 ref에 저장
  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  // 네트워크 상태 모니터링
  useEffect(() => {
    const handleOnline = () => {
      const now = Date.now();
      const downtime = now - networkStatus.lastOnlineTime;
      setNetworkStatus(prev => ({
        isOnline: true,
        lastOnlineTime: now,
        downtime: prev.isOnline ? 0 : downtime
      }));

      if (connectionState !== CONNECTION_STATES.CONNECTED && reconnect) {
        optionsRef.current.onNetworkRestore?.(downtime);
        setTimeout(() => {
          if (connectRef.current) {
            connectRef.current();
          }
        }, 1000);
      }
    };

    const handleOffline = () => {
      setNetworkStatus(prev => ({
        ...prev,
        isOnline: false
      }));
      setError('네트워크 연결이 끊어졌습니다');
      optionsRef.current.onNetworkLost?.();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [connectionState, reconnect, networkStatus.lastOnlineTime]);

  // 하트비트 체크
  useEffect(() => {
    if (!enableHeartbeat || connectionState !== CONNECTION_STATES.CONNECTED) return;

    const heartbeatCheck = setInterval(() => {
      const timeSinceLastHeartbeat = Date.now() - lastHeartbeatRef.current;
      if (timeSinceLastHeartbeat > heartbeatInterval * 2) {
        optionsRef.current.onHeartbeatMissed?.(timeSinceLastHeartbeat);
        if (reconnect && connectRef.current) {
          setError('하트비트 타임아웃');
          // forceReconnect 대신 직접 재연결
          disconnect();
          setTimeout(() => {
            if (connectRef.current) {
              connectRef.current();
            }
          }, 3000);
        }
      }
    }, heartbeatInterval);

    return () => clearInterval(heartbeatCheck);
  }, [enableHeartbeat, connectionState, heartbeatInterval, reconnect]);

  // 연결 종료
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current = null;
    }

    setConnectionState(CONNECTION_STATES.DISCONNECTED);
    setError(null);
    setReplayProgress({
      current: 0,
      total: 0,
      isReplaying: false,
      startTime: null,
      estimatedTimeRemaining: null
    });

    optionsRef.current.onClose?.({
      reason: 'manual',
      uptime: connectionStartTimeRef.current ? Date.now() - connectionStartTimeRef.current : 0
    });
  }, []);

  // 강제 재연결
  const forceReconnect = useCallback(() => {
    disconnect();
    reconnectAttemptsRef.current = 0;
    setError(null);
    setTimeout(() => {
      if (connectRef.current) {
        connectRef.current();
      }
    }, 1000);
  }, [disconnect]);

  // 이벤트 버퍼 조회
  const getEventBuffer = useCallback(() => {
    return [...eventBufferRef.current];
  }, []);

  // 메트릭스 조회
  const getMetrics = useCallback(() => {
    const metrics = { ...metricsRef.current };
    if (connectionStartTimeRef.current && connectionState === CONNECTION_STATES.CONNECTED) {
      metrics.connectionUptime = Date.now() - connectionStartTimeRef.current;
    }
    return metrics;
  }, [connectionState]);

  // 연결 상태 체크
  const isConnected = connectionState === CONNECTION_STATES.CONNECTED;
  const isConnecting = connectionState === CONNECTION_STATES.CONNECTING;
  const isReconnecting = connectionState === CONNECTION_STATES.RECONNECTING;

  // 정리
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    // 상태
    data,
    connectionState,
    isConnected,
    isConnecting,
    isReconnecting,
    error,
    lastEventId,
    connectionCount,
    replayProgress,
    networkStatus,

    // 메서드
    connect,
    disconnect,
    forceReconnect,
    getEventBuffer,
    getMetrics,

    // 유틸리티
    isAuthenticated: !!document.cookie.split(';').some(c => c.trim().startsWith('access_token=')),
    getCookie: (name) => {
      const nameEQ = name + "=";
      const ca = document.cookie.split(';');
      for (let c of ca) {
        c = c.trim();
        if (c.startsWith(nameEQ)) return c.substring(nameEQ.length);
      }
      return null;
    }
  };
};

export default useSSE;
