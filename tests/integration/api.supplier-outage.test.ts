import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Express } from 'express';

// Simulated outage: Supplier A is switched off through configuration.
process.env['SUPPLIER_A_ENABLED'] = 'false';
process.env['SUPPLIER_B_ENABLED'] = 'true';

vi.mock('../../src/redis/client', async () => {
  const { default: RedisMock } = await import('ioredis-mock');
  const client = new RedisMock();
  return {
    getRedisClient: () => client,
    closeRedisClient: async () => undefined,
    redactRedisUrl: (url: string) => url,
  };
});

vi.mock('../../src/temporal/client', () => ({
  executeHotelOffersWorkflow: async () => {
    throw new Error('not used in this test');
  },
  checkTemporalHealth: async () => true,
  closeTemporalClient: async () => undefined,
  getTemporalClient: async () => {
    throw new Error('not used in this test');
  },
}));

let app: Express;

beforeAll(async () => {
  const { createApp } = await import('../../src/api/app');
  app = createApp();
});

describe('supplier outage simulation', () => {
  it('returns HTTP 503 from the disabled Supplier A endpoint', async () => {
    const response = await request(app).get('/supplierA/hotels?city=delhi').expect(503);

    expect(response.body).toEqual({
      error: { code: 'SUPPLIER_UNAVAILABLE', message: 'Supplier A is currently unavailable' },
    });
  });

  it('keeps the enabled Supplier B endpoint serving its catalogue', async () => {
    const response = await request(app).get('/supplierB/hotels?city=delhi').expect(200);

    expect(response.body).toHaveLength(6);
  });

  it('reports the disabled supplier on the health endpoint while staying usable', async () => {
    const response = await request(app).get('/health').expect(200);

    expect(response.body.status).toBe('degraded');
    expect(response.body.checks.supplierA).toEqual({
      status: 'disabled',
      detail: 'Supplier A is disabled by configuration',
    });
    expect(response.body.checks.redis.status).toBe('healthy');
    expect(response.body.checks.temporal.status).toBe('healthy');
  });
});
