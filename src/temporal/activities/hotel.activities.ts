import { env } from '../../config/env';
import { getRedisClient } from '../../redis/client';
import { HotelRepository } from '../../redis/hotel.repository';
import type { HotelOffer, SupplierHotel } from '../../types/hotel.types';
import { errorMeta, logger } from '../../utils/logger';

const log = logger.child({ component: 'temporal.activities' });

/** Thrown when a supplier endpoint is unreachable or answers with a non-2xx status. */
export class SupplierRequestError extends Error {
  readonly supplier: string;
  readonly status?: number;

  constructor(supplier: string, message: string, status?: number) {
    super(message);
    this.name = 'SupplierRequestError';
    this.supplier = supplier;
    this.status = status;
  }
}

function isSupplierHotel(value: unknown): value is SupplierHotel {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<SupplierHotel>;
  return (
    typeof candidate.hotelId === 'string' &&
    typeof candidate.name === 'string' &&
    typeof candidate.price === 'number' &&
    Number.isFinite(candidate.price) &&
    typeof candidate.city === 'string' &&
    typeof candidate.commissionPct === 'number'
  );
}

async function fetchSupplierHotels(
  supplier: string,
  baseUrl: string,
  path: string,
  city: string,
): Promise<SupplierHotel[]> {
  const url = new URL(path, baseUrl);
  url.searchParams.set('city', city);
  const startedAt = Date.now();

  log.info({ supplier, city, url: url.toString() }, 'Calling supplier endpoint');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(env.supplierTimeoutMs),
    });
  } catch (error) {
    const meta = errorMeta(error);
    log.error({ supplier, city, durationMs: Date.now() - startedAt, ...meta }, 'Supplier request failed');
    throw new SupplierRequestError(supplier, `${supplier} request failed: ${meta.message}`);
  }

  if (!response.ok) {
    log.error(
      { supplier, city, status: response.status, durationMs: Date.now() - startedAt },
      'Supplier responded with an error status',
    );
    throw new SupplierRequestError(
      supplier,
      `${supplier} responded with HTTP ${response.status}`,
      response.status,
    );
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.every(isSupplierHotel)) {
    log.error({ supplier, city, status: response.status }, 'Supplier returned an unexpected payload shape');
    throw new SupplierRequestError(supplier, `${supplier} returned an unexpected payload shape`, response.status);
  }

  log.info(
    { supplier, city, status: response.status, hotelCount: payload.length, durationMs: Date.now() - startedAt },
    'Supplier responded successfully',
  );
  return payload;
}

export async function fetchSupplierAHotels(city: string): Promise<SupplierHotel[]> {
  return fetchSupplierHotels('Supplier A', env.supplierABaseUrl, '/supplierA/hotels', city);
}

export async function fetchSupplierBHotels(city: string): Promise<SupplierHotel[]> {
  return fetchSupplierHotels('Supplier B', env.supplierBBaseUrl, '/supplierB/hotels', city);
}

export async function saveHotelsToRedis(city: string, hotels: HotelOffer[]): Promise<number> {
  const repository = new HotelRepository(getRedisClient());
  const startedAt = Date.now();
  const savedCount = await repository.saveCityHotels(city, hotels);
  log.info({ city, savedCount, durationMs: Date.now() - startedAt }, 'saveHotelsToRedis activity completed');
  return savedCount;
}
