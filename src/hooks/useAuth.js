import { useState, useCallback, useEffect } from 'react';

export default function useAuth(baseUrl = 'http://localhost:9292') {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const getCookie = name => {
    const m = document.cookie.match(new RegExp('(^| )'+name+'=([^;]+)'));
    return m ? m[2] : null;
  };

  const decodeJWT = token => {
    try { return JSON.parse(atob(token.split('.')[1])); } catch { return null; }
  };

  const login = useCallback(async creds => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${baseUrl}/sse/api/auth/token`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(creds)
      });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const refreshToken = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`${baseUrl}/sse/api/auth/token/refresh`, {
        method: 'POST',
        credentials: 'include'
      });
      if (!res.ok) throw new Error(res.status);
      return await res.json();
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  const logout = useCallback(() => {
    document.cookie = 'access_token=;expires=Thu,01 Jan 1970 00:00:00 UTC;path=/;';
  }, []);

  const isAuthenticated = !!getCookie('access_token');

  const getCurrentUser = () => {
    const t = getCookie('access_token');
    return t ? decodeJWT(t) : null;
  };

  const getTokenInfo = () => {
    const t = getCookie('access_token');
    if (!t) return null;
    const p = decodeJWT(t);
    if (!p || !p.exp) return null;
    return {
      expiresAt: new Date(p.exp * 1000),
      timeUntilExpiry: p.exp - Math.floor(Date.now() / 1000)
    };
  };

  return {
    login,
    refreshToken,
    logout,
    loading,
    error,
    isAuthenticated,
    getCurrentUser,
    getTokenInfo   // <— ensure this is returned
  };
}
