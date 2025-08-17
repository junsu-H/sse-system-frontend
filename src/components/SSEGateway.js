// src/components/SSEGateway.js
import React, { useState, useEffect } from 'react';
import useSSE from '../hooks/useSSE';
import useAuth from '../hooks/useAuth';
import useBroadcastChannel from '../hooks/useBroadcastChannel';

const SSEGateway = () => {
  const [serverUrl, setServerUrl] = useState('http://localhost:8090/subscribe');
  const [baseUrl, setBaseUrl] = useState('http://localhost:8090');
  const [broadcastInput, setBroadcastInput] = useState('');
  const [logs, setLogs] = useState([]);
  const [showLoginForm, setShowLoginForm] = useState(false);

  // 로그인 폼 상태 - AuthRequest 구조에 맞게 변경
  const [loginForm, setLoginForm] = useState({
    accountId: '',
    sessionId: '',
    uuid: ''
  });

  // 인증 관련 훅
  const {
    login,
    refreshToken,
    logout,
    isAuthenticated: authIsAuthenticated,
    getCurrentUser,
    isLoading: authIsLoading,
    authError,
    getCookie: getAuthCookie,
    validateAuthRequest
  } = useAuth(baseUrl);

  // SSE 연결 설정 - 게이트웨이 경로 적용
  const {
    data: sseData,
    isConnected,
    error,
    connectionCount,
    lastEventId,
    connect,
    disconnect,
    forceReconnect,
    isAuthenticated: sseIsAuthenticated
  } = useSSE(serverUrl, {
    reconnect: true,
    reconnectInterval: 3000,
    maxReconnectAttempts: 5,
    withCredentials: true,
    onOpen: () => addLog('SSE 연결이 열렸습니다.', 'success'),
    onMessage: (data, event) => {
      const eventType = event.type || 'message';
      addLog(`SSE [${eventType}] 데이터 수신: ${JSON.stringify(data)}`, 'info');
    },
    onError: (event) => {
      if (event.type === 'connection_closed') {
        addLog('SSE 연결이 서버에 의해 종료되었습니다. 인증을 확인해주세요.', 'error');
      } else {
        addLog('SSE 연결 오류가 발생했습니다.', 'error');
      }
    },
    onClose: () => addLog('SSE 연결이 닫혔습니다.', 'warning')
  });

  // BroadcastChannel 설정
  const {
    messages: broadcastMessages,
    postMessage: postBroadcastMessage,
    clearMessages: clearBroadcastMessages,
    isSupported: isBroadcastSupported
  } = useBroadcastChannel('sse-gateway-channel');

  // 로그 추가 함수
  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev.slice(-49), {
      id: Date.now() + Math.random(),
      message,
      type,
      timestamp
    }]);
  };

  // 컴포넌트 마운트 시 인증 상태 확인
  useEffect(() => {
    if (authIsAuthenticated) {
      const user = getCurrentUser;
      addLog(`기존 인증 정보를 찾았습니다. 사용자: ${user?.sub || user?.accountId || 'Unknown'}`, 'success');
      setShowLoginForm(false);
    } else {
      addLog('인증이 필요합니다. 계정 정보를 입력해주세요.', 'warning');
      setShowLoginForm(true);
    }
  }, [authIsAuthenticated, getCurrentUser]);

  // 인증 상태가 변경될 때 SSE 재연결
  useEffect(() => {
    if (authIsAuthenticated && !isConnected) {
      setTimeout(() => {
        addLog('인증 완료. SSE 연결을 시도합니다.', 'info');
        forceReconnect();
      }, 500);
    } else if (!authIsAuthenticated && isConnected) {
      addLog('인증이 해제되어 SSE 연결을 종료합니다.', 'warning');
      disconnect();
    }
  }, [authIsAuthenticated, isConnected, forceReconnect, disconnect]);

  // SSE 데이터가 변경될 때마다 BroadcastChannel로 전송
  useEffect(() => {
    if (sseData && isBroadcastSupported) {
      postBroadcastMessage({
        type: 'SSE_DATA',
        data: sseData,
        source: 'sse-gateway'
      });
      addLog('SSE 데이터를 BroadcastChannel로 전송했습니다.', 'success');
    }
  }, [sseData, postBroadcastMessage, isBroadcastSupported]);

  // 로그인 처리 - AuthRequest 구조 적용
  const handleLogin = async (e) => {
    e.preventDefault();

    // AuthRequest 유효성 검사
    const validationErrors = validateAuthRequest(loginForm);
    if (validationErrors.length > 0) {
      validationErrors.forEach(error => addLog(error, 'warning'));
      return;
    }

    try {
      addLog('로그인을 시도합니다...', 'info');
      addLog(`요청 데이터: accountId=${loginForm.accountId}, sessionId=${loginForm.sessionId}, uuid=${loginForm.uuid}`, 'info');

      const authResponse = await login({
        accountId: parseInt(loginForm.accountId, 10),
        sessionId: loginForm.sessionId,
        uuid: loginForm.uuid
      });

      addLog(`로그인 성공! 계정 ID: ${loginForm.accountId}`, 'success');
      setShowLoginForm(false);
      setLoginForm({ accountId: '', sessionId: '', uuid: '' });
    } catch (error) {
      addLog(`로그인 실패: ${error.message}`, 'error');
    }
  };

  // 토큰 갱신 처리
  const handleRefreshToken = async () => {
    try {
      addLog('토큰을 갱신합니다...', 'info');
      await refreshToken();
      addLog('토큰 갱신 성공!', 'success');
    } catch (error) {
      addLog(`토큰 갱신 실패: ${error.message}`, 'error');
    }
  };

  // 로그아웃 처리
  const handleLogout = () => {
    logout();
    setShowLoginForm(true);
    setLoginForm({ accountId: '', sessionId: '', uuid: '' });
    addLog('로그아웃되었습니다.', 'info');
  };

  // BroadcastChannel로 메시지 전송
  const handleSendBroadcast = () => {
    if (!broadcastInput.trim()) {
      addLog('브로드캐스트할 메시지를 입력해주세요.', 'warning');
      return;
    }

    const success = postBroadcastMessage({
      type: 'USER_BROADCAST',
      message: broadcastInput,
      source: 'manual'
    });

    if (success) {
      addLog(`브로드캐스트 메시지 전송: ${broadcastInput}`, 'success');
      setBroadcastInput('');
    } else {
      addLog('브로드캐스트 메시지 전송에 실패했습니다.', 'error');
    }
  };

  // UUID 생성 헬퍼 함수
  const generateUUID = () => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  };

  // 랜덤 세션 ID 생성
  const generateSessionId = () => {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  };

  // 테스트 데이터 자동 입력
  const handleFillTestData = () => {
    setLoginForm({
      accountId: '12345',
      sessionId: generateSessionId(),
      uuid: generateUUID()
    });
    addLog('테스트 데이터가 자동 입력되었습니다.', 'info');
  };

  // 로그 타입별 스타일
  const getLogStyle = (type) => {
    const baseStyle = {
      padding: '4px 8px',
      margin: '2px 0',
      borderRadius: '4px',
      fontSize: '12px',
      fontFamily: 'monospace'
    };

    switch (type) {
      case 'success':
        return { ...baseStyle, backgroundColor: '#d4edda', color: '#155724', border: '1px solid #c3e6cb' };
      case 'error':
        return { ...baseStyle, backgroundColor: '#f8d7da', color: '#721c24', border: '1px solid #f5c6cb' };
      case 'warning':
        return { ...baseStyle, backgroundColor: '#fff3cd', color: '#856404', border: '1px solid #ffeaa7' };
      default:
        return { ...baseStyle, backgroundColor: '#e2e3e5', color: '#383d41', border: '1px solid #d6d8db' };
    }
  };

  return (
    <div style={{ padding: '20px', maxWidth: '1200px', margin: '0 auto' }}>
      <h1>SSE Gateway with API Authentication (/sse prefix)</h1>

      {/* 인증 상태 */}
      <div style={{
        padding: '15px',
        marginBottom: '20px',
        borderRadius: '8px',
        backgroundColor: authIsAuthenticated ? '#d4edda' : '#fff3cd',
        border: `2px solid ${authIsAuthenticated ? '#28a745' : '#ffc107'}`
      }}>
        <h3>인증 상태</h3>
        <p><strong>인증 상태:</strong> {authIsAuthenticated ? '인증됨' : '인증 안됨'}</p>
        {authIsAuthenticated && (
          <>
            <p><strong>사용자:</strong> {getCurrentUser?.sub || getCurrentUser?.accountId || 'Unknown'}</p>
            <p><strong>Access Token:</strong> {getAuthCookie('access_token') ? '설정됨' : '없음'}</p>
            <p><strong>Refresh Token:</strong> {getAuthCookie('refresh_token') ? '설정됨' : '없음'}</p>
          </>
        )}
        {authError && <p style={{ color: '#dc3545' }}><strong>인증 오류:</strong> {authError}</p>}

        {/* 로그인 폼 - AuthRequest 구조 */}
        {showLoginForm ? (
          <form onSubmit={handleLogin} style={{ marginTop: '15px' }}>
            <div style={{ marginBottom: '10px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                계정 ID (Long):
              </label>
              <input
                type="number"
                placeholder="계정 ID (예: 12345)"
                value={loginForm.accountId}
                onChange={(e) => setLoginForm(prev => ({ ...prev, accountId: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  marginBottom: '10px'
                }}
                disabled={authIsLoading}
              />

              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                세션 ID:
              </label>
              <input
                type="text"
                placeholder="세션 ID"
                value={loginForm.sessionId}
                onChange={(e) => setLoginForm(prev => ({ ...prev, sessionId: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  marginBottom: '10px'
                }}
                disabled={authIsLoading}
              />

              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                UUID:
              </label>
              <input
                type="text"
                placeholder="UUID"
                value={loginForm.uuid}
                onChange={(e) => setLoginForm(prev => ({ ...prev, uuid: e.target.value }))}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ccc',
                  borderRadius: '4px',
                  marginBottom: '15px'
                }}
                disabled={authIsLoading}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button
                type="submit"
                disabled={authIsLoading}
                style={{
                  padding: '8px 16px',
                  backgroundColor: authIsLoading ? '#6c757d' : '#007bff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: authIsLoading ? 'not-allowed' : 'pointer'
                }}
              >
                {authIsLoading ? '로그인 중...' : '로그인'}
              </button>

              <button
                type="button"
                onClick={handleFillTestData}
                disabled={authIsLoading}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                테스트 데이터 입력
              </button>

              <button
                type="button"
                onClick={() => setShowLoginForm(false)}
                disabled={authIsLoading}
                style={{
                  padding: '8px 16px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                취소
              </button>
            </div>
          </form>
        ) : authIsAuthenticated && (
          <div style={{ marginTop: '15px', display: 'flex', gap: '10px' }}>
            <button
              onClick={() => setShowLoginForm(true)}
              style={{
                padding: '8px 16px',
                backgroundColor: '#17a2b8',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              다시 로그인
            </button>
            <button
              onClick={handleRefreshToken}
              disabled={authIsLoading}
              style={{
                padding: '8px 16px',
                backgroundColor: authIsLoading ? '#6c757d' : '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: authIsLoading ? 'not-allowed' : 'pointer'
              }}
            >
              토큰 갱신
            </button>
            <button
              onClick={handleLogout}
              style={{
                padding: '8px 16px',
                backgroundColor: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              로그아웃
            </button>
          </div>
        )}
      </div>

      {/* SSE 연결 상태 */}
      <div style={{
        padding: '15px',
        marginBottom: '20px',
        borderRadius: '8px',
        backgroundColor: isConnected ? '#d4edda' : '#f8d7da',
        border: `2px solid ${isConnected ? '#28a745' : '#dc3545'}`
      }}>
        <h3>SSE 연결 상태</h3>
        <p><strong>연결 상태:</strong> {isConnected ? '연결됨' : '연결 안됨'}</p>
        <p><strong>서버 URL:</strong> {serverUrl}</p>
        <p><strong>게이트웨이 기본 URL:</strong> {baseUrl}</p>
        <p><strong>재연결 횟수:</strong> {connectionCount}</p>
        <p><strong>Last Event ID:</strong> {lastEventId || '없음'}</p>
        <p><strong>BroadcastChannel 지원:</strong> {isBroadcastSupported ? '지원됨' : '지원 안됨'}</p>
        {error && <p style={{ color: '#dc3545' }}><strong>오류:</strong> {error}</p>}
      </div>

      {/* 서버 설정 */}
      <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <h3>서버 설정</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              API 베이스 URL:
            </label>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="API 베이스 URL (예: http://localhost:8080)"
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '4px'
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              SSE 서버 URL:
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="SSE 서버 URL (예: http://localhost:8080/sse/subscribe)"
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '4px'
              }}
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={disconnect}
            disabled={!isConnected}
            style={{
              padding: '8px 16px',
              backgroundColor: '#dc3545',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: isConnected ? 'pointer' : 'not-allowed'
            }}
          >
            연결 해제
          </button>
          <button
            onClick={forceReconnect}
            disabled={!authIsAuthenticated}
            style={{
              padding: '8px 16px',
              backgroundColor: authIsAuthenticated ? '#28a745' : '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: authIsAuthenticated ? 'pointer' : 'not-allowed'
            }}
          >
            재연결
          </button>
        </div>
      </div>

      {/* BroadcastChannel 메시지 전송 */}
      {isBroadcastSupported && (
        <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>브라우저 탭 간 메시지 전송</h3>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              value={broadcastInput}
              onChange={(e) => setBroadcastInput(e.target.value)}
              placeholder="다른 탭으로 보낼 메시지"
              onKeyPress={(e) => e.key === 'Enter' && handleSendBroadcast()}
              style={{
                flex: 1,
                padding: '8px',
                border: '1px solid #ccc',
                borderRadius: '4px'
              }}
            />
            <button
              onClick={handleSendBroadcast}
              style={{
                padding: '8px 16px',
                backgroundColor: '#17a2b8',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              브로드캐스트
            </button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
        {/* SSE 데이터 표시 */}
        <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <h3>최신 SSE 데이터</h3>
          <div style={{
            backgroundColor: '#f8f9fa',
            padding: '10px',
            borderRadius: '4px',
            minHeight: '100px',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            {sseData ? JSON.stringify(sseData, null, 2) : '데이터 없음'}
          </div>
        </div>

        {/* BroadcastChannel 메시지 표시 */}
        <div style={{ padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <h3>BroadcastChannel 메시지 ({broadcastMessages.length})</h3>
            <button
              onClick={clearBroadcastMessages}
              style={{
                padding: '4px 8px',
                backgroundColor: '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          </div>
          <div style={{
            backgroundColor: '#f8f9fa',
            padding: '10px',
            borderRadius: '4px',
            maxHeight: '300px',
            overflowY: 'auto'
          }}>
            {broadcastMessages.length === 0 ? (
              <p>브로드캐스트 메시지 없음</p>
            ) : (
              broadcastMessages.slice(-10).map(message => (
                <div key={message.id} style={{
                  marginBottom: '8px',
                  padding: '8px',
                  backgroundColor: 'white',
                  borderRadius: '4px',
                  border: '1px solid #dee2e6',
                  fontSize: '12px'
                }}>
                  <strong>[{message.type}]</strong> {message.message || JSON.stringify(message.data)}
                  <br />
                  <small style={{ color: '#6c757d' }}>
                    {new Date(message.receivedAt).toLocaleTimeString()}
                  </small>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 로그 */}
      <div style={{ marginTop: '20px', padding: '15px', border: '1px solid #ddd', borderRadius: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h3>로그 ({logs.length})</h3>
          <button
            onClick={() => setLogs([])}
            style={{
              padding: '4px 8px',
              backgroundColor: '#6c757d',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
          >
            Clear Logs
          </button>
        </div>
        <div style={{
          maxHeight: '300px',
          overflowY: 'auto',
          backgroundColor: '#f8f9fa',
          padding: '10px',
          borderRadius: '4px'
        }}>
          {logs.length === 0 ? (
            <p>로그 없음</p>
          ) : (
            logs.map(log => (
              <div key={log.id} style={getLogStyle(log.type)}>
                <span style={{ marginRight: '10px', color: '#6c757d' }}>
                  [{log.timestamp}]
                </span>
                {log.message}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default SSEGateway;
