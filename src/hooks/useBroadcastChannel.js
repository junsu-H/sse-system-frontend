// src/hooks/useBroadcastChannel.js
import { useState, useEffect, useRef, useCallback } from 'react';

const useBroadcastChannel = (channelName) => {
  const [messages, setMessages] = useState([]);
  const [isSupported, setIsSupported] = useState(false);
  const channelRef = useRef(null);

  // BroadcastChannel 지원 여부 확인
  useEffect(() => {
    const supported = 'BroadcastChannel' in window;
    setIsSupported(supported);
    
    if (!supported) {
      console.warn('BroadcastChannel이 지원되지 않는 브라우저입니다.');
      return;
    }

    // BroadcastChannel 생성
    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;

    // 메시지 수신 핸들러
    const handleMessage = (event) => {
      console.log(`BroadcastChannel [${channelName}] 메시지 수신:`, event.data);
      
      const messageWithTimestamp = {
        ...event.data,
        receivedAt: new Date().toISOString(),
        id: Date.now() + Math.random()
      };

      setMessages(prev => [...prev, messageWithTimestamp]);
    };

    channel.addEventListener('message', handleMessage);

    // cleanup
    return () => {
      channel.removeEventListener('message', handleMessage);
      channel.close();
    };
  }, [channelName]);

  // 메시지 전송 함수
  const postMessage = useCallback((data) => {
    if (!isSupported || !channelRef.current) {
      console.warn('BroadcastChannel을 사용할 수 없습니다.');
      return false;
    }

    try {
      const messageData = {
        ...data,
        sentAt: new Date().toISOString(),
        channelName: channelName
      };

      channelRef.current.postMessage(messageData);
      console.log(`BroadcastChannel [${channelName}] 메시지 전송:`, messageData);
      return true;
    } catch (error) {
      console.error('BroadcastChannel 메시지 전송 오류:', error);
      return false;
    }
  }, [channelName, isSupported]);

  // 메시지 초기화 함수
  const clearMessages = useCallback(() => {
    setMessages([]);
  }, []);

  // 특정 타입의 메시지만 필터링하는 함수
  const getMessagesByType = useCallback((type) => {
    return messages.filter(message => message.type === type);
  }, [messages]);

  return {
    messages,
    postMessage,
    clearMessages,
    getMessagesByType,
    isSupported,
    channelName
  };
};

export default useBroadcastChannel;
