// src/components/SSEGateway.js
import React, { useState, useEffect, useRef } from 'react';
import useSSE from '../hooks/useSSE';
import useAuth from '../hooks/useAuth';
import useBroadcastChannel from '../hooks/useBroadcastChannel';
import { CONNECTION_STATES, LOG_TYPES } from '../utils/constants';
import './SSEGateway.css';

const SSEGateway = () => {
    // 기본 상태
    const [baseUrl, setBaseUrl] = useState('http://localhost:9292');
    const [serverUrl, setServerUrl] = useState('http://localhost:9292/sse/api/subscribe');
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

        // setLogs(prev => [...prev.slice(-199), {
        //     id: Date.now() + Math.random(),
        //     message,
        //     type,
        //     timestamp,
        //     fullTimestamp: new Date().toISOString()
        // }]);
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
            if (document.visibilityState === 'visible') {
                // 탭이 활성화되면 연결
                if (authIsAuthenticated && !isConnected) {
                    addLog('👁️ 탭 활성화 - SSE 재연결 시작', LOG_TYPES.INFO);
                    setTimeout(() => {
                        if (!isConnected) {
                            connect();
                        }
                    }, 500);
                }
            } else {
                // 탭이 비활성화되면 연결 끊기
                if (isConnected) {
                    addLog('🙈 탭 비활성화 - SSE 연결 종료', LOG_TYPES.INFO);
                    disconnect();
                }
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [authIsAuthenticated, isConnected, connect, disconnect]);

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


    const [testClientIdInput, setTestClientIdInput] = useState('');
    const [testEventSource, setTestEventSource] = useState(null);
    const [testIsConnected2, setTestIsConnected2] = useState(false);

    // 1명 subscribe
    const [testSubscribeClientId, setTestSubscribeClientId] = useState('');
    // subscribe tps
    const [testTpsInput, setTestTpsInput] = useState('5'); // 기본 5TPS

    // cast tps
    const [testCastTpsInput, setTestCastTpsInput] = useState('5');
    // unicast
    const [testCastClientId, setTestCastClientId] = useState('');

    // last-event-id
    const [testLastEventIdInput, setTestLastEventIdInput] = useState('');


    // 여러명 /subscribe
    const [testClientIdPrefix, setTestClientIdPrefix] = useState('');

    // 여러 명 SSE 연결 상태 관리
    const [testEventSources, setTestEventSources] = useState([]); // EventSource 배열
    const [broadIsConnected, setBroadIsConnected] = useState(false);

    // 여러 명 /broadcast 관련 상태
    const [broadcastClientIdPrefix, setBroadcastClientIdPrefix] = useState('');
    const [broadcastCastTpsInput, setBroadcastCastTpsInput] = useState('5'); // 기본 5TPS

    // 여러 명 SSE 연결 상태 관리
    const [testEventSourcesLast, setTestEventSourcesLast] = useState([]); // EventSource 배열
    const [testBroadIsConnected, setTestBroadIsConnected] = useState(false); // 연결 상태


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

            {/* ------------------- 시나리오 박스 ------------------- */}
            <section className="sse-section scenario-box">
                <section className="sse-section scenario-box">
                    {/* /subscribe TPS 테스트 (입력 기반) */}
                    <div className="scenario-item">
                        <p>1️⃣ 한 명 /subscribe TPS 테스트</p>
                        <div className="tps-input-group" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                type="text"
                                placeholder="Client ID 입력"
                                value={testSubscribeClientId}
                                onChange={e => setTestSubscribeClientId(e.target.value)}
                                style={{ width: '180px', padding: '4px' }}
                            />
                            <input
                                type="number"
                                min="1"
                                placeholder="테스트할 TPS 입력"
                                value={testTpsInput}
                                onChange={e => setTestTpsInput(e.target.value)}
                                style={{ width: '120px', padding: '4px' }}
                            />
                            <button
                                className="btn green"
                                onClick={() => {
                                    const tps = parseInt(testTpsInput, 10);
                                    if (!tps || tps <= 0) {
                                        addLog('❌ 올바른 TPS 값을 입력하세요', LOG_TYPES.WARNING);
                                        return;
                                    }
                                    if (!testSubscribeClientId.trim()) {
                                        addLog('❌ Client ID를 입력하세요', LOG_TYPES.WARNING);
                                        return;
                                    }

                                    addLog(`⚡ /subscribe TPS 테스트 시작: ${tps} TPS, Client ID: ${testSubscribeClientId}`, LOG_TYPES.INFO);

                                    if (testIsConnected2) {
                                        addLog('✂️ 기존 SSE 연결 종료', LOG_TYPES.INFO);
                                        disconnect();
                                    }

                                    const delay = 1000 / tps;
                                    for (let i = 0; i < tps; i++) {
                                        setTimeout(async () => {
                                            try {
                                                await fetch(
                                                    `${baseUrl}/sse/api/subscribe?clientId=${encodeURIComponent(testSubscribeClientId)}`,
                                                    {
                                                        method: 'GET',
                                                        credentials: 'include',
                                                        headers: { 'Last-Event-ID': testLastEventIdInput }
                                                    }
                                                );
                                            } catch (err) {
                                                addLog(`❌ /subscribe 호출 오류: ${err.message}`, LOG_TYPES.ERROR);
                                            }
                                        }, i * delay);
                                    }
                                }}
                            >
                                시작
                            </button>
                        </div>
                    </div>

                    {/* 한 명 message publish TPS 테스트 */}
                    <div className="scenario-item">
                        <p>2️⃣ 한 명 message publish TPS 테스트</p>
                        <div className="tps-input-group" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                type="text"
                                placeholder="Client ID 입력"
                                value={testCastClientId}
                                onChange={e => setTestCastClientId(e.target.value)}
                                style={{ width: '180px', padding: '4px' }}
                            />
                            <input
                                type="number"
                                min="1"
                                placeholder="테스트할 TPS 입력"
                                value={testCastTpsInput}
                                onChange={e => setTestCastTpsInput(e.target.value)}
                                style={{ width: '120px', padding: '4px' }}
                            />
                            <button
                                className="btn orange"
                                onClick={() => {
                                    const tps = parseInt(testCastTpsInput, 10);
                                    if (!tps || tps <= 0) {
                                        addLog('❌ 올바른 TPS 값을 입력하세요', LOG_TYPES.WARNING);
                                        return;
                                    }
                                    if (!testCastClientId.trim()) {
                                        addLog('❌ Client ID를 입력하세요', LOG_TYPES.WARNING);
                                        return;
                                    }

                                    addLog(`⚡ /cast unicast TPS 테스트 시작: ${tps} TPS, Client ID: ${testCastClientId}`, LOG_TYPES.INFO);
                                    const delay = 1000 / tps;

                                    for (let i = 0; i < tps; i++) {
                                        setTimeout(async () => {
                                            try {
                                                await fetch(`${baseUrl}/sse/api/cast`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    credentials: 'include',
                                                    body: JSON.stringify({
                                                        clientId: testCastClientId,
                                                        eventId: `epoch-${Date.now()}-${i}`,
                                                        message: `테스트 메시지 ${i + 1}`,
                                                        sendType: 'unicast'
                                                    })
                                                });
                                            } catch (err) {
                                                addLog(`❌ /cast 호출 오류: ${err.message}`, LOG_TYPES.ERROR);
                                            }
                                        }, i * delay);
                                    }
                                }}
                            >
                                시작
                            </button>
                        </div>
                    </div>

                    {/* last-event-id 처리 */}
                    <div className="scenario-item">
                        <p>3️⃣ 한 명 토큰 만료 후 Last-Event-ID로 /subscribe 재연결</p>
                        <div className="last-event-id-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <input
                                type="text"
                                placeholder="Client ID 입력"
                                value={testSubscribeClientId} // 한 명용 Client ID
                                onChange={e => setTestSubscribeClientId(e.target.value)}
                                style={{ padding: '4px', width: '180px' }}
                            />
                            <input
                                type="text"
                                placeholder="Last-Event-ID 입력"
                                value={testLastEventIdInput}
                                onChange={e => setTestLastEventIdInput(e.target.value)}
                                style={{ padding: '4px', width: '220px' }}
                            />
                            <button
                                className="btn red"
                                onClick={() => {
                                    if (!authIsAuthenticated) {
                                        addLog('❌ 인증 필요: 토큰을 발급하세요', LOG_TYPES.WARNING);
                                        return;
                                    }
                                    if (!testSubscribeClientId.trim()) {
                                        addLog('❌ Client ID를 입력하세요', LOG_TYPES.WARNING);
                                        return;
                                    }
                                    if (!testLastEventIdInput.trim()) {
                                        addLog('⚠️ Last-Event-ID를 입력해주세요', LOG_TYPES.WARNING);
                                        return;
                                    }

                                    addLog('📥 한 명 Last-Event-ID 재연결 테스트 시작', LOG_TYPES.INFO);

                                    // SSE 연결
                                    const eventSource = new EventSource(
                                        `${baseUrl}/sse/api/subscribe?clientId=${encodeURIComponent(testSubscribeClientId)}`,
                                        {
                                            withCredentials: true,
                                            headers: { 'Last-Event-ID': testLastEventIdInput }
                                        }
                                    );

                                    setTestEventSource(eventSource);
                                    setTestIsConnected2(true);

                                    eventSource.onmessage = e => {
                                        addLog(`📩 메시지 수신 (Client ID=${testSubscribeClientId}): ${e.data}`, LOG_TYPES.MESSAGE);
                                    };

                                    eventSource.onerror = e => {
                                        addLog(`❌ SSE 연결 오류 (Client ID=${testSubscribeClientId})`, LOG_TYPES.ERROR);
                                        eventSource.close();
                                        setTestIsConnected2(false);
                                    };

                                    addLog(`🔄 Last-Event-ID: ${testLastEventIdInput}로 ${testSubscribeClientId} 재연결 시도`, LOG_TYPES.INFO);
                                }}
                            >
                                🔁 재연결
                            </button>
                        </div>
                    </div>

                </section>


                <section className="sse-section scenario-box">

                {/* 여러명 /subscribe */}
                <div className="scenario-item">
                    <p>1️⃣ 여러명 /subscribe?clientId= TPS 테스트</p>
                    <div className="tps-input-group" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <input
                            type="text"
                            placeholder="Client ID Prefix 입력"
                            value={testClientIdPrefix}
                            onChange={e => setTestClientIdPrefix(e.target.value)}
                            style={{ width: '180px', padding: '4px' }}
                        />
                        <input
                            type="number"
                            min="1"
                            placeholder="테스트할 TPS 입력"
                            value={testTpsInput}
                            onChange={e => setTestTpsInput(e.target.value)}
                            style={{ width: '120px', padding: '4px' }}
                        />
                        <button
                            className="btn green"
                            onClick={() => {
                                const tps = parseInt(testTpsInput, 10);
                                if (!tps || tps <= 0) {
                                    addLog('❌ 올바른 TPS 값을 입력하세요', LOG_TYPES.WARNING);
                                    return;
                                }
                                if (!testClientIdPrefix.trim()) {
                                    addLog('❌ Client ID Prefix를 입력하세요', LOG_TYPES.WARNING);
                                    return;
                                }

                                addLog(`⚡ /subscribe TPS 테스트 시작: ${tps} TPS, Prefix: ${testClientIdPrefix}`, LOG_TYPES.INFO);

                                if (broadIsConnected) {
                                    addLog('✂️ 기존 SSE 연결 종료', LOG_TYPES.INFO);
                                    disconnect();
                                }

                                const delay = 1000 / tps;
                                for (let i = 0; i < tps; i++) {
                                    setTimeout(async () => {
                                        try {
                                            await fetch(
                                                `${baseUrl}/sse/api/subscribe?clientId=${testClientIdPrefix}${i + 1}`,
                                                {
                                                    method: 'GET',
                                                    credentials: 'include',
                                                    headers: { 'Last-Event-ID': testLastEventIdInput }
                                                }
                                            );
                                        } catch (err) {
                                            addLog(`❌ /subscribe 호출 오류: ${err.message}`, LOG_TYPES.ERROR);
                                        }
                                    }, i * delay);
                                }
                            }}
                        >
                            시작
                        </button>
                    </div>
                </div>

                    {/* 여러 명 message publish */}
                    <div className="scenario-item">
                        <p>2️⃣ 여러 명 message publish TPS 테스트</p>
                        <div className="tps-input-group" style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <input
                                type="text"
                                placeholder="Client ID Prefix 입력"
                                value={broadcastClientIdPrefix}
                                onChange={e => setBroadcastClientIdPrefix(e.target.value)}
                                style={{ width: '180px', padding: '4px' }}
                            />
                            <input
                                type="number"
                                min="1"
                                placeholder="테스트할 TPS 입력"
                                value={broadcastCastTpsInput}
                                onChange={e => setBroadcastCastTpsInput(e.target.value)}
                                style={{ width: '120px', padding: '4px' }}
                            />
                            <button
                                className="btn orange"
                                onClick={() => {
                                    const tps = parseInt(broadcastCastTpsInput, 10);
                                    if (!tps || tps <= 0) {
                                        addLog('❌ 올바른 TPS 값을 입력하세요', LOG_TYPES.WARNING);
                                        return;
                                    }
                                    if (!broadcastClientIdPrefix.trim()) {
                                        addLog('❌ Client ID Prefix를 입력하세요', LOG_TYPES.WARNING);
                                        return;
                                    }

                                    addLog(`⚡ Broadcast /cast TPS 테스트 시작: ${tps} TPS, Prefix: ${broadcastClientIdPrefix}`, LOG_TYPES.INFO);
                                    const delay = 1000 / tps;

                                    for (let i = 0; i < tps; i++) {
                                        setTimeout(async () => {
                                            const clientId = `${broadcastClientIdPrefix}${i + 1}`; // 각 clientId 생성
                                            try {
                                                await fetch(`${baseUrl}/sse/api/cast`, {
                                                    method: 'POST',
                                                    headers: { 'Content-Type': 'application/json' },
                                                    credentials: 'include',
                                                    body: JSON.stringify({
                                                        clientId, // broadcast clientId
                                                        eventId: `epoch-${Date.now()}-${i}`,
                                                        message: `테스트 메시지 ${i + 1}`,
                                                        sendType: 'broadcast'
                                                    })
                                                });
                                            } catch (err) {
                                                addLog(`❌ /cast 호출 오류 (Client ID=${clientId}): ${err.message}`, LOG_TYPES.ERROR);
                                            }
                                        }, i * delay);
                                    }
                                }}
                            >
                                시작
                            </button>
                        </div>
                    </div>


                    <div className="scenario-item">
                        <p>3️⃣ 여러 명 토큰 만료 후 Last-Event-ID로 /subscribe 재연결</p>
                        <div className="last-event-id-group" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {/* Client ID Prefix 입력 */}
                            <input
                                type="text"
                                placeholder="Client ID Prefix 입력"
                                value={broadcastClientIdPrefix}
                                onChange={e => setBroadcastClientIdPrefix(e.target.value)}
                                style={{ padding: '4px', width: '180px' }}
                            />
                            {/* Last-Event-ID 입력 */}
                            <input
                                type="text"
                                placeholder="Last-Event-ID 입력"
                                value={testLastEventIdInput}
                                onChange={e => setTestLastEventIdInput(e.target.value)}
                                style={{ padding: '4px', width: '220px' }}
                            />
                            <button
                                className="btn red"
                                onClick={() => {
                                    if (!authIsAuthenticated) {
                                        addLog('❌ 인증 필요: 토큰을 발급하세요', LOG_TYPES.WARNING);
                                        return;
                                    }
                                    if (!testLastEventIdInput.trim()) {
                                        addLog('⚠️ Last-Event-ID를 입력해주세요', LOG_TYPES.WARNING);
                                        return;
                                    }
                                    if (!broadcastClientIdPrefix.trim()) {
                                        addLog('❌ Client ID Prefix를 입력하세요', LOG_TYPES.WARNING);
                                        return;
                                    }
                                    const tps = parseInt(broadcastCastTpsInput, 10);
                                    if (!tps || tps <= 0) {
                                        addLog('❌ 올바른 TPS 값을 입력하세요', LOG_TYPES.WARNING);
                                        return;
                                    }

                                    addLog('📥 여러 명 Last-Event-ID 재연결 테스트 시작', LOG_TYPES.INFO);

                                    // 기존 SSE 연결 종료
                                    if (testEventSources.length > 0) {
                                        testEventSourcesLast.forEach(es => es.close());
                                        setTestEventSourcesLast([]);
                                        setTestBroadIsConnected(false);
                                        addLog('✂️ 기존 SSE 연결 종료', LOG_TYPES.INFO);
                                    }

                                    const delay = 1000 / tps;
                                    const newEventSources = [];

                                    for (let i = 0; i < tps; i++) {
                                        setTimeout(() => {
                                            const clientId = `${broadcastClientIdPrefix}${i + 1}`;
                                            const es = new EventSource(
                                                `${baseUrl}/sse/api/subscribe?clientId=${encodeURIComponent(clientId)}`,
                                                { withCredentials: true }
                                            );

                                            es.onmessage = e => addLog(`📩 [${clientId}] 메시지 수신: ${e.data}`, LOG_TYPES.MESSAGE);
                                            es.onerror = () => {
                                                addLog(`❌ [${clientId}] SSE 연결 오류`, LOG_TYPES.ERROR);
                                                es.close();
                                            };

                                            newEventSources.push(es);
                                        }, i * delay);
                                    }

                                    setTestEventSourcesLast(newEventSources);
                                    setTestBroadIsConnected(true);
                                }}
                            >
                                🔁 재연결
                            </button>
                        </div>
                    </div>



                </section>


            </section>

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
        </div>
    );
};

export default SSEGateway;
