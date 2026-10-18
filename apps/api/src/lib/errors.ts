import { ERROR_CODES, type ErrorCode } from '@tqm/shared';

// Thrown anywhere in the API; errorHandler turns it into the §9.2 error envelope.
export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.status = ERROR_CODES[code];
  }
}

export const notFound = (what = 'Record'): AppError => new AppError('NOT_FOUND', `${what} not found`);
export const forbidden = (message = 'You do not have permission to do this'): AppError =>
  new AppError('FORBIDDEN', message);
export const versionConflict = (current: unknown): AppError =>
  new AppError('VERSION_CONFLICT', 'Someone else changed this record. Reload to see the latest version.', { current });
export const validationFailed = (issues: { path: string; code: string; message: string }[]): AppError =>
  new AppError('VALIDATION_FAILED', 'Some fields are invalid', { issues });

/** Postgres unique violation → DUPLICATE with the constraint name for the UI. */
export function isUniqueViolation(err: unknown): err is { code: string; constraint?: string } {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}
