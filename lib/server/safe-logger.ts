/**
 * Safe logging utilities for SWARM backend
 * Logs authentication and API errors without exposing credentials
 */

// Patterns to redact from logs
const SECRET_PATTERNS = [
  /Bearer\s+[^\s]+/gi,
  /sk-[a-zA-Z0-9_-]+/gi,
  /gsk_[a-zA-Z0-9_-]+/gi,
  /nvapi-[a-zA-Z0-9_-]+/gi,
  /swarm_device_[a-zA-Z0-9_-]+/gi,
  /__session=[^;]+/gi,
  /authorization:\s*[^\s,}]+/gi,
  /"apiKey":\s*"[^"]+"/gi,
  /"token":\s*"[^"]+"/gi,
];

function redactSecrets(text: string): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      // Keep the prefix, redact the rest
      const prefix = match.substring(0, Math.min(10, match.length));
      return `${prefix}***REDACTED***`;
    });
  }
  return redacted;
}

export interface AuthLogContext {
  path: string;
  method: string;
  status?: number;
  origin?: string;
  hasAuthHeader: boolean;
  hasCookie: boolean;
  tokenType?: 'clerk' | 'device' | 'none';
  error?: string;
  userId?: string;
  timestamp: string;
}

/**
 * Log authentication attempts safely
 */
export function logAuthAttempt(context: AuthLogContext): void {
  const level = context.status && context.status >= 400 ? 'warn' : 'info';
  const logger = level === 'warn' ? console.warn : console.log;
  
  const parts = [
    `[AUTH ${context.status || 'PENDING'}]`,
    `${context.method} ${context.path}`,
    context.origin ? `origin=${context.origin}` : null,
    `auth=${context.tokenType || 'none'}`,
    context.userId ? `user=${context.userId.substring(0, 8)}***` : null,
    context.error ? `error="${context.error}"` : null,
  ].filter(Boolean);
  
  logger(`${context.timestamp} ${parts.join(' ')}`);
}

/**
 * Log API errors safely
 */
export function logApiError(
  path: string,
  method: string,
  status: number,
  error: unknown,
  userId?: string
): void {
  const timestamp = new Date().toISOString();
  const errorMessage = error instanceof Error ? error.message : String(error);
  const redactedMessage = redactSecrets(errorMessage);
  
  console.error(
    `${timestamp} [API ERROR ${status}] ${method} ${path}`,
    userId ? `user=${userId.substring(0, 8)}***` : 'anonymous',
    `error="${redactedMessage}"`
  );
  
  // Log stack trace in development only
  if (process.env.NODE_ENV === 'development' && error instanceof Error && error.stack) {
    console.error('Stack:', redactSecrets(error.stack));
  }
}

/**
 * Log configuration validation issues
 */
export function logConfigIssue(
  severity: 'error' | 'warning',
  category: string,
  message: string,
  envVar?: string
): void {
  const timestamp = new Date().toISOString();
  const icon = severity === 'error' ? '✗' : '⚠';
  const logger = severity === 'error' ? console.error : console.warn;
  
  logger(
    `${timestamp} [CONFIG ${severity.toUpperCase()}] ${icon} [${category}] ${message}`,
    envVar ? `(${envVar})` : ''
  );
}

/**
 * Log successful authentication
 */
export function logAuthSuccess(
  path: string,
  method: string,
  tokenType: 'clerk' | 'device',
  userId: string
): void {
  const timestamp = new Date().toISOString();
  console.log(
    `${timestamp} [AUTH SUCCESS] ${method} ${path}`,
    `type=${tokenType}`,
    `user=${userId.substring(0, 8)}***`
  );
}

/**
 * Redact secrets from any object for logging
 */
export function safeStringify(obj: unknown): string {
  try {
    const json = JSON.stringify(obj, (key, value) => {
      // Redact known secret keys
      if (typeof key === 'string' && /^(apiKey|token|secret|password|authorization|bearer|key|credential)$/i.test(key)) {
        return '***REDACTED***';
      }
      // Redact string values that look like secrets
      if (typeof value === 'string' && value.length > 20) {
        for (const pattern of SECRET_PATTERNS) {
          if (pattern.test(value)) {
            return '***REDACTED***';
          }
        }
      }
      return value;
    }, 2);
    return redactSecrets(json);
  } catch {
    return '[Serialization failed]';
  }
}
