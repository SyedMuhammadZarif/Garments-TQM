export const API_BASE_PATH = '/api/v1';

export type HealthStatus = {
  status: 'ok' | 'degraded';
  db: 'ok' | 'down';
  time: string;
};
