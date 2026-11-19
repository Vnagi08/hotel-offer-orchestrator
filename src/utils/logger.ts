import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.logLevel,
  base: { service: 'hotel-offer-orchestrator' },
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie'],
    remove: true,
  },
});

export type Logger = typeof logger;

export function errorMeta(error: unknown): { message: string; name: string } {
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error), name: 'UnknownError' };
}
