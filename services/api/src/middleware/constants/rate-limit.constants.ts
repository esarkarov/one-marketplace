export const FIFTEEN_MINUTES = 15 * 60 * 1000;
export const ONE_HOUR = 60 * 60 * 1000;

export const PUBLIC_SEARCH_LIMIT = 60;
export const PUBLIC_SEARCH_WINDOW_MS = 60 * 1000;

export const MESSAGE_WRITE_LIMIT = 120;
export const CONTENT_WRITE_LIMIT = 30;

export const INVITE_WRITE_LIMIT = 20;
export const INVITE_WRITE_WINDOW_MS = ONE_HOUR;

export const RATE_LIMIT_KEY_PREFIX = "rl";
export const RATE_LIMIT_STORE_TIMEOUT_MS = 500;
export const RATE_LIMIT_STORE_WARN_INTERVAL_MS = 60 * 1000;

export const RATE_LIMIT_INCREMENT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
return { count, ttl }
`;

export const RATE_LIMIT_DECREMENT_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;
