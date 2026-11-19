import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SupplierRequestError,
  fetchSupplierAHotels,
  fetchSupplierBHotels,
} from '../../src/temporal/activities/hotel.activities';

const VALID_RECORD = { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('supplier fetch activities', () => {
  it('requests the Supplier A endpoint with the city as a query parameter', async () => {
    fetchMock.mockResolvedValue(jsonResponse([VALID_RECORD]));

    const hotels = await fetchSupplierAHotels('delhi');

    expect(hotels).toEqual([VALID_RECORD]);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/supplierA/hotels');
    expect(url.searchParams.get('city')).toBe('delhi');
    expect(init.method).toBe('GET');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('requests the Supplier B endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    await fetchSupplierBHotels('delhi');

    const [url] = fetchMock.mock.calls[0] as [URL];
    expect(url.pathname).toBe('/supplierB/hotels');
  });

  it('returns an empty list when the supplier has no hotels for the city', async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    expect(await fetchSupplierAHotels('jaipur')).toEqual([]);
  });

  it('throws SupplierRequestError on a 503 outage, carrying the status', async () => {
    fetchMock.mockResolvedValue(new Response('unavailable', { status: 503 }));

    await expect(fetchSupplierAHotels('delhi')).rejects.toMatchObject({
      name: 'SupplierRequestError',
      status: 503,
      message: 'Supplier A responded with HTTP 503',
    });
  });

  it('throws SupplierRequestError when the endpoint is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'));

    await expect(fetchSupplierBHotels('delhi')).rejects.toBeInstanceOf(SupplierRequestError);
  });

  it('rejects a payload that is not an array', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ hotels: [] }));

    await expect(fetchSupplierAHotels('delhi')).rejects.toThrow(/unexpected payload shape/);
  });

  it('rejects records with missing or mistyped fields', async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ ...VALID_RECORD, price: 'cheap' }]));

    await expect(fetchSupplierAHotels('delhi')).rejects.toThrow(/unexpected payload shape/);
  });
});
