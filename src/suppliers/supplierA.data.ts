import type { SupplierHotel } from '../types/hotel.types';

/**
 * Static Supplier A catalogue, keyed by lowercase city.
 * Intentionally contains overlaps with Supplier B, exclusive hotels,
 * an equal-price hotel (tie-break case) and an intra-supplier duplicate.
 */
export const SUPPLIER_A_HOTELS: Readonly<Record<string, readonly SupplierHotel[]>> = {
  delhi: [
    { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
    { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
    { hotelId: 'a3', name: 'Taj Palace', price: 9000, city: 'delhi', commissionPct: 15 },
    { hotelId: 'a4', name: '  The Leela  ', price: 7200, city: 'delhi', commissionPct: 11 },
    { hotelId: 'a5', name: 'HOLTIN', price: 6450, city: 'delhi', commissionPct: 8 },
    { hotelId: 'a6', name: 'The Imperial', price: 4800, city: 'delhi', commissionPct: 9 },
  ],
  mumbai: [
    { hotelId: 'a7', name: 'Sea Breeze', price: 4200, city: 'mumbai', commissionPct: 10 },
    { hotelId: 'a8', name: 'Trident', price: 8800, city: 'mumbai', commissionPct: 12 },
    { hotelId: 'a9', name: 'Holtin', price: 7000, city: 'mumbai', commissionPct: 9 },
  ],
};

export function getSupplierAHotels(city: string): readonly SupplierHotel[] {
  return SUPPLIER_A_HOTELS[city.trim().toLowerCase()] ?? [];
}
