import React, { useState, useEffect, useRef } from 'react';
import useSSE from '../hooks/useSSE';
import useAuth from '../hooks/useAuth';
import useBroadcastChannel from '../hooks/useBroadcastChannel';
import './SSEGateway.css';

const SSEGateway = () => {
    const [serverUrl, setServerUrl] = useState('http://localhost:8090/subscribe');
    const [baseUrl, setBaseUrl] = useState('http://localhost:8090');
    const [broadcastInput, setBroadcastInput] = useState('');
    const [logs, setLogs] = useState([]);
    const [showLoginForm, setShowLoginForm] = useState(false);
    const [loginForm, setLoginForm] = useState({ accountId: '', sessionId: '', uuid: '' });
    const sseConnectedRef = useRef(false);

    const { login, refreshToken, logout, isAuthenticated: authIsAuthenticated, getCurrentUser, isLoading: authIsLoading, authError, getCookie, validateAuthRequest } = useAuth(baseUrl);

    const { data: sseData, isConnected, error, connectionCount, lastEventId, connect, disconnect } =
        useSSE(serverUrl, {
            reconnect: true,
            reconnectInterval: 3000,
            maxReconnectAttempts: 5,
            withCredentials: true,
            onOpen: () => addLog('SSE 연결이 열렸습니다.', 'success'),
            onMessage: (data, event) => addLog(`[SSE] [${event.type}] ${JSON.stringify(data)}`, 'info'),
            onError: (event) => addLog(`SSE 오류: ${event.message || event}`, 'error'),
            onClose: () => addLog('SSE 연결이 닫혔습니다.', 'warning'),
        });

    const { messages: broadcastMessages, postMessage: postBroadcastMessage, clearMessages: clearBroadcastMessages, isSupported: isBroadcastSupported } = useBroadcastChannel('sse-gateway-channel');

    const addLog = (message, type = 'info') => {
        const timestamp = new Date().toLocaleTimeString();
        setLogs(prev => [...prev.slice(-49), { id: Date.now() + Math.random(), message, type, timestamp }]);
    };

    // 탭 활성화 감지 및 SSE 재연결
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && authIsAuthenticated) {
                if (sseConnectedRef.current) {
                    disconnect();
                    sseConnectedRef.current = false;
                }
                alert('탭이 활성화되어 SSE 연결을 재시작합니다.');
                addLog('탭 활성화 감지. 이전 SSE 연결 종료 후 재연결 시작.', 'info');
                connect();
                sseConnectedRef.current = true;
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // 초기 탭 활성화 시 연결
        if (document.visibilityState === 'visible' && authIsAuthenticated) {
            if (sseConnectedRef.current) disconnect();
            connect();
            sseConnectedRef.current = true;
        }

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (sseConnectedRef.current) {
                disconnect();
                sseConnectedRef.current = false;
            }
        };
    }, [authIsAuthenticated, connect, disconnect]);

    // SSE 데이터를 BroadcastChannel로 전송
    useEffect(() => {
        if (sseData && isBroadcastSupported) {
            postBroadcastMessage({ type: 'SSE_DATA', data: sseData, source: 'sse-gateway', message: JSON.stringify(sseData) });
            addLog('SSE 데이터를 BroadcastChannel로 전송했습니다.', 'success');
        }
    }, [sseData, postBroadcastMessage, isBroadcastSupported]);

    const handleLogin = async (e) => {
        e.preventDefault();
        const errors = validateAuthRequest(loginForm);
        if (errors.length > 0) return errors.forEach(err => addLog(err, 'warning'));

        try {
            addLog('로그인을 시도합니다...', 'info');
            await login({ accountId: parseInt(loginForm.accountId, 10), sessionId: loginForm.sessionId, uuid: loginForm.uuid });
            addLog(`로그인 성공! 계정 ID: ${loginForm.accountId}`, 'success');
            setShowLoginForm(false);
            setLoginForm({ accountId: '', sessionId: '', uuid: '' });
        } catch (err) { addLog(`로그인 실패: ${err.message}`, 'error'); }
    };

    const handleRefreshToken = async () => {
        try { addLog('토큰을 갱신합니다...', 'info'); await refreshToken(); addLog('토큰 갱신 성공!', 'success'); }
        catch (err) { addLog(`토큰 갱신 실패: ${err.message}`, 'error'); }
    };

    const handleLogout = () => { logout(); setShowLoginForm(true); setLoginForm({ accountId: '', sessionId: '', uuid: '' }); addLog('로그아웃되었습니다.', 'info'); };

    const handleSendBroadcast = () => {
        if (!broadcastInput.trim()) return addLog('브로드캐스트할 메시지를 입력해주세요.', 'warning');
        postBroadcastMessage({ type: 'USER_BROADCAST', message: broadcastInput, source: 'manual' });
        addLog(`브로드캐스트 메시지 전송: ${broadcastInput}`, 'success');
        setBroadcastInput('');
    };

    const generateUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; const v = c === 'x' ? r : (r & 0x3 | 0x8); return v.toString(16); });
    const generateSessionId = () => 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    const handleFillTestData = () => { setLoginForm({ accountId: '12345', sessionId: generateSessionId(), uuid: generateUUID() }); addLog('테스트 데이터가 자동 입력되었습니다.', 'info'); };
    const getLogClass = (type) => type;

    return (
        <div className="sse-gateway">
            <h1>SSE Gateway with API Authentication (/sse prefix)</h1>

            <div className={`sse-section auth-status ${authIsAuthenticated ? 'authenticated' : 'unauthenticated'}`}>
                <h3>인증 상태</h3>
                <p><strong>인증 상태:</strong> {authIsAuthenticated ? '인증됨' : '인증 안됨'}</p>
                {authIsAuthenticated && <>
                    <p><strong>사용자:</strong> {getCurrentUser?.sub || getCurrentUser?.accountId || 'Unknown'}</p>
                    <p><strong>Access Token:</strong> {getCookie('access_token') ? '설정됨' : '없음'}</p>
                    <p><strong>Refresh Token:</strong> {getCookie('refresh_token') ? '설정됨' : '없음'}</p>
                </>}
                {authError && <p style={{ color: '#dc3545' }}><strong>인증 오류:</strong> {authError}</p>}

                {showLoginForm ? (
                    <form className="sse-form" onSubmit={handleLogin}>
                        <label>계정 ID (Long):</label>
                        <input type="number" placeholder="계정 ID" value={loginForm.accountId} onChange={e => setLoginForm(prev => ({ ...prev, accountId: e.target.value }))} disabled={authIsLoading} />
                        <label>세션 ID:</label>
                        <input type="text" placeholder="세션 ID" value={loginForm.sessionId} onChange={e => setLoginForm(prev => ({ ...prev, sessionId: e.target.value }))} disabled={authIsLoading} />
                        <label>UUID:</label>
                        <input type="text" placeholder="UUID" value={loginForm.uuid} onChange={e => setLoginForm(prev => ({ ...prev, uuid: e.target.value }))} disabled={authIsLoading} />
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <button type="submit" className="login" disabled={authIsLoading}>{authIsLoading ? '로그인 중...' : '로그인'}</button>
                            <button type="button" className="test" onClick={handleFillTestData} disabled={authIsLoading}>테스트 데이터 입력</button>
                            <button type="button" className="cancel" onClick={() => setShowLoginForm(false)} disabled={authIsLoading}>취소</button>
                        </div>
                    </form>
                ) : (
                    <div className="button-group">
                        <button className="btn info" onClick={() => setShowLoginForm(true)}>다시 로그인</button>
                        <button className="btn green" onClick={handleRefreshToken} disabled={authIsLoading}>토큰 갱신</button>
                        <button className="btn red" onClick={handleLogout}>로그아웃</button>
                    </div>
                )}
            </div>

            <div className={`sse-section sse-status ${isConnected ? 'connected' : 'disconnected'}`}>
                <h3>SSE 연결 상태</h3>
                <p><strong>연결 상태:</strong> {isConnected ? '연결됨' : '연결 안됨'}</p>
                <p><strong>서버 URL:</strong> {serverUrl}</p>
                <p><strong>재연결 횟수:</strong> {connectionCount}</p>
                <p><strong>Last Event ID:</strong> {lastEventId || '없음'}</p>
                <p><strong>BroadcastChannel 지원:</strong> {isBroadcastSupported ? '지원됨' : '지원 안됨'}</p>
                {error && <p style={{ color: '#dc3545' }}><strong>오류:</strong> {error}</p>}
            </div>

            <div className="sse-section server-settings">
                <h3>서버 설정</h3>
                <div className="server-inputs">
                    <div className="input-group">
                        <label>API 베이스 URL:</label>
                        <input type="text" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="API 베이스 URL" />
                    </div>
                    <div className="input-group">
                        <label>SSE 서버 URL:</label>
                        <input type="text" value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="SSE 서버 URL" />
                    </div>
                </div>
                <div className="server-buttons">
                    <button className="btn red" onClick={disconnect} disabled={!isConnected}>연결 해제</button>
                    <button className={`btn green ${!authIsAuthenticated ? 'disabled' : ''}`} onClick={connect} disabled={!authIsAuthenticated}>재연결</button>
                </div>
            </div>

            {isBroadcastSupported && (
                <div className="sse-section broadcast-send">
                    <h3>브라우저 탭 간 메시지 전송</h3>
                    <div className="broadcast-input-group">
                        <input type="text" value={broadcastInput} onChange={e => setBroadcastInput(e.target.value)} placeholder="다른 탭으로 보낼 메시지" onKeyPress={e => e.key === 'Enter' && handleSendBroadcast()} />
                        <button className="blue" onClick={handleSendBroadcast}>브로드캐스트</button>
                    </div>
                </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div className="sse-data">
                    <h3>최신 SSE 데이터</h3>
                    {sseData ? JSON.stringify(sseData, null, 2) : '데이터 없음'}
                </div>

                <div className="sse-section broadcast-messages">
                    <div className="broadcast-header">
                        <h3>BroadcastChannel 메시지 ({broadcastMessages.length})</h3>
                        <button className="btn gray" onClick={clearBroadcastMessages}>Clear</button>
                    </div>
                    <div className="broadcast-list">
                        {broadcastMessages.length === 0 ? (
                            <p>브로드캐스트 메시지 없음</p>
                        ) : (
                            broadcastMessages.slice(-10).map(message => (
                                <div key={message.id} className="broadcast-item">
                                    <strong>[{message.type}]</strong> {message.message || JSON.stringify(message.data)}
                                    <br />
                                    <small>{new Date(message.receivedAt).toLocaleTimeString()}</small>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>

            <div className="sse-section">
                <div className="sse-log">
                    {logs.map(log => (
                        <div key={log.id} className={getLogClass(log.type)}>
                            [{log.timestamp}] {log.message}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default SSEGateway;
