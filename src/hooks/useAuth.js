// src/hooks/useAuth.js
import { useState, useCallback } from 'react';

const useAuth = (baseUrl = 'http://localhost:8090') => {
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [authData, setAuthData] = useState(null);

  // 쿠키 읽기 함수
  const getCookie = useCallback((name) => {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  }, []);

  // 로그인 API 호출 - 게이트웨이 경로와 새로운 AuthRequest 구조 적용
  const login = useCallback(async (credentials) => {
    setIsLoading(true);
    setAuthError(null);

    try {
      // 게이트웨이 경로: /sse/api/auth
      const response = await fetch(`${baseUrl}/api/auth`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // 쿠키 포함
        body: JSON.stringify({
          accountId: credentials.accountId,
          sessionId: credentials.sessionId,
          uuid: credentials.uuid
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`로그인 실패: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const authResponse = await response.json();
      setAuthData(authResponse);
      
      console.log('로그인 성공:', authResponse);
      console.log('설정된 쿠키 확인 - access_token:', getCookie('access_token'));
      console.log('설정된 쿠키 확인 - refresh_token:', getCookie('refresh_token'));
      
      return authResponse;
    } catch (error) {
      console.error('로그인 오류:', error);
      setAuthError(error.message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl, getCookie]);

  // 토큰 갱신 API 호출 - 게이트웨이 경로 적용
  const refreshToken = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);

    try {
      // 게이트웨이 경로: /sse/api/auth/refresh
      const response = await fetch(`${baseUrl}/sse/api/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include' // 쿠키 포함
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`토큰 갱신 실패: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const authResponse = await response.json();
      setAuthData(authResponse);
      
      console.log('토큰 갱신 성공:', authResponse);
      console.log('갱신된 쿠키 확인 - access_token:', getCookie('access_token'));
      console.log('갱신된 쿠키 확인 - refresh_token:', getCookie('refresh_token'));
      
      return authResponse;
    } catch (error) {
      console.error('토큰 갱신 오류:', error);
      setAuthError(error.message);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [baseUrl, getCookie]);

  // 로그아웃 (쿠키 제거)
  const logout = useCallback(() => {
    // 쿠키 제거 - path와 SameSite 설정 포함
    document.cookie = 'access_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict;';
    document.cookie = 'refresh_token=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; SameSite=Strict;';
    
    setAuthData(null);
    setAuthError(null);
    console.log('로그아웃 완료');
  }, []);

  // 현재 인증 상태 확인
  const isAuthenticated = useCallback(() => {
    const token = getCookie('access_token');
    return token !== null && token !== '';
  }, [getCookie]);

  // 사용자 정보 확인 (JWT 토큰에서 추출)
  const getCurrentUser = useCallback(() => {
    const token = getCookie('access_token');
    if (!token) return null;

    try {
      // JWT 토큰의 payload 부분 디코딩
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload;
    } catch (error) {
      console.error('토큰 디코딩 오류:', error);
      return null;
    }
  }, [getCookie]);

  // AuthRequest 유효성 검사
  const validateAuthRequest = useCallback((credentials) => {
    const errors = [];
    
    if (!credentials.accountId || credentials.accountId <= 0) {
      errors.push('유효한 계정 ID를 입력해주세요.');
    }
    
    if (!credentials.sessionId || credentials.sessionId.trim() === '') {
      errors.push('세션 ID를 입력해주세요.');
    }
    
    if (!credentials.uuid || credentials.uuid.trim() === '') {
      errors.push('UUID를 입력해주세요.');
    }
    
    return errors;
  }, []);

  return {
    login,
    refreshToken,
    logout,
    isAuthenticated: isAuthenticated(),
    getCurrentUser: getCurrentUser(),
    isLoading,
    authError,
    authData,
    getCookie,
    validateAuthRequest
  };
};

export default useAuth;
