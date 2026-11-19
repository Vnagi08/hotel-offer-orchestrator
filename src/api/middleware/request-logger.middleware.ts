import type { NextFunction, Request, Response } from 'express';
import { logger } from '../../utils/logger';

const log = logger.child({ component: 'http' });

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();

  res.on('finish', () => {
    log.info(
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      },
      'Request completed',
    );
  });

  next();
}
