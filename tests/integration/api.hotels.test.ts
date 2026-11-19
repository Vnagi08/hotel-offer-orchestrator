import { ApplicationFailure } from '@temporalio/common';
import type { Express } from 'express';
import RedisMock from 'ioredis-mock';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HotelOffersWorkflowResult } from '../../src/types/hotel.types';

const redis = new RedisMock();

vi.mock('../../src/redis/client', () => ({
  getRedisClient: () => redis,
  closeRedisClient: async () => undefined,
  redactRedisUrl: (url: string) => url,
}));

const executeHotelOffersWorkflow = vi.fn<(city: string, requestId: string) => Promise<HotelOffersWorkflowResult>>();

vi.mock('../../src/temporal/client', () => ({
  executeHotelOffersWorkflow: (city: string, requestId: string) => executeHotelOffersWorkflow(city, requestId),
  checkTemporalHealth: async () => true,
  closeTemporalClient: async () => undefined,
  getTemporalClient: async () => {
    throw new Error('not used in this test');
  },
}));

/**
 * Stand-in for the Temporal worker: runs the same comparison logic the workflow runs
 * and persists the result through the real Redis repository, so the HTTP layer,
 * the service and the Redis filtering are exercised end to end.
 */
async function runWorkflowLocally(city: string): Promise<HotelOffersWorkflowResult> {
  const { compareAndDeduplicate } = await import('../../src/services/comparison.service');
  const { HotelRepository } = await import('../../src/redis/hotel.repository');
  const { getSupplierAHotels } = await import('../../src/suppliers/supplierA.data');
  const { getSupplierBHotels } = await import('../../src/suppliers/supplierB.data');
  const { SUPPLIER_A, SUPPLIER_B } = await import('../../src/types/hotel.types');

  const supplierA = getSupplierAHotels(city);
  const supplierB = getSupplierBHotels(city);
  const hotels = compareAndDeduplicate(supplierA, supplierB);

  await new HotelRepository(redis as never).saveCityHotels(city, hotels);

  return {
    city,
    partial: false,
    suppliers: [
      { supplier: SUPPLIER_A, status: 'ok', offerCount: supplierA.length },
      { supplier: SUPPLIER_B, status: 'ok', offerCount: supplierB.length },
    ],
    rawOfferCount: supplierA.length + supplierB.length,
    deduplicatedCount: hotels.length,
    hotels,
  };
}

let app: Express;

beforeEach(async () => {
  executeHotelOffersWorkflow.mockReset();
  executeHotelOffersWorkflow.mockImplementation((city) => runWorkflowLocally(city));
  const { createApp } = await import('../../src/api/app');
  app = createApp();
});

afterEach(async () => {
  await redis.flushall();
});

describe('GET /api/hotels', () => {
  it('returns the deduplicated, price-ascending offer list for a city', async () => {
    const response = await request(app).get('/api/hotels?city=delhi').expect(200);

    expect(response.body).toEqual([
      { name: 'The Imperial', price: 4800, supplier: 'Supplier A', commissionPct: 9 },
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
      { name: 'The Leela', price: 7200, supplier: 'Supplier A', commissionPct: 11 },
      { name: 'Novotel', price: 7500, supplier: 'Supplier B', commissionPct: 12 },
      { name: 'Taj Palace', price: 9000, supplier: 'Supplier A', commissionPct: 15 },
      { name: 'The Oberoi', price: 11000, supplier: 'Supplier B', commissionPct: 14 },
    ]);
  });

  it('exposes only the four public fields', async () => {
    const response = await request(app).get('/api/hotels?city=delhi').expect(200);

    for (const hotel of response.body as Record<string, unknown>[]) {
      expect(Object.keys(hotel).sort()).toEqual(['commissionPct', 'name', 'price', 'supplier']);
    }
  });

  it('starts one workflow per request with the normalized city', async () => {
    await request(app).get('/api/hotels?city=%20Delhi%20').expect(200);

    expect(executeHotelOffersWorkflow).toHaveBeenCalledTimes(1);
    expect(executeHotelOffersWorkflow.mock.calls[0]?.[0]).toBe('delhi');
  });

  it('gives each request a distinct workflow request id', async () => {
    await request(app).get('/api/hotels?city=delhi').expect(200);
    await request(app).get('/api/hotels?city=delhi').expect(200);

    const [first, second] = executeHotelOffersWorkflow.mock.calls.map((call) => call[1]);
    expect(first).not.toBe(second);
  });

  it('filters by an inclusive min and max price', async () => {
    const response = await request(app).get('/api/hotels?city=delhi&minPrice=5000&maxPrice=7000').expect(200);

    expect(response.body).toEqual([
      { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
      { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
    ]);
  });

  it('filters with only a minimum price', async () => {
    const response = await request(app).get('/api/hotels?city=delhi&minPrice=9000').expect(200);

    expect(response.body.map((hotel: { name: string }) => hotel.name)).toEqual(['Taj Palace', 'The Oberoi']);
  });

  it('filters with only a maximum price', async () => {
    const response = await request(app).get('/api/hotels?city=delhi&maxPrice=5340').expect(200);

    expect(response.body.map((hotel: { name: string }) => hotel.name)).toEqual(['The Imperial', 'Holtin']);
  });

  it('includes hotels priced exactly on the boundaries', async () => {
    const response = await request(app).get('/api/hotels?city=delhi&minPrice=4800&maxPrice=4800').expect(200);

    expect(response.body).toEqual([
      { name: 'The Imperial', price: 4800, supplier: 'Supplier A', commissionPct: 9 },
    ]);
  });

  it('returns an empty array for a city neither supplier covers', async () => {
    const response = await request(app).get('/api/hotels?city=jaipur').expect(200);

    expect(response.body).toEqual([]);
  });

  it('never returns duplicate hotel names', async () => {
    const response = await request(app).get('/api/hotels?city=delhi').expect(200);

    const names = (response.body as { name: string }[]).map((hotel) => hotel.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });

  it('rejects a missing city with HTTP 400 MISSING_CITY', async () => {
    const response = await request(app).get('/api/hotels').expect(400);

    expect(response.body).toEqual({ error: { code: 'MISSING_CITY', message: expect.any(String) } });
    expect(executeHotelOffersWorkflow).not.toHaveBeenCalled();
  });

  it('rejects an invalid city with HTTP 400 INVALID_CITY', async () => {
    const response = await request(app).get('/api/hotels?city=123').expect(400);

    expect(response.body.error.code).toBe('INVALID_CITY');
  });

  it('rejects a negative price with HTTP 400 INVALID_PRICE', async () => {
    const response = await request(app).get('/api/hotels?city=delhi&minPrice=-1').expect(400);

    expect(response.body.error.code).toBe('INVALID_PRICE');
  });

  it('rejects a non-numeric price with HTTP 400 INVALID_PRICE', async () => {
    const response = await request(app).get('/api/hotels?city=delhi&maxPrice=cheap').expect(400);

    expect(response.body.error.code).toBe('INVALID_PRICE');
  });

  it('rejects minPrice greater than maxPrice with HTTP 400 INVALID_PRICE_RANGE', async () => {
    const response = await request(app).get('/api/hotels?city=delhi&minPrice=9000&maxPrice=5000').expect(400);

    expect(response.body).toEqual({
      error: { code: 'INVALID_PRICE_RANGE', message: 'minPrice cannot be greater than maxPrice' },
    });
  });

  it('maps a both-suppliers-failed workflow failure to HTTP 502', async () => {
    const { WorkflowFailedError } = await import('@temporalio/client');
    executeHotelOffersWorkflow.mockRejectedValue(
      new WorkflowFailedError(
        'Workflow execution failed',
        ApplicationFailure.create({ message: 'Both suppliers failed', type: 'BothSuppliersFailed' }),
        'NON_RETRYABLE_FAILURE',
      ),
    );

    const response = await request(app).get('/api/hotels?city=delhi').expect(502);

    expect(response.body.error.code).toBe('SUPPLIERS_UNAVAILABLE');
  });

  it('maps any other workflow failure to HTTP 502 WORKFLOW_FAILED', async () => {
    const { WorkflowFailedError } = await import('@temporalio/client');
    executeHotelOffersWorkflow.mockRejectedValue(
      new WorkflowFailedError(
        'Workflow execution failed',
        ApplicationFailure.create({ message: 'activity exploded', type: 'SomethingElse' }),
        'NON_RETRYABLE_FAILURE',
      ),
    );

    const response = await request(app).get('/api/hotels?city=delhi').expect(502);

    expect(response.body.error.code).toBe('WORKFLOW_FAILED');
  });

  it('maps a Redis failure to HTTP 503 REDIS_UNAVAILABLE', async () => {
    const { RedisOperationError } = await import('../../src/utils/errors');
    executeHotelOffersWorkflow.mockRejectedValue(new RedisOperationError('saveCityHotels', new Error('down')));

    const response = await request(app).get('/api/hotels?city=delhi').expect(503);

    expect(response.body.error.code).toBe('REDIS_UNAVAILABLE');
  });

  it('maps an unexpected failure to HTTP 500 INTERNAL_ERROR', async () => {
    executeHotelOffersWorkflow.mockRejectedValue(new Error('boom'));

    const response = await request(app).get('/api/hotels?city=delhi').expect(500);

    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });
});

describe('mock supplier endpoints', () => {
  it('serves the Supplier A catalogue', async () => {
    const response = await request(app).get('/supplierA/hotels?city=delhi').expect(200);

    expect(response.body).toHaveLength(6);
    expect(response.body[0]).toEqual({
      hotelId: 'a1',
      name: 'Holtin',
      price: 6000,
      city: 'delhi',
      commissionPct: 10,
    });
  });

  it('serves the Supplier B catalogue', async () => {
    const response = await request(app).get('/supplierB/hotels?city=delhi').expect(200);

    expect(response.body).toHaveLength(6);
    expect(response.body.map((hotel: { hotelId: string }) => hotel.hotelId)).toContain('b3');
  });

  it('returns an empty array for an unsupported city', async () => {
    await request(app).get('/supplierA/hotels?city=paris').expect(200, []);
    await request(app).get('/supplierB/hotels?city=paris').expect(200, []);
  });

  it('validates the city parameter', async () => {
    const response = await request(app).get('/supplierA/hotels').expect(400);
    expect(response.body.error.code).toBe('MISSING_CITY');
  });
});

describe('unknown routes', () => {
  it('returns a structured 404', async () => {
    const response = await request(app).get('/nope').expect(404);

    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
