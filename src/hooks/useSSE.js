// src/hooks/useSSE.js
import { useState, useEffect, useRef, useCallback } from 'react';

const useSSE = (url, options = {}) => {
  const [data, setData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [lastEventId, setLastEventId] = useState(null);

  const abortControllerRef = useRef(null);
  const readerRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const optionsRef = useRef(options);

  // options 업데이트
  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  const { reconnect = true, reconnectInterval = 3000, maxReconnectAttempts = 5, withCredentials = true } =
      options;

  // 쿠키 읽기
  const getCookie = useCallback((name) => {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let c of ca) {
      c = c.trim();
      if (c.startsWith(nameEQ)) return c.substring(nameEQ.length);
    }
    return null;
  }, []);

  // SSE 연결
  const connect = useCallback(async () => {
    if (!url) return;
    if (abortControllerRef.current) return; // 이미 연결 중이면 중복 방지

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;
    const currentOptions = optionsRef.current;

    try {
      const headers = {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };
      if (lastEventId) headers['Last-Event-ID'] = lastEventId;

      setError(null);

      const response = await fetch(url, {
        method: 'GET',
        headers,
        credentials: withCredentials ? 'include' : 'same-origin',
        signal,
      });

      if (!response.ok) throw new Error(`서버 오류: ${response.status}`);

      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
      currentOptions.onOpen?.();

      const reader = response.body.getReader();
      readerRef.current = reader;
      const decoder = new TextDecoder();
      let buffer = '';

      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        let eventData = '';
        let eventType = 'message';
        let eventId = null;

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed === '') {
            if (eventData) {
              if (eventId) setLastEventId(eventId);
              try {
                setData(JSON.parse(eventData));
                currentOptions.onMessage?.(JSON.parse(eventData), { type: eventType, id: eventId });
              } catch {
                setData(eventData);
                currentOptions.onMessage?.(eventData, { type: eventType, id: eventId });
              }
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
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') return;

      setIsConnected(false);
      setError(err.message);
      currentOptions.onError?.(err);

      if (reconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectAttemptsRef.current += 1;
        reconnectTimeoutRef.current = setTimeout(() => connect(), reconnectInterval);
      }
    } finally {
      setIsConnected(false);
      abortControllerRef.current = null;
    }
  }, [url, lastEventId, reconnect, reconnectInterval, maxReconnectAttempts, withCredentials]);

  // 연결 해제
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsConnected(false);
    setError(null);
    optionsRef.current.onClose?.();
  }, []);

  // 강제 재연결
  const forceReconnect = useCallback(() => {
    disconnect();
    reconnectAttemptsRef.current = 0;
    setError(null);
    setTimeout(() => connect(), 1000);
  }, [disconnect, connect]);

  // 현재 탭에서만 연결 유지
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        connect();
      } else {
        disconnect();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    connect();

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      disconnect();
    };
  }, [connect, disconnect]);

  // 인증 여부
  const isAuthenticated = useCallback(() => {
    const token = getCookie('access_token');
    return !!token;
  }, [getCookie]);

  return { data, isConnected, error, lastEventId, connect, disconnect, forceReconnect, isAuthenticated: isAuthenticated(), getCookie };
};

export default useSSE;
