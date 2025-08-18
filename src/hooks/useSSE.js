import { useState, useEffect, useRef, useCallback } from 'react';

const useSSE = (url, options = {}) => {
  const [data, setData] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const [lastEventId, setLastEventId] = useState(null);
  const [connectionCount, setConnectionCount] = useState(0);

  const abortControllerRef = useRef(null);
  const readerRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectAttemptsRef = useRef(0);
  const sseConnectedOnceRef = useRef(false);
  const optionsRef = useRef(options);

  useEffect(() => { optionsRef.current = options; }, [options]);

  const { reconnect = true, reconnectInterval = 3000, maxReconnectAttempts = 5, withCredentials = true } = options;

  const getCookie = useCallback((name) => {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let c of ca) {
      c = c.trim();
      if (c.startsWith(nameEQ)) return c.substring(nameEQ.length);
    }
    return null;
  }, []);

  const connect = useCallback(async () => {
    if (!url) return;
    if (abortControllerRef.current) return; // 이미 연결 중이면 무시

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
      setConnectionCount(prev => prev + 1);

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
                const parsed = JSON.parse(eventData);
                setData(parsed);
                currentOptions.onMessage?.(parsed, { type: eventType, id: eventId });
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
      if (abortControllerRef.current?.signal.aborted) {
        setIsConnected(false);
        sseConnectedOnceRef.current = false;
        currentOptions.onClose?.();
        abortControllerRef.current = null;
      }
    }
  }, [url, lastEventId, reconnect, reconnectInterval, maxReconnectAttempts, withCredentials]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    sseConnectedOnceRef.current = false;
    setIsConnected(false);
    setError(null);
    optionsRef.current.onClose?.();
  }, []);

  const forceReconnect = useCallback(() => {
    disconnect();
    reconnectAttemptsRef.current = 0;
    setError(null);
    setTimeout(() => connect(), 3000);
  }, [disconnect, connect]);

  const isAuthenticated = useCallback(() => !!getCookie('access_token'), [getCookie]);

  useEffect(() => { return () => { disconnect(); }; }, [disconnect]);

  return {
    data,
    isConnected,
    error,
    lastEventId,
    connectionCount,
    connect,
    disconnect,
    forceReconnect,
    isAuthenticated: isAuthenticated(),
    getCookie
  };
};

export default useSSE;
