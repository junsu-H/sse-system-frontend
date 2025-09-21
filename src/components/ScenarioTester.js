// src/components/ScenarioTester.js
import React, { useState, useEffect, useRef } from "react";

const ScenarioTester = () => {
    const [eventSource, setEventSource] = useState(null);
    const [logs, setLogs] = useState([]);
    const [lastEventId, setLastEventId] = useState(null);

    const logRef = useRef(null);

    const addLog = (msg, type = "info") => {
        const time = new Date().toLocaleTimeString();
        setLogs((prev) => [...prev, `[${time}] (${type}) ${msg}`]);
    };

    // 자동 스크롤
    useEffect(() => {
        if (logRef.current) {
            logRef.current.scrollTop = logRef.current.scrollHeight;
        }
    }, [logs]);

    // 연결 해제
    const disconnect = () => {
        if (eventSource) {
            eventSource.close();
            setEventSource(null);
            addLog("연결 해제됨", "warn");
        }
    };

    // 연결
    const connect = (options = {}) => {
        disconnect();

        // auth token 발급 → sse 구독
        fetch("/ses/api/auth/token")
            .then((res) => res.json())
            .then((data) => {
                const token = data?.token;
                if (!token) {
                    addLog("토큰 발급 실패", "error");
                    return;
                }

                const headers = {
                    Authorization: `Bearer ${token}`,
                    ...options.headers,
                };

                const url = "/sse/api/subscribe";
                const es = new EventSource(url, { withCredentials: true });

                es.onopen = () => addLog("SSE 연결 성공", "success");

                es.onmessage = (e) => {
                    addLog(`메시지 수신: ${e.data}`, "msg");

                    try {
                        const parsed = JSON.parse(e.data);
                        if (parsed.eventId) {
                            setLastEventId(parsed.eventId);
                        }
                    } catch (_) {
                        // 단순 문자열 메시지면 무시
                    }
                };

                es.onerror = () => addLog("SSE 오류 발생", "error");

                setEventSource(es);
            })
            .catch((err) => {
                addLog("토큰 요청 실패: " + err.message, "error");
            });
    };

    // 📌 시나리오별 테스트
    const scenarioSingleTab = () => {
        disconnect();
        connect();
        addLog("🔗 단일 탭 커넥션 시뮬레이션 실행", "info");
    };

    const scenarioTPS = () => {
        let count = 0;
        const interval = setInterval(() => {
            const batch = Array.from({ length: 10000 }, (_, i) => i);
            batch.forEach(() => {
                count++;
            });
            addLog(`🚀 TPS 테스트: ${count.toLocaleString()} 이벤트 발생`, "success");
        }, 1000);

        setTimeout(() => clearInterval(interval), 5000); // 5초간만 실행
    };

    const scenarioLastEventId = () => {
        disconnect();
        connect({
            headers: {
                "Last-Event-ID": lastEventId || "0",
            },
        });
        addLog(`📌 Last-Event-ID(${lastEventId || "0"}) 포함 연결 시뮬레이션`, "info");
    };

    const scenarioNewTab = () => {
        let elapsed = 0;
        const interval = setInterval(() => {
            elapsed++;
            disconnect();
            connect();
            addLog(`🕒 새탭 열기 시뮬레이션 (${elapsed}분차)`, "info");
            if (elapsed >= 1) clearInterval(interval); // 1분간만
        }, 60 * 1000);
    };

    return (
        <div className="scenario-tester">
            <h2>🧪 SSE 시나리오 테스트</h2>
            <div className="button-group">
                <button onClick={scenarioSingleTab}>1️⃣ 단일 탭 커넥션</button>
                <button onClick={scenarioTPS}>2️⃣ TPS 10,000/s 부하</button>
                <button onClick={scenarioLastEventId}>3️⃣ Last-Event-ID 처리</button>
                <button onClick={scenarioNewTab}>4️⃣ 1분 새탭 시뮬레이션</button>
                <button onClick={disconnect}>❌ 연결 해제</button>
            </div>

            <div
                ref={logRef}
                style={{
                    marginTop: "1rem",
                    background: "#111",
                    color: "#0f0",
                    padding: "1rem",
                    height: "300px",
                    overflowY: "auto",
                    fontFamily: "monospace",
                    fontSize: "0.9rem",
                }}
            >
                {logs.map((l, idx) => (
                    <div key={idx}>{l}</div>
                ))}
            </div>
        </div>
    );
};

export default ScenarioTester;
