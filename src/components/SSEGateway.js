// src/components/SSEGateway.js
import React, { useState, useEffect, useRef } from 'react';
import useSSE from '../hooks/useSSE';
import useAuth from '../hooks/useAuth';
import useBroadcastChannel from '../hooks/useBroadcastChannel';
import { CONNECTION_STATES, LOG_TYPES } from '../utils/constants';
import './SSEGateway.css';

const SSEGateway = () => {
    // 기본 상태
    const [serverUrl, setServerUrl] = useState('http://localhost:8090/subscribe');
    const [baseUrl, setBaseUrl] = useState('http://localhost:8090');
    const [broadcastInput, setBroadcastInput] = useState('');
    const [logs, setLogs] = useState([]);
    const [showLoginForm, setShowLoginForm] = useState(false);
    const [loginForm, setLoginForm] = useState({ accountId: '', sessionId: '', uuid: '' });
    const [lastEventIdInput, setLastEventIdInput] = useState('');

    const handleConnectClick = () => {
        connect({
            headers: {
                'Last-Event-ID': lastEventIdInput
            }
        });
    };

    // SSE 설정
    const [sseSettings, setSseSettings] = useState({
        enablePaging: true,
        pageSize: 100,
        maxReplayEvents: 10000,
        maxBufferSize: 1000,
        enableHeartbeat: true,
        heartbeatInterval: 30000,
        enableMetrics: true,
        maxReconnectAttempts: 10
    });

    // UI 상태
    const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
    const [showMetrics, setShowMetrics] = useState(false);
    const [showEventBuffer, setShowEventBuffer] = useState(false);
    const [autoScroll, setAutoScroll] = useState(true);

    const sseConnectedRef = useRef(false);
    const logContainerRef = useRef(null);

    // Hooks
    const {
        login,
        refreshToken,
        logout,
        isAuthenticated: authIsAuthenticated,
        getCurrentUser,
        getTokenInfo,
        isLoading: authIsLoading,
        authError,
        getCookie,
        validateAuthRequest,
        isTokenExpired
    } = useAuth(baseUrl);

    const {
        data: sseData,
        connectionState,
        isConnected,
        isConnecting,
        isReconnecting,
        error,
        connectionCount,
        lastEventId,
        replayProgress,
        networkStatus,
        connect,
        disconnect,
        forceReconnect,
        getEventBuffer,
        getMetrics
    } = useSSE(serverUrl, {
        reconnect: true,
        reconnectInterval: 3000,
        maxReconnectAttempts: sseSettings.maxReconnectAttempts,
        withCredentials: true,
        enablePaging: sseSettings.enablePaging,
        pageSize: sseSettings.pageSize,
        maxReplayEvents: sseSettings.maxReplayEvents,
        maxBufferSize: sseSettings.maxBufferSize,
        enableHeartbeat: sseSettings.enableHeartbeat,
        heartbeatInterval: sseSettings.heartbeatInterval,
        enableMetrics: sseSettings.enableMetrics,

        // 이벤트 핸들러
        onOpen: (data) => {
            addLog(`SSE 연결 성공 (연결 #${data.connectionCount})`, LOG_TYPES.SUCCESS);
            if (data.resumedFromEventId) {
                addLog(`이벤트 ID ${data.resumedFromEventId}부터 재개`, LOG_TYPES.INFO);
            }
        },
        onMessage: (data, event) => {
            const preview = typeof data === 'object'
                ? JSON.stringify(data).substring(0, 100) + '...'
                : String(data).substring(0, 100) + '...';
            addLog(`[${event.type || 'message'}] ${preview}`, LOG_TYPES.INFO);
        },
        onError: (error, errorType, metadata) => {
            addLog(`SSE 오류 (${errorType}): ${error.message} [시도 ${metadata.attempt}/${metadata.maxAttempts}]`, LOG_TYPES.ERROR);
        },
        onClose: (data) => {
            addLog(`SSE 연결 종료 (${data.reason}, 연결시간: ${Math.round(data.uptime/1000)}초)`, LOG_TYPES.WARNING);
        },
        onReplayStart: (data) => {
            addLog(`📥 이벤트 재전송 시작: 총 ${data.totalEvents.toLocaleString()}개`, LOG_TYPES.INFO);
        },
        onReplayEnd: (data) => {
            addLog(`✅ 이벤트 재전송 완료: ${data.processedEvents.toLocaleString()}개 처리`, LOG_TYPES.SUCCESS);
        },
        onReconnectAttempt: (attempt, delay, errorType) => {
            addLog(`🔄 재연결 시도 ${attempt}회 (${errorType}, ${Math.round(delay/1000)}초 후)`, LOG_TYPES.WARNING);
        },
        onReconnectFailed: (attempts, errorType) => {
            addLog(`❌ 재연결 실패: ${attempts}회 시도 후 포기 (${errorType})`, LOG_TYPES.ERROR);
        },
        onHeartbeatMissed: (timeSinceLastHeartbeat) => {
            addLog(`💔 하트비트 누락 (${Math.round(timeSinceLastHeartbeat/1000)}초)`, LOG_TYPES.WARNING);
        },
        onNetworkLost: () => {
            addLog('🌐 네트워크 연결 끊김 감지', LOG_TYPES.WARNING);
        },
        onNetworkRestore: (downtime) => {
            addLog(`🌐 네트워크 연결 복구 (다운타임: ${Math.round(downtime/1000)}초)`, LOG_TYPES.SUCCESS);
        }
    });

    const {
        messages: broadcastMessages,
        postMessage: postBroadcastMessage,
        clearMessages: clearBroadcastMessages,
        isSupported: isBroadcastSupported,
        isConnected: isBroadcastConnected,
        getMessageStats
    } = useBroadcastChannel('sse-gateway-channel');

    // 로그 추가
    const addLog = (message, type = LOG_TYPES.INFO) => {
        const timestamp = new Date().toLocaleTimeString('ko-KR', {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        });

        setLogs(prev => [...prev.slice(-199), {
            id: Date.now() + Math.random(),
            message,
            type,
            timestamp,
            fullTimestamp: new Date().toISOString()
        }]);
    };

    // 자동 스크롤
    useEffect(() => {
        if (autoScroll && logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs, autoScroll]);

    // 탭 활성화 감지
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' && authIsAuthenticated && !isConnected) {
                addLog('👁️ 탭 활성화 감지 - SSE 재연결 시작', LOG_TYPES.INFO);
                setTimeout(() => {
                    if (!isConnected) {
                        connect();
                    }
                }, 1000);
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [authIsAuthenticated, isConnected, connect]);

    // SSE 데이터 브로드캐스트
    useEffect(() => {
        if (sseData && isBroadcastSupported && isBroadcastConnected) {
            postBroadcastMessage({
                type: 'SSE_DATA',
                data: sseData,
                source: 'sse-gateway',
                eventId: lastEventId
            });
        }
    }, [sseData, lastEventId, postBroadcastMessage, isBroadcastSupported, isBroadcastConnected]);

    // 토큰 만료 체크
    useEffect(() => {
        if (!authIsAuthenticated) return;

        const tokenInfo = getTokenInfo();
        if (tokenInfo && tokenInfo.timeUntilExpiry < 300) { // 5분 이내 만료
            addLog(`⚠️ 토큰이 ${Math.round(tokenInfo.timeUntilExpiry/60)}분 후 만료됩니다`, LOG_TYPES.WARNING);
        }
    }, [authIsAuthenticated, getTokenInfo]);

    // 이벤트 핸들러들
    const handleLogin = async (e) => {
        try {
            addLog('🔐 로그인 시도 중...', LOG_TYPES.INFO);
            await login({
                accountId: parseInt(loginForm.accountId, 10),
                sessionId: loginForm.sessionId,
                uuid: loginForm.uuid
            });

            addLog(`✅ 로그인 성공! (계정: ${loginForm.accountId})`, LOG_TYPES.SUCCESS);
            setShowLoginForm(false);
            setLoginForm({ accountId: '', sessionId: '', uuid: '' });

            // 자동 SSE 연결
            setTimeout(() => connect(), 1000);
        } catch (err) {
            addLog(`❌ 로그인 실패: ${err.message}`, LOG_TYPES.ERROR);
        }
    };

    const handleRefreshToken = async () => {
        try {
            addLog('🔄 토큰 갱신 중...', LOG_TYPES.INFO);
            await refreshToken();
            addLog('✅ 토큰 갱신 성공!', LOG_TYPES.SUCCESS);
        }
        catch (err) {
            addLog(`❌ 토큰 갱신 실패: ${err.message}`, LOG_TYPES.ERROR);
        }
    };

    const handleLogout = () => {
        if (isConnected) {
            disconnect();
        }
        logout();
        setShowLoginForm(true);
        setLoginForm({ accountId: '', sessionId: '', uuid: '' });
        addLog('👋 로그아웃 완료', LOG_TYPES.INFO);
    };

    const handleSendBroadcast = () => {
        if (!broadcastInput.trim()) {
            addLog('📻 브로드캐스트할 메시지를 입력해주세요', LOG_TYPES.WARNING);
            return;
        }

        const success = postBroadcastMessage({
            type: 'USER_BROADCAST',
            message: broadcastInput,
            source: 'manual',
            timestamp: new Date().toISOString()
        });

        if (success) {
            addLog(`📻 브로드캐스트 전송: ${broadcastInput}`, LOG_TYPES.SUCCESS);
            setBroadcastInput('');
        } else {
            addLog('❌ 브로드캐스트 전송 실패', LOG_TYPES.ERROR);
        }
    };

    const handleSettingsChange = (key, value) => {
        setSseSettings(prev => ({ ...prev, [key]: value }));
        addLog(`⚙️ 설정 변경: ${key} = ${value}`, LOG_TYPES.INFO);
    };

    const handleViewEventBuffer = () => {
        const buffer = getEventBuffer();
        addLog(`📊 이벤트 버퍼: ${buffer.length.toLocaleString()}개 이벤트`, LOG_TYPES.INFO);
        console.log('Event Buffer:', buffer);
        setShowEventBuffer(true);
    };

    const handleViewMetrics = () => {
        const metrics = getMetrics();
        addLog(`📈 메트릭스 조회: 총 ${metrics.totalEvents.toLocaleString()}개 이벤트`, LOG_TYPES.INFO);
        console.log('SSE Metrics:', metrics);
        setShowMetrics(true);
    };

    const handleExportLogs = () => {
        const logsText = logs.map(log =>
            `[${log.timestamp}] [${log.type.toUpperCase()}] ${log.message}`
        ).join('\n');

        const blob = new Blob([logsText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `sse-gateway-logs-${new Date().toISOString().slice(0,19)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        addLog('📄 로그 파일 다운로드 시작', LOG_TYPES.SUCCESS);
    };

    // 유틸리티 함수들
    const generateUUID = () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });

    const generateSessionId = () => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const handleFillTestData = () => {
        setLoginForm({
            accountId: Math.floor(Math.random() * 90000) + 10000, // 5자리 랜덤 숫자
            sessionId: generateSessionId(),
            uuid: generateUUID()
        });
        addLog('🎲 테스트 데이터 자동 생성 완료', LOG_TYPES.INFO);
    };

    const getConnectionStateIcon = () => {
        switch (connectionState) {
            case CONNECTION_STATES.CONNECTED: return '🟢';
            case CONNECTION_STATES.CONNECTING: return '🟡';
            case CONNECTION_STATES.RECONNECTING: return '🟠';
            case CONNECTION_STATES.FAILED: return '🔴';
            default: return '⚪';
        }
    };

    const getConnectionStateText = () => {
        switch (connectionState) {
            case CONNECTION_STATES.CONNECTED: return '연결됨';
            case CONNECTION_STATES.CONNECTING: return '연결 중...';
            case CONNECTION_STATES.RECONNECTING: return '재연결 중...';
            case CONNECTION_STATES.FAILED: return '연결 실패';
            default: return '연결 안됨';
        }
    };

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const formatDuration = (ms) => {
        if (ms < 1000) return `${ms}ms`;
        if (ms < 60000) return `${(ms/1000).toFixed(1)}초`;
        if (ms < 3600000) return `${Math.floor(ms/60000)}분 ${Math.floor((ms%60000)/1000)}초`;
        return `${Math.floor(ms/3600000)}시간 ${Math.floor((ms%3600000)/60000)}분`;
    };

    return (
        <div className="sse-gateway">
            <header className="gateway-header">
                <h1>🚀 SSE Gateway Dashboard</h1>
                <div className="header-status">
          <span className={`status-badge ${networkStatus.isOnline ? 'online' : 'offline'}`}>
            {networkStatus.isOnline ? '🌐 온라인' : '🌐 오프라인'}
          </span>
                    <span className={`status-badge ${authIsAuthenticated ? 'authenticated' : 'unauthenticated'}`}>
            {authIsAuthenticated ? '🔐 인증됨' : '🔐 인증 필요'}
          </span>
                    <span className={`status-badge connection-${connectionState}`}>
            {getConnectionStateIcon()} {getConnectionStateText()}
          </span>
                </div>
            </header>

            {/* 인증 섹션 */}
            <section className={`sse-section auth-status ${authIsAuthenticated ? 'authenticated' : 'unauthenticated'}`}>
                <h3>🔐 인증 상태</h3>
                <div className="auth-info">
                    <p><strong>상태:</strong> {authIsAuthenticated ? '✅ 인증됨' : '❌ 인증 필요'}</p>

                    {authIsAuthenticated && (
                        <>
                            <p><strong>사용자:</strong> {getCurrentUser?.sub || getCurrentUser?.accountId || 'Unknown'}</p>
                            <p><strong>계정 ID:</strong> {getCurrentUser?.accountId}</p>

                            {getTokenInfo() && (
                                <>
                                    <p><strong>토큰 만료:</strong> {getTokenInfo().expiresAt.toLocaleString('ko-KR')}</p>
                                    <p><strong>만료까지:</strong> {formatDuration(getTokenInfo().timeUntilExpiry * 1000)}</p>
                                    {getTokenInfo().timeUntilExpiry < 300 && (
                                        <p className="token-warning">⚠️ 토큰이 곧 만료됩니다!</p>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {authError && <p className="error-message">❌ {authError}</p>}
                </div>

                {/* 로그인/로그아웃 폼 */}
                {showLoginForm ? (
                    <form onSubmit={handleLogin} className="auth-form">
                        <div className="form-grid">
                            <label>
                                계정 ID:
                                <input
                                    type="number"
                                    value={loginForm.accountId}
                                    onChange={e => setLoginForm(prev => ({ ...prev, accountId: e.target.value }))}
                                    disabled={authIsLoading}
                                    placeholder="예: 12345"
                                    min="1"
                                    required
                                />
                            </label>

                            <label>
                                세션 ID:
                                <input
                                    type="text"
                                    value={loginForm.sessionId}
                                    onChange={e => setLoginForm(prev => ({ ...prev, sessionId: e.target.value }))}
                                    disabled={authIsLoading}
                                    placeholder="session_xxx"
                                    minLength="10"
                                    required
                                />
                            </label>

                            <label>
                                UUID:
                                <input
                                    type="text"
                                    value={loginForm.uuid}
                                    onChange={e => setLoginForm(prev => ({ ...prev, uuid: e.target.value }))}
                                    disabled={authIsLoading}
                                    placeholder="xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
                                    pattern="^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
                                    required
                                />
                            </label>
                        </div>

                        <div className="button-group">
                            <button type="submit" className="btn blue" disabled={authIsLoading}>
                                {authIsLoading ? '로그인 중...' : '🔐 로그인'}
                            </button>
                            <button type="button" className="btn green" onClick={handleFillTestData}>
                                🎲 테스트 데이터
                            </button>
                            <button type="button" className="btn gray" onClick={() => setShowLoginForm(false)}>
                                취소
                            </button>
                        </div>
                    </form>
                ) : (
                    <div className="button-group">
                        <button className="btn blue" onClick={handleRefreshToken} disabled={authIsLoading}>
                            🔄 토큰 갱신
                        </button>
                        <button className="btn red" onClick={handleLogout}>
                            🚪 로그아웃
                        </button>
                        <button className="btn info" onClick={() => setShowLoginForm(true)}>
                            👤 다시 로그인
                        </button>
                    </div>
                )}
            </section>

            {/* SSE 연결 상태 */}
            <section className={`sse-section connection-status connection-${connectionState}`}>
                <h3>🔌 SSE 연결 상태</h3>
                <div className="connection-info">
                    <p><strong>상태:</strong> {getConnectionStateIcon()} {getConnectionStateText()}</p>
                    <p><strong>서버:</strong> {serverUrl}</p>
                    <p><strong>연결 횟수:</strong> {connectionCount.toLocaleString()}</p>
                    <div className="last-event-id-input">
                        <label htmlFor="lastEventIdInput"><strong>Last Event ID:</strong></label>
                        <input
                            id="lastEventIdInput"
                            type="text"
                            value={lastEventIdInput}
                            onChange={e => setLastEventIdInput(e.target.value)}
                            placeholder="Last-Event-ID"
                            style={{ marginLeft: '8px', padding: '4px', width: '200px' }}
                        />
                    </div>
                    <p><strong>네트워크:</strong> {networkStatus.isOnline ? '🟢 온라인' : '🔴 오프라인'}</p>

                    {/* 재전송 진행 상황 */}
                    {replayProgress.isReplaying && (
                        <div className="replay-progress">
                            <p><strong>📥 이벤트 재전송 진행:</strong></p>
                            <div className="progress-container">
                                <div className="progress-bar">
                                    <div
                                        className="progress-fill"
                                        style={{ width: `${(replayProgress.current / replayProgress.total) * 100}%` }}
                                    ></div>
                                </div>
                                <div className="progress-info">
                                    <span>{replayProgress.current.toLocaleString()} / {replayProgress.total.toLocaleString()}</span>
                                    <span>{Math.round((replayProgress.current / replayProgress.total) * 100)}%</span>
                                    {replayProgress.estimatedTimeRemaining && (
                                        <span>남은 시간: {formatDuration(replayProgress.estimatedTimeRemaining)}</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {error && <p className="error-message">⚠️ <strong>오류:</strong> {error}</p>}
                </div>

                <div className="button-group">
                    <button
                        className="btn green"
                        onClick={handleConnectClick}
                        disabled={isConnecting || isConnected}
                    >
                        {isConnecting ? '연결 중...' : '🔗 연결'}
                    </button>
                    <button
                        className="btn red"
                        onClick={disconnect}
                        disabled={!isConnected && !isConnecting}
                    >
                        ✂️ 연결 종료
                    </button>
                    <button className="btn blue" onClick={forceReconnect}>
                        🔄 강제 재연결
                    </button>
                </div>
            </section>

            {/* 서버 설정 */}
            <section className="sse-section server-settings">
                <h3>⚙️ 서버 설정</h3>
                <div className="settings-grid">
                    <label>
                        API 베이스 URL:
                        <input
                            type="url"
                            value={baseUrl}
                            onChange={e => setBaseUrl(e.target.value)}
                            placeholder="http://localhost:8090"
                        />
                    </label>

                    <label>
                        SSE 서버 URL:
                        <input
                            type="url"
                            value={serverUrl}
                            onChange={e => setServerUrl(e.target.value)}
                            placeholder="http://localhost:8090/subscribe"
                        />
                    </label>
                </div>

                {/* 고급 설정 */}
                <div className="advanced-settings">
                    <button
                        className="btn gray toggle-btn"
                        onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
                    >
                        {showAdvancedSettings ? '🔼' : '🔽'} 고급 설정
                    </button>

                    {showAdvancedSettings && (
                        <div className="advanced-settings-content">
                            <div className="settings-grid">
                                <label>
                                    페이징 활성화:
                                    <input
                                        type="checkbox"
                                        checked={sseSettings.enablePaging}
                                        onChange={e => handleSettingsChange('enablePaging', e.target.checked)}
                                    />
                                </label>

                                <label>
                                    페이지 크기:
                                    <input
                                        type="number"
                                        value={sseSettings.pageSize}
                                        min="10"
                                        max="1000"
                                        onChange={e => handleSettingsChange('pageSize', parseInt(e.target.value))}
                                    />
                                </label>

                                <label>
                                    최대 재전송 이벤트:
                                    <input
                                        type="number"
                                        value={sseSettings.maxReplayEvents}
                                        min="100"
                                        max="50000"
                                        onChange={e => handleSettingsChange('maxReplayEvents', parseInt(e.target.value))}
                                    />
                                </label>

                                <label>
                                    버퍼 크기:
                                    <input
                                        type="number"
                                        value={sseSettings.maxBufferSize}
                                        min="100"
                                        max="10000"
                                        onChange={e => handleSettingsChange('maxBufferSize', parseInt(e.target.value))}
                                    />
                                </label>

                                <label>
                                    하트비트 활성화:
                                    <input
                                        type="checkbox"
                                        checked={sseSettings.enableHeartbeat}
                                        onChange={e => handleSettingsChange('enableHeartbeat', e.target.checked)}
                                    />
                                </label>

                                <label>
                                    하트비트 간격 (ms):
                                    <input
                                        type="number"
                                        value={sseSettings.heartbeatInterval}
                                        min="5000"
                                        max="300000"
                                        step="5000"
                                        onChange={e => handleSettingsChange('heartbeatInterval', parseInt(e.target.value))}
                                    />
                                </label>

                                <label>
                                    최대 재연결 시도:
                                    <input
                                        type="number"
                                        value={sseSettings.maxReconnectAttempts}
                                        min="1"
                                        max="100"
                                        onChange={e => handleSettingsChange('maxReconnectAttempts', parseInt(e.target.value))}
                                    />
                                </label>

                                <label>
                                    메트릭스 수집:
                                    <input
                                        type="checkbox"
                                        checked={sseSettings.enableMetrics}
                                        onChange={e => handleSettingsChange('enableMetrics', e.target.checked)}
                                    />
                                </label>
                            </div>
                        </div>
                    )}
                </div>
            </section>

            {/* 브로드캐스트 채널 */}
            {isBroadcastSupported && (
                <section className="sse-section broadcast-section">
                    <h3>📻 브라우저 탭 간 통신</h3>
                    <div className="broadcast-info">
                        <p><strong>채널 상태:</strong> {isBroadcastConnected ? '🟢 연결됨' : '🔴 연결 안됨'}</p>
                        <p><strong>메시지 수:</strong> {broadcastMessages.length.toLocaleString()}개</p>
                    </div>

                    <div className="broadcast-send">
                        <div className="input-group">
                            <input
                                type="text"
                                value={broadcastInput}
                                onChange={e => setBroadcastInput(e.target.value)}
                                placeholder="다른 탭으로 보낼 메시지"
                                onKeyPress={e => e.key === 'Enter' && handleSendBroadcast()}
                                maxLength="500"
                            />
                            <button className="btn blue" onClick={handleSendBroadcast}>
                                📤 전송
                            </button>
                        </div>
                    </div>

                    <div className="broadcast-messages">
                        <div className="section-header">
                            <h4>📨 수신 메시지 ({broadcastMessages.slice(-10).length}/10)</h4>
                            <button className="btn gray small" onClick={clearBroadcastMessages}>
                                🗑️ 정리
                            </button>
                        </div>

                        <div className="message-list">
                            {broadcastMessages.length === 0 ? (
                                <p className="no-messages">브로드캐스트 메시지가 없습니다</p>
                            ) : (
                                broadcastMessages.slice(-10).map(message => (
                                    <div key={message.id} className="message-item">
                                        <div className="message-header">
                                            <span className="message-type">[{message.type}]</span>
                                            <span className="message-time">{new Date(message.receivedAt).toLocaleTimeString('ko-KR')}</span>
                                        </div>
                                        <div className="message-content">
                                            {message.message || JSON.stringify(message.data, null, 2)}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </section>
            )}

            {/* 데이터 및 디버그 정보 */}
            <div className="data-section">
                {/* SSE 데이터 */}
                <section className="sse-section">
                    <div className="section-header">
                        <h3>📊 최신 SSE 데이터</h3>
                        <div className="button-group">
                            <button className="btn blue small" onClick={handleViewEventBuffer}>
                                🔍 이벤트 버퍼
                            </button>
                            {sseSettings.enableMetrics && (
                                <button className="btn green small" onClick={handleViewMetrics}>
                                    📈 메트릭스
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="data-display">
                        <pre>{sseData ? JSON.stringify(sseData, null, 2) : '데이터 없음'}</pre>
                    </div>
                </section>

                {/* 로그 */}
                <section className="sse-section logs-section">
                    <div className="section-header">
                        <h3>📝 시스템 로그 ({logs.length.toLocaleString()})</h3>
                        <div className="button-group">
                            <label className="auto-scroll-toggle">
                                <input
                                    type="checkbox"
                                    checked={autoScroll}
                                    onChange={e => setAutoScroll(e.target.checked)}
                                />
                                자동 스크롤
                            </label>
                            <button className="btn blue small" onClick={handleExportLogs}>
                                💾 내보내기
                            </button>
                            <button className="btn gray small" onClick={() => setLogs([])}>
                                🗑️ 정리
                            </button>
                        </div>
                    </div>

                    <div className="log-container" ref={logContainerRef}>
                        {logs.map(log => (
                            <div key={log.id} className={`log-entry log-${log.type}`}>
                                <span className="log-timestamp">[{log.timestamp}]</span>
                                <span className="log-message">{log.message}</span>
                            </div>
                        ))}
                        {logs.length === 0 && (
                            <div className="no-logs">로그가 없습니다</div>
                        )}
                    </div>
                </section>
            </div>

            {/* 메트릭스 모달 */}
            {showMetrics && sseSettings.enableMetrics && (
                <div className="modal-overlay" onClick={() => setShowMetrics(false)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>📈 SSE 메트릭스</h3>
                            <button className="btn gray small" onClick={() => setShowMetrics(false)}>✖️</button>
                        </div>
                        <div className="metrics-content">
                            {(() => {
                                const metrics = getMetrics();
                                return (
                                    <div className="metrics-grid">
                                        <div className="metric-item">
                                            <span className="metric-label">총 이벤트:</span>
                                            <span className="metric-value">{metrics.totalEvents.toLocaleString()}</span>
                                        </div>
                                        <div className="metric-item">
                                            <span className="metric-label">총 재연결:</span>
                                            <span className="metric-value">{metrics.totalReconnects.toLocaleString()}</span>
                                        </div>
                                        <div className="metric-item">
                                            <span className="metric-label">총 오류:</span>
                                            <span className="metric-value">{metrics.totalErrors.toLocaleString()}</span>
                                        </div>
                                        <div className="metric-item">
                                            <span className="metric-label">평균 이벤트 크기:</span>
                                            <span className="metric-value">{formatBytes(metrics.averageEventSize)}</span>
                                        </div>
                                        <div className="metric-item">
                                            <span className="metric-label">연결 시간:</span>
                                            <span className="metric-value">{formatDuration(metrics.connectionUptime)}</span>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* 이벤트 버퍼 모달 */}
            {showEventBuffer && (
                <div className="modal-overlay" onClick={() => setShowEventBuffer(false)}>
                    <div className="modal-content large" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>🔍 이벤트 버퍼</h3>
                            <button className="btn gray small" onClick={() => setShowEventBuffer(false)}>✖️</button>
                        </div>
                        <div className="buffer-content">
                            {(() => {
                                const buffer = getEventBuffer();
                                return (
                                    <div className="buffer-list">
                                        {buffer.slice(-50).map((event, index) => (
                                            <div key={`${event.id}-${index}`} className="buffer-item">
                                                <div className="buffer-header">
                                                    <span className="event-id">ID: {event.id}</span>
                                                    <span className="event-type">타입: {event.type}</span>
                                                    <span className="event-size">크기: {formatBytes(event.size)}</span>
                                                    <span className="event-time">{new Date(event.timestamp).toLocaleString('ko-KR')}</span>
                                                </div>
                                                <div className="buffer-data">
                                                    <pre>{JSON.stringify(event.data, null, 2)}</pre>
                                                </div>
                                            </div>
                                        ))}
                                        {buffer.length === 0 && (
                                            <div className="no-buffer">버퍼에 이벤트가 없습니다</div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SSEGateway;
