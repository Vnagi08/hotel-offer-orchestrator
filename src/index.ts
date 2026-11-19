import { createApp } from './api/app';
import { env } from './config/env';
import { closeRedisClient, getRedisClient } from './redis/client';
import { closeTemporalClient, getTemporalClient } from './temporal/client';
import { errorMeta, logger } from './utils/logger';

const log = logger.child({ component: 'bootstrap' });

async function main(): Promise<void> {
  const app = createApp();

  // Fail fast on unusable infrastructure instead of surfacing it per request.
  getRedisClient();
  await getTemporalClient();

  const server = app.listen(env.port, () => {
    log.info(
      {
        port: env.port,
        nodeEnv: env.nodeEnv,
        temporalAddress: env.temporalAddress,
        taskQueue: env.temporalTaskQueue,
        supplierAEnabled: env.supplierAEnabled,
        supplierBEnabled: env.supplierBEnabled,
      },
      'Hotel Offer Orchestrator API listening',
    );
  });

  const shutdown = (signal: string): void => {
    log.info({ signal }, 'Shutting down API');
    server.close(async () => {
      await closeTemporalClient();
      await closeRedisClient();
      log.info('API stopped');
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  log.error({ ...errorMeta(error) }, 'API failed to start');
  process.exitCode = 1;
});
