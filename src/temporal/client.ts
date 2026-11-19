import { Client, Connection, type WorkflowHandle } from '@temporalio/client';
import { env } from '../config/env';
import type { HotelOffersWorkflowResult } from '../types/hotel.types';
import { errorMeta, logger } from '../utils/logger';
import type { getHotelOffersWorkflow } from './workflows/hotel.workflow';

const log = logger.child({ component: 'temporal.client' });

let connection: Connection | undefined;
let client: Client | undefined;

export async function getTemporalClient(): Promise<Client> {
  if (client === undefined) {
    connection = await Connection.connect({ address: env.temporalAddress });
    client = new Client({ connection, namespace: env.temporalNamespace });
    log.info(
      { address: env.temporalAddress, namespace: env.temporalNamespace, taskQueue: env.temporalTaskQueue },
      'Temporal client connected',
    );
  }
  return client;
}

export async function closeTemporalClient(): Promise<void> {
  const current = connection;
  connection = undefined;
  client = undefined;
  if (current !== undefined) {
    await current.close().catch((error) => log.warn({ ...errorMeta(error) }, 'Temporal connection close failed'));
  }
}

/** Reports whether the Temporal frontend answers a system-info request. */
export async function checkTemporalHealth(): Promise<boolean> {
  try {
    const temporal = await getTemporalClient();
    await temporal.connection.workflowService.getSystemInfo({});
    return true;
  } catch (error) {
    log.warn({ ...errorMeta(error) }, 'Temporal health check failed');
    return false;
  }
}

/** Unique per request so concurrent lookups for the same city never collide. */
export function buildWorkflowId(city: string, requestId: string): string {
  return `hotel-offers-${city.trim().toLowerCase().replace(/\s+/g, '-')}-${requestId}`;
}

export async function startHotelOffersWorkflow(
  city: string,
  requestId: string,
): Promise<WorkflowHandle<typeof getHotelOffersWorkflow>> {
  const temporal = await getTemporalClient();
  const workflowId = buildWorkflowId(city, requestId);

  const handle = await temporal.workflow.start<typeof getHotelOffersWorkflow>('getHotelOffersWorkflow', {
    taskQueue: env.temporalTaskQueue,
    workflowId,
    args: [city],
    workflowExecutionTimeout: env.workflowExecutionTimeoutMs,
  });

  log.info({ city, workflowId, runId: handle.firstExecutionRunId }, 'Temporal workflow started');
  return handle;
}

export async function executeHotelOffersWorkflow(
  city: string,
  requestId: string,
): Promise<HotelOffersWorkflowResult> {
  const handle = await startHotelOffersWorkflow(city, requestId);
  return handle.result();
}
