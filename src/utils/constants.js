// src/utils/constants.js
export const SSE_CONFIG = {
    DEFAULT_RECONNECT_INTERVAL: 3000,
    MAX_RECONNECT_ATTEMPTS: 10,
    DEFAULT_PAGE_SIZE: 100,
    MAX_REPLAY_EVENTS: 10000,
    MAX_BUFFER_SIZE: 1000,
    RECONNECT_DELAYS: {
        network: { base: 1000, max: 30000, multiplier: 2 },
        server_error: { base: 2000, max: 60000, multiplier: 2 },
        auth_error: { base: 60000, max: 300000, multiplier: 1 },
        default: { base: 1500, max: 30000, multiplier: 1.5 }
    }
};

export const LOG_TYPES = {
    SUCCESS: 'success',
    ERROR: 'error',
    WARNING: 'warning',
    INFO: 'info'
};

export const CONNECTION_STATES = {
    CONNECTING: 'connecting',
    CONNECTED: 'connected',
    DISCONNECTED: 'disconnected',
    RECONNECTING: 'reconnecting',
    FAILED: 'failed'
};

export const EVENT_TYPES = {
    REPLAY_START: 'replay_start',
    REPLAY_END: 'replay_end',
    REPLAY_PROGRESS: 'replay_progress',
    HEARTBEAT: 'heartbeat',
    ERROR: 'error',
    MESSAGE: 'message'
};
