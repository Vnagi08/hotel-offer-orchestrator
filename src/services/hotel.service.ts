import { HotelRepository } from '../redis/hotel.repository';
import { getRedisClient } from '../redis/client';
import { executeHotelOffersWorkflow } from '../temporal/client';
import type { HotelOffer, HotelOffersWorkflowResult, PriceRange } from '../types/hotel.types';
import { logger } from '../utils/logger';

const log = logger.child({ component: 'hotel.service' });

export interface HotelLookupResult {
  hotels: HotelOffer[];
  workflow: HotelOffersWorkflowResult;
}

/**
 * Runs the Temporal workflow for the city (suppliers → dedupe → Redis),
 * then reads the requested price window back out of Redis.
 */
export async function lookupCityHotels(
  city: string,
  range: PriceRange,
  requestId: string,
  repository: HotelRepository = new HotelRepository(getRedisClient()),
): Promise<HotelLookupResult> {
  const startedAt = Date.now();

  const workflow = await executeHotelOffersWorkflow(city, requestId);
  const hotels = await repository.findCityHotels(city, range);

  log.info(
    {
      requestId,
      city,
      minPrice: range.minPrice ?? null,
      maxPrice: range.maxPrice ?? null,
      partial: workflow.partial,
      deduplicatedCount: workflow.deduplicatedCount,
      returnedCount: hotels.length,
      durationMs: Date.now() - startedAt,
    },
    'City hotel lookup completed',
  );

  return { hotels, workflow };
}
