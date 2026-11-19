import type { PriceRange } from '../../types/hotel.types';
import { ApiError } from '../../utils/errors';

const CITY_PATTERN = /^[a-z][a-z\s'-]*$/i;
const MAX_CITY_LENGTH = 64;

/** Express query values can be arrays or nested objects; only a single string is accepted. */
function singleStringParam(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  throw ApiError.badRequest('INVALID_CITY', 'Query parameters must be provided exactly once');
}

export function parseCity(rawCity: unknown): string {
  const value = singleStringParam(rawCity);
  if (value === undefined) {
    throw ApiError.badRequest('MISSING_CITY', 'Query parameter "city" is required');
  }

  const city = value.trim();
  if (city === '') {
    throw ApiError.badRequest('INVALID_CITY', 'Query parameter "city" must not be empty');
  }
  if (city.length > MAX_CITY_LENGTH) {
    throw ApiError.badRequest('INVALID_CITY', `Query parameter "city" must be at most ${MAX_CITY_LENGTH} characters`);
  }
  if (!CITY_PATTERN.test(city)) {
    throw ApiError.badRequest(
      'INVALID_CITY',
      'Query parameter "city" must contain only letters, spaces, hyphens and apostrophes',
    );
  }

  return city.toLowerCase();
}

function parsePrice(rawValue: unknown, field: 'minPrice' | 'maxPrice'): number | undefined {
  const value = singleStringParam(rawValue);
  if (value === undefined) return undefined;

  const trimmed = value.trim();
  if (trimmed === '') {
    throw ApiError.badRequest('INVALID_PRICE', `Query parameter "${field}" must not be empty`);
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw ApiError.badRequest('INVALID_PRICE', `Query parameter "${field}" must be a valid number`);
  }
  if (parsed < 0) {
    throw ApiError.badRequest('INVALID_PRICE', `Query parameter "${field}" must not be negative`);
  }

  return parsed;
}

/** Both bounds are optional and inclusive; minPrice must not exceed maxPrice. */
export function parsePriceRange(query: Record<string, unknown>): PriceRange {
  const minPrice = parsePrice(query['minPrice'], 'minPrice');
  const maxPrice = parsePrice(query['maxPrice'], 'maxPrice');

  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw ApiError.badRequest('INVALID_PRICE_RANGE', 'minPrice cannot be greater than maxPrice');
  }

  const range: PriceRange = {};
  if (minPrice !== undefined) range.minPrice = minPrice;
  if (maxPrice !== undefined) range.maxPrice = maxPrice;
  return range;
}

export interface HotelQuery extends PriceRange {
  city: string;
}

export function parseHotelQuery(query: Record<string, unknown>): HotelQuery {
  return { city: parseCity(query['city']), ...parsePriceRange(query) };
}
