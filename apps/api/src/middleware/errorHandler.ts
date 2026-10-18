import type { ErrorRequestHandler } from 'express';
import { AppError, isUniqueViolation } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

// Last middleware: every error leaves as the §9.2 envelope. Unknown errors are logged and hidden.
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  let appErr: AppError;
  if (err instanceof AppError) appErr = err;
  else if (isUniqueViolation(err)) {
    appErr = new AppError('DUPLICATE', 'A record with the same code or name already exists', {
      constraint: err.constraint ?? null,
    });
  } else if (isBodyParserError(err)) {
    appErr =
      err.type === 'entity.too.large'
        ? new AppError('PAYLOAD_TOO_LARGE', 'Request body is too large')
        : new AppError('VALIDATION_FAILED', 'Request body is not valid JSON');
  } else {
    logger.error('unhandled error', {
      requestId: req.ctx?.requestId,
      path: req.path,
      err: err instanceof Error ? (err.stack ?? err.message) : String(err),
    });
    appErr = new AppError('INTERNAL', 'Something went wrong. Please try again.');
  }
  if (res.headersSent) return;
  res.status(appErr.status).json({
    error: { code: appErr.code, message: appErr.message, ...(appErr.details !== undefined ? { details: appErr.details } : {}) },
  });
};

function isBodyParserError(err: unknown): err is { type: string } {
  return typeof err === 'object' && err !== null && typeof (err as { type?: unknown }).type === 'string';
}
