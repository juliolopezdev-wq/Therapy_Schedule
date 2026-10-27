export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
// Browser mistakes must not lock every colleague behind the facility's public IP.
export const SIGN_IN_LOCK_MS = 15 * 60 * 1000;
export const SIGN_IN_MAX_FAILURES = 3;
export const SIGN_IN_NETWORK_REQUEST_LIMIT = 100;
export const SESSION_IDLE_MS = 60 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 24 * 60 * 60 * 1000;
