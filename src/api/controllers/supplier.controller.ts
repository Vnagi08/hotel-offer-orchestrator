import type { NextFunction, Request, Response } from 'express';
import { env } from '../../config/env';
import { getSupplierAHotels } from '../../suppliers/supplierA.data';
import { getSupplierBHotels } from '../../suppliers/supplierB.data';
import type { SupplierHotel } from '../../types/hotel.types';
import { ApiError } from '../../utils/errors';
import { logger } from '../../utils/logger';
import { parseCity } from '../validators/hotel.validator';

const log = logger.child({ component: 'supplier.controller' });

type SupplierLookup = (city: string) => readonly SupplierHotel[];

/**
 * Mock supplier endpoint. Disabling the supplier via environment variable makes it
 * answer HTTP 503, which is how a supplier outage is simulated.
 */
function supplierHandler(supplier: string, enabled: boolean, lookup: SupplierLookup) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      if (!enabled) {
        log.warn({ supplier }, 'Supplier endpoint is disabled by configuration');
        throw new ApiError(503, 'SUPPLIER_UNAVAILABLE', `${supplier} is currently unavailable`);
      }

      const city = parseCity((req.query as Record<string, unknown>)['city']);
      const hotels = lookup(city);
      log.info({ supplier, city, hotelCount: hotels.length }, 'Supplier endpoint served a catalogue');
      res.status(200).json(hotels);
    } catch (error) {
      next(error);
    }
  };
}

export const getSupplierAHotelsHandler = supplierHandler('Supplier A', env.supplierAEnabled, getSupplierAHotels);
export const getSupplierBHotelsHandler = supplierHandler('Supplier B', env.supplierBEnabled, getSupplierBHotels);
