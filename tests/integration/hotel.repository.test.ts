import type { Redis as RedisClient } from 'ioredis';
import RedisMock from 'ioredis-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HotelRepository,
  dataKey,
  normalizeCity,
  priceIndexKey,
  toScoreBounds,
} from '../../src/redis/hotel.repository';
import { SUPPLIER_A, SUPPLIER_B, type HotelOffer } from '../../src/types/hotel.types';
import { RedisOperationError } from '../../src/utils/errors';

const DELHI_HOTELS: HotelOffer[] = [
  { name: 'The Imperial', price: 4800, supplier: SUPPLIER_A, commissionPct: 9 },
  { name: 'Holtin', price: 5340, supplier: SUPPLIER_B, commissionPct: 20 },
  { name: 'Radison', price: 5900, supplier: SUPPLIER_A, commissionPct: 13 },
  { name: 'The Leela', price: 7200, supplier: SUPPLIER_A, commissionPct: 11 },
  { name: 'Novotel', price: 7500, supplier: SUPPLIER_B, commissionPct: 12 },
  { name: 'Taj Palace', price: 9000, supplier: SUPPLIER_A, commissionPct: 15 },
];

describe('toScoreBounds', () => {
  it('uses infinite bounds for omitted limits', () => {
    expect(toScoreBounds({})).toEqual({ min: '-inf', max: '+inf' });
    expect(toScoreBounds({ minPrice: 5000 })).toEqual({ min: '5000', max: '+inf' });
    expect(toScoreBounds({ maxPrice: 7000 })).toEqual({ min: '-inf', max: '7000' });
    expect(toScoreBounds({ minPrice: 5000, maxPrice: 7000 })).toEqual({ min: '5000', max: '7000' });
  });
});

describe('Redis key layout', () => {
  it('derives city-scoped keys from the normalized city', () => {
    expect(priceIndexKey(' Delhi ')).toBe('hotels:delhi:prices');
    expect(dataKey('DELHI')).toBe('hotels:delhi:data');
    expect(normalizeCity('  New Delhi ')).toBe('new delhi');
  });
});

describe('HotelRepository', () => {
  let redis: RedisClient;
  let repository: HotelRepository;

  beforeEach(() => {
    redis = new RedisMock() as unknown as RedisClient;
    repository = new HotelRepository(redis, 120);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await redis.flushall();
  });

  it('stores a sorted set of prices and a hash of offers', async () => {
    const saved = await repository.saveCityHotels('delhi', DELHI_HOTELS);
    expect(saved).toBe(DELHI_HOTELS.length);

    const members = await redis.zrange(priceIndexKey('delhi'), 0, -1, 'WITHSCORES');
    expect(members).toEqual([
      'the imperial',
      '4800',
      'holtin',
      '5340',
      'radison',
      '5900',
      'the leela',
      '7200',
      'novotel',
      '7500',
      'taj palace',
      '9000',
    ]);

    const stored = await redis.hget(dataKey('delhi'), 'holtin');
    expect(stored === null ? null : JSON.parse(stored)).toEqual({
      name: 'Holtin',
      price: 5340,
      supplier: SUPPLIER_B,
      commissionPct: 20,
    });
  });

  it('applies the configured TTL to both keys', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);

    expect(await redis.ttl(priceIndexKey('delhi'))).toBeGreaterThan(0);
    expect(await redis.ttl(dataKey('delhi'))).toBeLessThanOrEqual(120);
  });

  it('returns every stored hotel price-ascending when no range is given', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);

    const hotels = await repository.findCityHotels('delhi');
    expect(hotels.map((hotel) => hotel.price)).toEqual([4800, 5340, 5900, 7200, 7500, 9000]);
  });

  it('filters by an inclusive min and max price via ZRANGEBYSCORE', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);
    const zrangebyscore = vi.spyOn(redis, 'zrangebyscore');

    const hotels = await repository.findCityHotels('delhi', { minPrice: 5000, maxPrice: 7000 });

    expect(zrangebyscore).toHaveBeenCalledWith('hotels:delhi:prices', '5000', '7000');
    expect(hotels).toEqual([
      { name: 'Holtin', price: 5340, supplier: SUPPLIER_B, commissionPct: 20 },
      { name: 'Radison', price: 5900, supplier: SUPPLIER_A, commissionPct: 13 },
    ]);
  });

  it('includes hotels sitting exactly on either boundary', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);

    const hotels = await repository.findCityHotels('delhi', { minPrice: 5340, maxPrice: 7200 });
    expect(hotels.map((hotel) => hotel.name)).toEqual(['Holtin', 'Radison', 'The Leela']);
  });

  it('filters with only a minimum price', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);

    const hotels = await repository.findCityHotels('delhi', { minPrice: 7500 });
    expect(hotels.map((hotel) => hotel.name)).toEqual(['Novotel', 'Taj Palace']);
  });

  it('filters with only a maximum price', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);

    const hotels = await repository.findCityHotels('delhi', { maxPrice: 5340 });
    expect(hotels.map((hotel) => hotel.name)).toEqual(['The Imperial', 'Holtin']);
  });

  it('returns an empty array when the range matches nothing', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);

    expect(await repository.findCityHotels('delhi', { minPrice: 20_000 })).toEqual([]);
  });

  it('returns an empty array for a city that was never stored', async () => {
    expect(await repository.findCityHotels('jaipur')).toEqual([]);
    expect(await repository.countCityHotels('jaipur')).toBe(0);
  });

  it('stores nothing for an empty hotel list and leaves no stale keys behind', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);
    await repository.saveCityHotels('delhi', []);

    expect(await repository.countCityHotels('delhi')).toBe(0);
    expect(await repository.findCityHotels('delhi')).toEqual([]);
    expect(await redis.exists(dataKey('delhi'))).toBe(0);
  });

  it('replaces the previous snapshot instead of merging into it', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);
    await repository.saveCityHotels('delhi', [
      { name: 'Holtin', price: 4000, supplier: SUPPLIER_A, commissionPct: 5 },
    ]);

    expect(await repository.findCityHotels('delhi')).toEqual([
      { name: 'Holtin', price: 4000, supplier: SUPPLIER_A, commissionPct: 5 },
    ]);
  });

  it('keeps cities isolated from each other', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);
    await repository.saveCityHotels('mumbai', [
      { name: 'Sea Breeze', price: 3990, supplier: SUPPLIER_B, commissionPct: 15 },
    ]);

    expect((await repository.findCityHotels('mumbai')).map((hotel) => hotel.name)).toEqual(['Sea Breeze']);
    expect(await repository.countCityHotels('delhi')).toBe(DELHI_HOTELS.length);
  });

  it('treats the city case-insensitively', async () => {
    await repository.saveCityHotels('Delhi', DELHI_HOTELS);
    expect(await repository.countCityHotels('  DELHI ')).toBe(DELHI_HOTELS.length);
  });

  it('skips index members whose hash record is missing', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);
    await redis.hdel(dataKey('delhi'), 'holtin');

    const names = (await repository.findCityHotels('delhi')).map((hotel) => hotel.name);
    expect(names).not.toContain('Holtin');
    expect(names).toHaveLength(DELHI_HOTELS.length - 1);
  });

  it('discards malformed stored records', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);
    await redis.hset(dataKey('delhi'), 'holtin', 'not-json');

    expect((await repository.findCityHotels('delhi')).map((hotel) => hotel.name)).not.toContain('Holtin');
  });

  it('deletes a city snapshot', async () => {
    await repository.saveCityHotels('delhi', DELHI_HOTELS);
    await repository.deleteCityHotels('delhi');

    expect(await repository.countCityHotels('delhi')).toBe(0);
  });

  it('answers a ping while connected', async () => {
    expect(await repository.ping()).toBe(true);
  });

  it('wraps read failures in RedisOperationError', async () => {
    vi.spyOn(redis, 'zrangebyscore').mockRejectedValue(new Error('connection reset') as never);

    await expect(repository.findCityHotels('delhi')).rejects.toBeInstanceOf(RedisOperationError);
  });

  it('wraps write failures in RedisOperationError', async () => {
    vi.spyOn(redis, 'multi').mockImplementation(() => {
      throw new Error('connection reset');
    });

    await expect(repository.saveCityHotels('delhi', DELHI_HOTELS)).rejects.toBeInstanceOf(RedisOperationError);
  });

  it('reports an unhealthy ping as false instead of throwing', async () => {
    vi.spyOn(redis, 'ping').mockRejectedValue(new Error('unreachable') as never);

    expect(await repository.ping()).toBe(false);
  });
});
