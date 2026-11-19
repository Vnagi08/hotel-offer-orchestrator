import Redis, { type Redis as RedisClient, type RedisOptions } from 'ioredis';
import { env } from '../config/env';
import { errorMeta, logger } from '../utils/logger';

const log = logger.child({ component: 'redis' });

const options: RedisOptions = {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  retryStrategy: (times) => Math.min(times * 200, 2_000),
};

let client: RedisClient | undefined;

export function getRedisClient(): RedisClient {
  if (client === undefined) {
    client = new Redis(env.redisUrl, options);
    client.on('error', (error) => log.error({ ...errorMeta(error) }, 'Redis client error'));
    client.on('connect', () => log.info({ url: redactRedisUrl(env.redisUrl) }, 'Redis connected'));
    client.on('close', () => log.warn('Redis connection closed'));
  }
  return client;
}

export async function closeRedisClient(): Promise<void> {
  if (client === undefined) return;
  const current = client;
  client = undefined;
  await current.quit().catch((error) => log.warn({ ...errorMeta(error) }, 'Redis quit failed'));
}

/** Strips credentials so connection strings can be logged safely. */
export function redactRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return 'redis://<unparsable-url>';
  }
}
