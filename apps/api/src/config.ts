// Reads and validates environment variables once at startup (SPEC §22.3).
// Problems are collected and reported together so a bad .env is fixed in one pass.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type Config = {
  nodeEnv: 'development' | 'test' | 'production';
  appName: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  accessTokenTtlSec: number;
  refreshTokenTtlDays: number;
  uploadDir: string;
  archiveDir: string;
  workerEnabled: boolean;
  corsDevOrigin: string;
  publicBaseUrl: string;
  logLevel: LogLevel;
  deepseek: { apiKey: string | null; baseUrl: string; model: string };
};

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const read = (key: string, fallback?: string): string => {
    const raw = env[key]?.trim();
    if (raw) return raw;
    if (fallback !== undefined) return fallback;
    problems.push(`${key} is required`);
    return '';
  };

  const oneOf = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
    const value = read(key, fallback);
    if ((allowed as readonly string[]).includes(value)) return value as T;
    problems.push(`${key} must be one of ${allowed.join(', ')} (got "${value}")`);
    return fallback;
  };

  const int = (key: string, fallback: number, min: number, max: number): number => {
    const value = read(key, String(fallback));
    const n = Number(value);
    if (Number.isInteger(n) && n >= min && n <= max) return n;
    problems.push(`${key} must be an integer between ${min} and ${max} (got "${value}")`);
    return fallback;
  };

  const bool = (key: string, fallback: boolean): boolean => {
    const value = read(key, String(fallback)).toLowerCase();
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    problems.push(`${key} must be true or false (got "${value}")`);
    return fallback;
  };

  const url = (key: string, fallback: string | undefined, protocols: string[]): string => {
    const value = read(key, fallback);
    if (!value) return value;
    try {
      const parsed = new URL(value);
      if (!protocols.includes(parsed.protocol)) {
        problems.push(`${key} must use ${protocols.join(' or ')} (got "${parsed.protocol}")`);
      }
    } catch {
      problems.push(`${key} is not a valid URL`);
    }
    return value;
  };

  const nodeEnv = oneOf('NODE_ENV', ['development', 'test', 'production'] as const, 'development');

  const jwtSecret = read('JWT_SECRET');
  if (jwtSecret && Buffer.byteLength(jwtSecret, 'utf8') < 32) {
    problems.push('JWT_SECRET must be at least 32 bytes');
  }
  if (nodeEnv === 'production' && jwtSecret.startsWith('change-me')) {
    problems.push('JWT_SECRET still has the example value; generate a random secret for production');
  }

  const deepseekKey = env.DEEPSEEK_API_KEY?.trim() ?? '';

  const config: Config = {
    nodeEnv,
    appName: read('APP_NAME', 'Novabe Garments TQM'),
    port: int('PORT', 4000, 1, 65535),
    databaseUrl: url('DATABASE_URL', undefined, ['postgres:', 'postgresql:']),
    jwtSecret,
    accessTokenTtlSec: int('ACCESS_TOKEN_TTL_SEC', 900, 60, 86400),
    refreshTokenTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 30, 1, 365),
    uploadDir: read('UPLOAD_DIR', './data/uploads'),
    archiveDir: read('ARCHIVE_DIR', './data/archive'),
    workerEnabled: bool('WORKER_ENABLED', true),
    corsDevOrigin: url('CORS_DEV_ORIGIN', 'http://localhost:5173', ['http:', 'https:']),
    publicBaseUrl: url('PUBLIC_BASE_URL', 'http://localhost:5173', ['http:', 'https:']),
    logLevel: oneOf('LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const, 'info'),
    deepseek: {
      apiKey: deepseekKey === '' ? null : deepseekKey,
      baseUrl: url('DEEPSEEK_BASE_URL', 'https://api.deepseek.com', ['https:']),
      model: read('DEEPSEEK_MODEL', 'deepseek-chat'),
    },
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}
