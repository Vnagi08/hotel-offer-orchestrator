import path from 'node:path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { DefaultLogger, Runtime, Worker } from '@temporalio/worker';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getHotelOffersWorkflow } from '../../src/temporal/workflows/hotel.workflow';
import type { HotelOffer, SupplierHotel } from '../../src/types/hotel.types';

const TASK_QUEUE = 'hotel-offers-test-queue';

const SUPPLIER_A_DELHI: SupplierHotel[] = [
  { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
  { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
  { hotelId: 'a4', name: '  The Leela  ', price: 7200, city: 'delhi', commissionPct: 11 },
  { hotelId: 'a5', name: 'HOLTIN', price: 6450, city: 'delhi', commissionPct: 8 },
];
const SUPPLIER_B_DELHI: SupplierHotel[] = [
  { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
  { hotelId: 'b3', name: 'Novotel', price: 7500, city: 'delhi', commissionPct: 12 },
  { hotelId: 'b4', name: 'The Leela', price: 7200, city: 'delhi', commissionPct: 17 },
];

interface ActivityStubs {
  failSupplierA?: boolean;
  failSupplierB?: boolean;
}

let testEnv: TestWorkflowEnvironment;

beforeAll(async () => {
  Runtime.install({ logger: new DefaultLogger('ERROR') });
  testEnv = await TestWorkflowEnvironment.createTimeSkipping();
}, 180_000);

afterAll(async () => {
  await testEnv?.teardown();
});

/** Runs the real workflow against stubbed activities; returns the workflow result and what was saved. */
async function runWorkflow(
  city: string,
  stubs: ActivityStubs = {},
): Promise<{ result: Awaited<ReturnType<typeof getHotelOffersWorkflow>>; saved: HotelOffer[] }> {
  const saved: HotelOffer[] = [];

  const worker = await Worker.create({
    connection: testEnv.nativeConnection,
    taskQueue: TASK_QUEUE,
    workflowsPath: path.resolve(__dirname, '../../src/temporal/workflows/index.ts'),
    activities: {
      fetchSupplierAHotels: async (requestedCity: string): Promise<SupplierHotel[]> => {
        if (stubs.failSupplierA === true) throw new Error('Supplier A responded with HTTP 503');
        return requestedCity === 'delhi' ? SUPPLIER_A_DELHI : [];
      },
      fetchSupplierBHotels: async (requestedCity: string): Promise<SupplierHotel[]> => {
        if (stubs.failSupplierB === true) throw new Error('Supplier B responded with HTTP 503');
        return requestedCity === 'delhi' ? SUPPLIER_B_DELHI : [];
      },
      saveHotelsToRedis: async (_requestedCity: string, hotels: HotelOffer[]): Promise<number> => {
        saved.splice(0, saved.length, ...hotels);
        return hotels.length;
      },
    },
  });

  const result = await worker.runUntil(
    testEnv.client.workflow.execute(getHotelOffersWorkflow, {
      taskQueue: TASK_QUEUE,
      workflowId: `test-hotel-offers-${city}-${Math.random().toString(36).slice(2)}`,
      args: [city],
    }),
  );

  return { result, saved };
}

describe('getHotelOffersWorkflow', () => {
  it('calls both suppliers, deduplicates and persists the cheapest offers', async () => {
    const { result, saved } = await runWorkflow('delhi');

    expect(result.partial).toBe(false);
    expect(result.suppliers).toEqual([
      { supplier: 'Supplier A', status: 'ok', offerCount: 4 },
      { supplier: 'Supplier B', status: 'ok', offerCount: 3 },
    ]);
    expect(result.rawOfferCount).toBe(7);
    expect(result.deduplicatedCount).toBe(4);
    expect(result.hotels).toEqual([
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
      { name: 'The Leela', price: 7200, supplier: 'Supplier A', commissionPct: 11 },
      { name: 'Novotel', price: 7500, supplier: 'Supplier B', commissionPct: 12 },
    ]);
    expect(saved).toEqual(result.hotels);
  });

  it('returns partial results when Supplier A is unavailable', async () => {
    const { result, saved } = await runWorkflow('delhi', { failSupplierA: true });

    expect(result.partial).toBe(true);
    expect(result.suppliers[0]?.status).toBe('failed');
    expect(result.suppliers[0]?.error).toContain('Supplier A');
    expect(result.suppliers[1]).toEqual({ supplier: 'Supplier B', status: 'ok', offerCount: 3 });
    expect(result.hotels.every((hotel) => hotel.supplier === 'Supplier B')).toBe(true);
    expect(saved).toHaveLength(3);
  });

  it('returns partial results when Supplier B is unavailable', async () => {
    const { result } = await runWorkflow('delhi', { failSupplierB: true });

    expect(result.partial).toBe(true);
    expect(result.suppliers[1]?.status).toBe('failed');
    expect(result.hotels.every((hotel) => hotel.supplier === 'Supplier A')).toBe(true);
    // Supplier A's own duplicate "HOLTIN" entry is still collapsed.
    expect(result.hotels.map((hotel) => hotel.name)).toEqual(['Radison', 'Holtin', 'The Leela']);
  });

  it('fails the workflow when both suppliers are unavailable', async () => {
    const { WorkflowFailedError } = await import('@temporalio/client');
    const { ApplicationFailure } = await import('@temporalio/common');

    const failure = await runWorkflow('delhi', { failSupplierA: true, failSupplierB: true }).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(WorkflowFailedError);
    const cause = (failure as InstanceType<typeof WorkflowFailedError>).cause;
    expect(cause).toBeInstanceOf(ApplicationFailure);
    expect((cause as InstanceType<typeof ApplicationFailure>).type).toBe('BothSuppliersFailed');
    expect(cause?.message).toContain('Both suppliers failed');
  });

  it('persists an empty snapshot for a city neither supplier covers', async () => {
    const { result, saved } = await runWorkflow('jaipur');

    expect(result.partial).toBe(false);
    expect(result.deduplicatedCount).toBe(0);
    expect(result.hotels).toEqual([]);
    expect(saved).toEqual([]);
  });
});
