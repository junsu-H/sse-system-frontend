// src/index.js
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

// 전역 에러 핸들러
window.addEventListener('unhandledrejection', event => {
    console.error('Unhandled promise rejection:', event.reason);
    // 프로덕션 환경에서는 에러 리포팅 서비스로 전송
});

window.addEventListener('error', event => {
    console.error('Global error:', event.error);
    // 프로덕션 환경에서는 에러 리포팅 서비스로 전송
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);

// 성능 측정
reportWebVitals(console.log);
