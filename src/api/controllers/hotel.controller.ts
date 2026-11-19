import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { lookupCityHotels } from '../../services/hotel.service';
import { logger } from '../../utils/logger';
import { parseHotelQuery } from '../validators/hotel.validator';

const log = logger.child({ component: 'hotel.controller' });

export async function getHotels(req: Request, res: Response, next: NextFunction): Promise<void> {
  const requestId = randomUUID();

  try {
    const { city, minPrice, maxPrice } = parseHotelQuery(req.query as Record<string, unknown>);

    log.info(
      { requestId, city, minPrice: minPrice ?? null, maxPrice: maxPrice ?? null, path: req.path },
      'Incoming hotel offers request',
    );

    const { hotels, workflow } = await lookupCityHotels(city, { minPrice, maxPrice }, requestId);

    // The body stays a bare array, so partial results are signalled out of band:
    // true means at least one supplier failed and these offers come from the rest.
    res.set('X-Partial-Results', String(workflow.partial));
    res.status(200).json(hotels);
  } catch (error) {
    next(error);
  }
}
