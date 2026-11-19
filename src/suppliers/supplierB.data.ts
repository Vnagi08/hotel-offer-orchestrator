import type { SupplierHotel } from '../types/hotel.types';

/**
 * Static Supplier B catalogue, keyed by lowercase city.
 * Prices intentionally differ from Supplier A so the cheapest-offer rule is observable.
 */
export const SUPPLIER_B_HOTELS: Readonly<Record<string, readonly SupplierHotel[]>> = {
  delhi: [
    { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
    { hotelId: 'b2', name: 'Radison', price: 6200, city: 'delhi', commissionPct: 18 },
    { hotelId: 'b3', name: 'Novotel', price: 7500, city: 'delhi', commissionPct: 12 },
    { hotelId: 'b4', name: 'The Leela', price: 7200, city: 'delhi', commissionPct: 17 },
    { hotelId: 'b5', name: ' novotel ', price: 7900, city: 'delhi', commissionPct: 10 },
    { hotelId: 'b6', name: 'The Oberoi', price: 11000, city: 'delhi', commissionPct: 14 },
  ],
  mumbai: [
    { hotelId: 'b7', name: 'Sea Breeze', price: 3990, city: 'mumbai', commissionPct: 15 },
    { hotelId: 'b8', name: 'Novotel', price: 6100, city: 'mumbai', commissionPct: 11 },
    { hotelId: 'b9', name: 'Trident', price: 8800, city: 'mumbai', commissionPct: 20 },
  ],
};

export function getSupplierBHotels(city: string): readonly SupplierHotel[] {
  return SUPPLIER_B_HOTELS[city.trim().toLowerCase()] ?? [];
}
