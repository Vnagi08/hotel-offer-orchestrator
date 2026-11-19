import { describe, expect, it } from 'vitest';
import { parseCity, parseHotelQuery, parsePriceRange } from '../../src/api/validators/hotel.validator';
import { ApiError } from '../../src/utils/errors';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error.code;
    throw error;
  }
  throw new Error('Expected the call to throw an ApiError');
}

describe('parseCity', () => {
  it('normalizes a valid city to lowercase', () => {
    expect(parseCity('  Delhi ')).toBe('delhi');
    expect(parseCity('New Delhi')).toBe('new delhi');
  });

  it('rejects a missing city with MISSING_CITY', () => {
    expect(codeOf(() => parseCity(undefined))).toBe('MISSING_CITY');
  });

  it('rejects an empty or whitespace-only city', () => {
    expect(codeOf(() => parseCity(''))).toBe('INVALID_CITY');
    expect(codeOf(() => parseCity('   '))).toBe('INVALID_CITY');
  });

  it('rejects numeric and symbol-laden values', () => {
    expect(codeOf(() => parseCity('123'))).toBe('INVALID_CITY');
    expect(codeOf(() => parseCity('delhi;DROP'))).toBe('INVALID_CITY');
  });

  it('rejects an over-long city name', () => {
    expect(codeOf(() => parseCity('a'.repeat(65)))).toBe('INVALID_CITY');
  });

  it('rejects repeated query parameters', () => {
    expect(codeOf(() => parseCity(['delhi', 'mumbai']))).toBe('INVALID_CITY');
  });
});

describe('parsePriceRange', () => {
  it('returns an empty range when neither bound is supplied', () => {
    expect(parsePriceRange({})).toEqual({});
  });

  it('accepts only minPrice', () => {
    expect(parsePriceRange({ minPrice: '5000' })).toEqual({ minPrice: 5000 });
  });

  it('accepts only maxPrice', () => {
    expect(parsePriceRange({ maxPrice: '7000' })).toEqual({ maxPrice: 7000 });
  });

  it('accepts both bounds', () => {
    expect(parsePriceRange({ minPrice: '5000', maxPrice: '7000' })).toEqual({ minPrice: 5000, maxPrice: 7000 });
  });

  it('accepts an equal min and max', () => {
    expect(parsePriceRange({ minPrice: '5340', maxPrice: '5340' })).toEqual({ minPrice: 5340, maxPrice: 5340 });
  });

  it('accepts decimal prices', () => {
    expect(parsePriceRange({ minPrice: '5000.5' })).toEqual({ minPrice: 5000.5 });
  });

  it('rejects non-numeric prices with INVALID_PRICE', () => {
    expect(codeOf(() => parsePriceRange({ minPrice: 'abc' }))).toBe('INVALID_PRICE');
    expect(codeOf(() => parsePriceRange({ maxPrice: '7,000' }))).toBe('INVALID_PRICE');
    expect(codeOf(() => parsePriceRange({ maxPrice: 'Infinity' }))).toBe('INVALID_PRICE');
  });

  it('rejects an empty price value', () => {
    expect(codeOf(() => parsePriceRange({ minPrice: '' }))).toBe('INVALID_PRICE');
  });

  it('rejects negative prices', () => {
    expect(codeOf(() => parsePriceRange({ minPrice: '-1' }))).toBe('INVALID_PRICE');
    expect(codeOf(() => parsePriceRange({ maxPrice: '-5000' }))).toBe('INVALID_PRICE');
  });

  it('rejects minPrice greater than maxPrice with INVALID_PRICE_RANGE', () => {
    expect(codeOf(() => parsePriceRange({ minPrice: '9000', maxPrice: '5000' }))).toBe('INVALID_PRICE_RANGE');
  });
});

describe('parseHotelQuery', () => {
  it('parses the city together with the price range', () => {
    expect(parseHotelQuery({ city: 'Delhi', minPrice: '5000', maxPrice: '7000' })).toEqual({
      city: 'delhi',
      minPrice: 5000,
      maxPrice: 7000,
    });
  });

  it('validates the city before the price range', () => {
    expect(codeOf(() => parseHotelQuery({ minPrice: '-1' }))).toBe('MISSING_CITY');
  });
});
