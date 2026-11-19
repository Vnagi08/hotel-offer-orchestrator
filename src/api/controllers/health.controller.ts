import type { Request, Response } from 'express';
import { env } from '../../config/env';
import { getRedisClient } from '../../redis/client';
import { HotelRepository } from '../../redis/hotel.repository';
import { checkTemporalHealth } from '../../temporal/client';
import { errorMeta, logger } from '../../utils/logger';

const log = logger.child({ component: 'health.controller' });

type CheckStatus = 'healthy' | 'unhealthy' | 'disabled';

interface CheckResult {
  status: CheckStatus;
  detail?: string;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: {
    supplierA: CheckResult;
    supplierB: CheckResult;
    redis: CheckResult;
    temporal: CheckResult;
  };
  uptimeSeconds: number;
}

const HEALTH_PROBE_CITY = 'delhi';

async function probeSupplier(
  supplier: string,
  enabled: boolean,
  baseUrl: string,
  path: string,
): Promise<CheckResult> {
  if (!enabled) {
    return { status: 'disabled', detail: `${supplier} is disabled by configuration` };
  }

  const url = new URL(path, baseUrl);
  url.searchParams.set('city', HEALTH_PROBE_CITY);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(env.supplierTimeoutMs),
    });
    if (!response.ok) {
      return { status: 'unhealthy', detail: `${supplier} responded with HTTP ${response.status}` };
    }
    return { status: 'healthy' };
  } catch (error) {
    return { status: 'unhealthy', detail: `${supplier} unreachable: ${errorMeta(error).message}` };
  }
}

async function probeRedis(): Promise<CheckResult> {
  const repository = new HotelRepository(getRedisClient());
  const reachable = await repository.ping();
  return reachable ? { status: 'healthy' } : { status: 'unhealthy', detail: 'Redis did not answer PING' };
}

async function probeTemporal(): Promise<CheckResult> {
  const reachable = await checkTemporalHealth();
  return reachable
    ? { status: 'healthy' }
    : { status: 'unhealthy', detail: `Temporal frontend unreachable at ${env.temporalAddress}` };
}

export async function getHealth(_req: Request, res: Response): Promise<void> {
  const [supplierA, supplierB, redis, temporal] = await Promise.all([
    probeSupplier('Supplier A', env.supplierAEnabled, env.supplierABaseUrl, '/supplierA/hotels'),
    probeSupplier('Supplier B', env.supplierBEnabled, env.supplierBBaseUrl, '/supplierB/hotels'),
    probeRedis(),
    probeTemporal(),
  ]);

  const checks = { supplierA, supplierB, redis, temporal };
  const degraded = Object.values(checks).some((check) => check.status !== 'healthy');
  // Suppliers may be down without the API being unusable (Temporal returns partial
  // results), so only the infrastructure dependencies drive the HTTP status code.
  const unusable = redis.status !== 'healthy' || temporal.status !== 'healthy';
  const body: HealthResponse = {
    status: degraded ? 'degraded' : 'ok',
    checks,
    uptimeSeconds: Math.round(process.uptime()),
  };

  log.info({ status: body.status, checks }, 'Health check executed');
  res.status(unusable ? 503 : 200).json(body);
}
