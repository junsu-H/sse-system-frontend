// src/hooks/useBroadcastChannel.js
import { useState, useEffect, useRef, useCallback } from 'react';

const useBroadcastChannel = (channelName) => {
  const [messages, setMessages] = useState([]);
  const [isSupported, setIsSupported] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const channelRef = useRef(null);

  // BroadcastChannel 지원 여부 확인 및 생성
  useEffect(() => {
    const supported = 'BroadcastChannel' in window;
    setIsSupported(supported);

    if (!supported) {
      console.warn('BroadcastChannel이 지원되지 않는 브라우저입니다.');
      return;
    }

    try {
      // BroadcastChannel 생성
      const channel = new BroadcastChannel(channelName);
      channelRef.current = channel;
      setIsConnected(true);

      // 메시지 수신 핸들러
      const handleMessage = (event) => {
        console.log(`BroadcastChannel [${channelName}] 메시지 수신:`, event.data);

        const messageWithTimestamp = {
          ...event.data,
          receivedAt: new Date().toISOString(),
          id: Date.now() + Math.random()
        };

        setMessages(prev => [...prev.slice(-99), messageWithTimestamp]); // 최대 100개 메시지 유지
      };

      const handleError = (event) => {
        console.error(`BroadcastChannel [${channelName}] 오류:`, event);
        setIsConnected(false);
      };

      channel.addEventListener('message', handleMessage);
      channel.addEventListener('messageerror', handleError);

      // cleanup
      return () => {
        channel.removeEventListener('message', handleMessage);
        channel.removeEventListener('messageerror', handleError);
        channel.close();
        setIsConnected(false);
      };
    } catch (error) {
      console.error('BroadcastChannel 생성 오류:', error);
      setIsConnected(false);
    }
  }, [channelName]);

  // 메시지 전송
  const postMessage = useCallback((data) => {
    if (!isSupported || !channelRef.current || !isConnected) {
      console.warn('BroadcastChannel을 사용할 수 없습니다.');
      return false;
    }

    try {
      const messageData = {
        ...data,
        sentAt: new Date().toISOString(),
        channelName: channelName,
        id: Date.now() + Math.random()
      };

      channelRef.current.postMessage(messageData);
      console.log(`BroadcastChannel [${channelName}] 메시지 전송:`, messageData);
      return true;
    } catch (error) {
      console.error('BroadcastChannel 메시지 전송 오류:', error);
      setIsConnected(false);
      return false;
    }
  }, [channelName, isSupported, isConnected]);

  // 메시지 초기화
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // 특정 타입의 메시지 필터링
  const getMessagesByType = useCallback((type) => {
    return messages.filter(message => message.type === type);
  }, [messages]);

  // 메시지 통계
  const getMessageStats = useCallback(() => {
    const typeStats = messages.reduce((stats, message) => {
      stats[message.type] = (stats[message.type] || 0) + 1;
      return stats;
    }, {});

    return {
      total: messages.length,
      byType: typeStats,
      oldestMessage: messages[0]?.sentAt,
      newestMessage: messages[messages.length - 1]?.sentAt
    };
  }, [messages]);

  return {
    // 상태
    messages,
    isSupported,
    isConnected,

    // 메서드
    postMessage,
    clearMessages,
    getMessagesByType,
    getMessageStats,

    // 메타데이터
    channelName
  };
};

export default useBroadcastChannel;
