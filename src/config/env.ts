function str(name: string, fallback: string): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, received "${raw}"`);
  }
  return parsed;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const normalized = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new Error(`Environment variable ${name} must be a boolean, received "${raw}"`);
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  logLevel: str('LOG_LEVEL', 'info'),

  port: int('PORT', 3000),

  redisUrl: str('REDIS_URL', 'redis://localhost:6379'),
  /** TTL applied to a city's Redis snapshot (sorted set + hash). */
  hotelsTtlSeconds: int('HOTELS_TTL_SECONDS', 300),

  temporalAddress: str('TEMPORAL_ADDRESS', 'localhost:7233'),
  temporalNamespace: str('TEMPORAL_NAMESPACE', 'default'),
  temporalTaskQueue: str('TEMPORAL_TASK_QUEUE', 'hotel-offers-task-queue'),
  /** Upper bound for how long the API waits for a workflow to complete. */
  workflowExecutionTimeoutMs: int('WORKFLOW_EXECUTION_TIMEOUT_MS', 30_000),

  /** Base URLs the Temporal activities use to reach the mock supplier endpoints. */
  supplierABaseUrl: str('SUPPLIER_A_BASE_URL', 'http://localhost:3000'),
  supplierBBaseUrl: str('SUPPLIER_B_BASE_URL', 'http://localhost:3000'),
  supplierTimeoutMs: int('SUPPLIER_TIMEOUT_MS', 3_000),

  /** Outage simulation: a disabled supplier endpoint responds with HTTP 503. */
  supplierAEnabled: bool('SUPPLIER_A_ENABLED', true),
  supplierBEnabled: bool('SUPPLIER_B_ENABLED', true),
} as const;

export type Env = typeof env;
