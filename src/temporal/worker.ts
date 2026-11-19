import { DefaultLogger, NativeConnection, Runtime, Worker } from '@temporalio/worker';
import { env } from '../config/env';
import { closeRedisClient, getRedisClient } from '../redis/client';
import * as activities from './activities/hotel.activities';
import { errorMeta, logger } from '../utils/logger';

const log = logger.child({ component: 'temporal.worker' });

async function run(): Promise<void> {
  // Route Temporal SDK and workflow logs through the shared structured logger.
  Runtime.install({
    logger: new DefaultLogger('INFO', (entry) => {
      const level = entry.level.toLowerCase();
      const payload = { temporalLevel: entry.level, ...entry.meta };
      if (level === 'error') log.error(payload, entry.message);
      else if (level === 'warn') log.warn(payload, entry.message);
      else if (level === 'debug' || level === 'trace') log.debug(payload, entry.message);
      else log.info(payload, entry.message);
    }),
  });

  const connection = await NativeConnection.connect({ address: env.temporalAddress });

  // Open the Redis connection up front so the first activity does not pay for it.
  getRedisClient();

  const worker = await Worker.create({
    connection,
    namespace: env.temporalNamespace,
    taskQueue: env.temporalTaskQueue,
    workflowsPath: require.resolve('./workflows'),
    activities,
  });

  log.info(
    {
      address: env.temporalAddress,
      namespace: env.temporalNamespace,
      taskQueue: env.temporalTaskQueue,
      supplierABaseUrl: env.supplierABaseUrl,
      supplierBBaseUrl: env.supplierBBaseUrl,
    },
    'Temporal worker starting',
  );

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'Shutting down Temporal worker');
    worker.shutdown();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await worker.run();
  } finally {
    await connection.close().catch((error) => log.warn({ ...errorMeta(error) }, 'Worker connection close failed'));
    await closeRedisClient();
    log.info('Temporal worker stopped');
  }
}

run().catch((error) => {
  log.error({ ...errorMeta(error) }, 'Temporal worker crashed');
  process.exitCode = 1;
});
