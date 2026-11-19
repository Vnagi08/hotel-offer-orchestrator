export type ApiErrorCode =
  | 'MISSING_CITY'
  | 'INVALID_CITY'
  | 'INVALID_PRICE'
  | 'INVALID_PRICE_RANGE'
  | 'SUPPLIER_UNAVAILABLE'
  | 'SUPPLIERS_UNAVAILABLE'
  | 'WORKFLOW_FAILED'
  | 'REDIS_UNAVAILABLE'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class ApiError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;

  constructor(statusCode: number, code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
  }

  static badRequest(code: ApiErrorCode, message: string): ApiError {
    return new ApiError(400, code, message);
  }

  static notFound(message: string): ApiError {
    return new ApiError(404, 'NOT_FOUND', message);
  }

  toResponseBody(): { error: { code: ApiErrorCode; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}

/** Thrown by the Redis repository so route handlers can map storage faults to HTTP 503. */
export class RedisOperationError extends Error {
  readonly operation: string;

  constructor(operation: string, cause: unknown) {
    super(`Redis operation "${operation}" failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'RedisOperationError';
    this.operation = operation;
    this.cause = cause;
  }
}
