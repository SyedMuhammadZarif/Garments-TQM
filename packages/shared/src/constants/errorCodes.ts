// SPEC §9.3. Each code maps to the HTTP status the API returns for it.
export const ERROR_CODES = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  OUT_OF_SCOPE: 404,
  NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  DRAFT_LOCKED: 409,
  DUPLICATE: 409,
  IDEMPOTENCY_MISMATCH: 422,
  RATE_LIMITED: 429,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA: 415,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export type ApiErrorBody = {
  error: { code: ErrorCode; message: string; details?: unknown };
};
