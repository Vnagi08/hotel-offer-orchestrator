import { ServiceError, WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import type { NextFunction, Request, Response } from 'express';
import { ApiError, RedisOperationError, type ApiErrorCode } from '../../utils/errors';
import { errorMeta, logger } from '../../utils/logger';

const log = logger.child({ component: 'error.middleware' });

interface MappedError {
  statusCode: number;
  code: ApiErrorCode;
  message: string;
}

function mapWorkflowFailure(error: WorkflowFailedError): MappedError {
  const cause = error.cause;
  if (cause instanceof ApplicationFailure && cause.type === 'BothSuppliersFailed') {
    return {
      statusCode: 502,
      code: 'SUPPLIERS_UNAVAILABLE',
      message: 'No supplier could be reached, so no hotel offers are available right now',
    };
  }
  return {
    statusCode: 502,
    code: 'WORKFLOW_FAILED',
    message: 'The hotel offers workflow did not complete successfully',
  };
}

export function mapError(error: unknown): MappedError {
  if (error instanceof ApiError) {
    return { statusCode: error.statusCode, code: error.code, message: error.message };
  }
  if (error instanceof RedisOperationError) {
    return { statusCode: 503, code: 'REDIS_UNAVAILABLE', message: 'Hotel storage is currently unavailable' };
  }
  if (error instanceof WorkflowFailedError) {
    return mapWorkflowFailure(error);
  }
  if (error instanceof ServiceError) {
    return {
      statusCode: 503,
      code: 'WORKFLOW_FAILED',
      message: 'The Temporal service is currently unavailable',
    };
  }
  return { statusCode: 500, code: 'INTERNAL_ERROR', message: 'Unexpected server error' };
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.path}` } });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const mapped = mapError(error);

  const logPayload = {
    method: req.method,
    path: req.path,
    statusCode: mapped.statusCode,
    code: mapped.code,
    ...errorMeta(error),
  };
  if (mapped.statusCode >= 500) {
    log.error(logPayload, 'Request failed');
  } else {
    log.warn(logPayload, 'Request rejected');
  }

  res.status(mapped.statusCode).json({ error: { code: mapped.code, message: mapped.message } });
}
