import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import { compareAndDeduplicate } from '../../services/comparison.service';
import {
  SUPPLIER_A,
  SUPPLIER_B,
  type HotelOffersWorkflowResult,
  type SupplierCallReport,
  type SupplierHotel,
  type SupplierName,
} from '../../types/hotel.types';
import type * as activities from '../activities/hotel.activities';

const { fetchSupplierAHotels, fetchSupplierBHotels } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  scheduleToCloseTimeout: '30 seconds',
  retry: {
    initialInterval: '200 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '2 seconds',
    maximumAttempts: 3,
  },
});

const { saveHotelsToRedis } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  scheduleToCloseTimeout: '40 seconds',
  retry: {
    initialInterval: '200 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '2 seconds',
    maximumAttempts: 5,
  },
});

/**
 * Temporal wraps an activity error as ActivityFailure → ApplicationFailure → original
 * message, so the useful text sits at the end of the cause chain.
 */
function describeFailure(reason: unknown): string {
  if (!(reason instanceof Error)) return String(reason);

  const messages: string[] = [];
  let current: unknown = reason;
  while (current instanceof Error) {
    if (current.message !== '' && !messages.includes(current.message)) messages.push(current.message);
    current = current.cause;
  }
  return messages[messages.length - 1] ?? reason.message;
}

function describeOutcome(
  supplier: SupplierName,
  outcome: PromiseSettledResult<SupplierHotel[]>,
): SupplierCallReport {
  if (outcome.status === 'fulfilled') {
    return { supplier, status: 'ok', offerCount: outcome.value.length };
  }
  return { supplier, status: 'failed', offerCount: 0, error: describeFailure(outcome.reason) };
}

function hotelsOf(outcome: PromiseSettledResult<SupplierHotel[]>): SupplierHotel[] {
  return outcome.status === 'fulfilled' ? outcome.value : [];
}

/**
 * Orchestrates a single city lookup:
 * both supplier activities run concurrently, their results are deduplicated by the
 * deterministic comparison logic, and the surviving offers are persisted to Redis.
 *
 * One failing supplier yields partial results; two failing suppliers fail the workflow.
 */
export async function getHotelOffersWorkflow(city: string): Promise<HotelOffersWorkflowResult> {
  log.info('Hotel offers workflow started', { city });

  const [supplierAOutcome, supplierBOutcome] = await Promise.allSettled([
    fetchSupplierAHotels(city),
    fetchSupplierBHotels(city),
  ]);

  const suppliers = [
    describeOutcome(SUPPLIER_A, supplierAOutcome),
    describeOutcome(SUPPLIER_B, supplierBOutcome),
  ];
  const failed = suppliers.filter((report) => report.status === 'failed');

  if (failed.length === suppliers.length) {
    log.error('Both suppliers failed; failing the workflow', {
      city,
      errors: failed.map((report) => `${report.supplier}: ${report.error ?? 'unknown error'}`),
    });
    throw ApplicationFailure.create({
      message: `Both suppliers failed for city "${city}"`,
      type: 'BothSuppliersFailed',
      nonRetryable: true,
      details: [suppliers],
    });
  }

  const partial = failed.length > 0;
  if (partial) {
    log.warn('Continuing with partial supplier results', {
      city,
      failedSuppliers: failed.map((report) => report.supplier),
      errors: failed.map((report) => report.error ?? 'unknown error'),
    });
  }

  const supplierAHotels = hotelsOf(supplierAOutcome);
  const supplierBHotels = hotelsOf(supplierBOutcome);
  const rawOfferCount = supplierAHotels.length + supplierBHotels.length;
  const hotels = compareAndDeduplicate(supplierAHotels, supplierBHotels);

  log.info('Comparison and deduplication completed', {
    city,
    supplierACount: supplierAHotels.length,
    supplierBCount: supplierBHotels.length,
    rawOfferCount,
    deduplicatedCount: hotels.length,
    removedCount: rawOfferCount - hotels.length,
  });

  const savedCount = await saveHotelsToRedis(city, hotels);

  log.info('Hotel offers workflow completed', { city, partial, savedCount });

  return {
    city,
    partial,
    suppliers,
    rawOfferCount,
    deduplicatedCount: hotels.length,
    hotels,
  };
}
