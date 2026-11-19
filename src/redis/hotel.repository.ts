import type { Redis as RedisClient } from 'ioredis';
import { env } from '../config/env';
import { normalizeHotelName } from '../services/comparison.service';
import type { HotelOffer, PriceRange, SupplierName } from '../types/hotel.types';
import { RedisOperationError } from '../utils/errors';
import { errorMeta, logger } from '../utils/logger';

const log = logger.child({ component: 'hotel.repository' });

export function normalizeCity(city: string): string {
  return city.trim().toLowerCase();
}

export function priceIndexKey(city: string): string {
  return `hotels:${normalizeCity(city)}:prices`;
}

export function dataKey(city: string): string {
  return `hotels:${normalizeCity(city)}:data`;
}

/** Lower/upper bound strings for ZRANGEBYSCORE; both bounds are inclusive. */
export function toScoreBounds(range: PriceRange): { min: string; max: string } {
  return {
    min: range.minPrice === undefined ? '-inf' : String(range.minPrice),
    max: range.maxPrice === undefined ? '+inf' : String(range.maxPrice),
  };
}

function parseStoredOffer(raw: string): HotelOffer | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined;
  const candidate = parsed as Partial<HotelOffer>;
  if (
    typeof candidate.name !== 'string' ||
    typeof candidate.price !== 'number' ||
    typeof candidate.commissionPct !== 'number' ||
    typeof candidate.supplier !== 'string'
  ) {
    return undefined;
  }
  return {
    name: candidate.name,
    price: candidate.price,
    supplier: candidate.supplier as SupplierName,
    commissionPct: candidate.commissionPct,
  };
}

/**
 * Redis-backed store for a city's deduplicated hotel snapshot.
 *
 * - `hotels:<city>:prices` sorted set — member = normalized name, score = price.
 * - `hotels:<city>:data`   hash       — field  = normalized name, value = JSON offer.
 *
 * Price filtering is executed by Redis itself (ZRANGEBYSCORE), never in application memory.
 */
export class HotelRepository {
  private readonly redis: RedisClient;
  private readonly ttlSeconds: number;

  constructor(redis: RedisClient, ttlSeconds: number = env.hotelsTtlSeconds) {
    this.redis = redis;
    this.ttlSeconds = ttlSeconds;
  }

  /** Atomically replaces the stored snapshot for a city. */
  async saveCityHotels(city: string, hotels: readonly HotelOffer[]): Promise<number> {
    const indexKey = priceIndexKey(city);
    const hashKey = dataKey(city);

    try {
      const transaction = this.redis.multi().del(indexKey).del(hashKey);

      if (hotels.length > 0) {
        const scoreMembers: (string | number)[] = [];
        const hashFields: string[] = [];

        for (const hotel of hotels) {
          const key = normalizeHotelName(hotel.name);
          scoreMembers.push(hotel.price, key);
          hashFields.push(key, JSON.stringify(hotel));
        }

        transaction
          .zadd(indexKey, ...scoreMembers)
          .hset(hashKey, ...hashFields)
          .expire(indexKey, this.ttlSeconds)
          .expire(hashKey, this.ttlSeconds);
      }

      await transaction.exec();
      log.info(
        { city: normalizeCity(city), savedCount: hotels.length, ttlSeconds: this.ttlSeconds },
        'Persisted city hotel snapshot to Redis',
      );
      return hotels.length;
    } catch (error) {
      log.error({ city: normalizeCity(city), ...errorMeta(error) }, 'Failed to persist hotel snapshot');
      throw new RedisOperationError('saveCityHotels', error);
    }
  }

  /**
   * Returns the stored offers for a city, price-filtered by Redis.
   * ZRANGEBYSCORE yields only the matching members (already price-ascending),
   * then HMGET fetches just those JSON records.
   */
  async findCityHotels(city: string, range: PriceRange = {}): Promise<HotelOffer[]> {
    const { min, max } = toScoreBounds(range);
    const indexKey = priceIndexKey(city);
    const hashKey = dataKey(city);

    try {
      const names = await this.redis.zrangebyscore(indexKey, min, max);
      log.info(
        { city: normalizeCity(city), min, max, matchedCount: names.length },
        'Queried Redis price index',
      );
      if (names.length === 0) return [];

      const records = await this.redis.hmget(hashKey, ...names);
      const offers: HotelOffer[] = [];

      for (const [index, raw] of records.entries()) {
        if (raw === null) {
          log.warn({ city: normalizeCity(city), member: names[index] }, 'Price index member missing from data hash');
          continue;
        }
        const offer = parseStoredOffer(raw);
        if (offer === undefined) {
          log.warn({ city: normalizeCity(city), member: names[index] }, 'Discarding malformed stored offer');
          continue;
        }
        offers.push(offer);
      }

      return offers;
    } catch (error) {
      log.error({ city: normalizeCity(city), ...errorMeta(error) }, 'Failed to read hotels from Redis');
      throw new RedisOperationError('findCityHotels', error);
    }
  }

  async countCityHotels(city: string): Promise<number> {
    try {
      return await this.redis.zcard(priceIndexKey(city));
    } catch (error) {
      throw new RedisOperationError('countCityHotels', error);
    }
  }

  async deleteCityHotels(city: string): Promise<void> {
    try {
      await this.redis.multi().del(priceIndexKey(city)).del(dataKey(city)).exec();
    } catch (error) {
      throw new RedisOperationError('deleteCityHotels', error);
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch (error) {
      log.warn({ ...errorMeta(error) }, 'Redis ping failed');
      return false;
    }
  }
}
