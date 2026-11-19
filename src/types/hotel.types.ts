export const SUPPLIER_A = 'Supplier A';
export const SUPPLIER_B = 'Supplier B';

export type SupplierName = typeof SUPPLIER_A | typeof SUPPLIER_B;

/** Raw record as returned by a supplier's HTTP endpoint. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** A supplier record tagged with its origin, used by the comparison logic. */
export interface SupplierOffer extends SupplierHotel {
  supplier: SupplierName;
}

/** The public shape returned by the API and persisted in Redis. */
export interface HotelOffer {
  name: string;
  price: number;
  supplier: SupplierName;
  commissionPct: number;
}

export interface PriceRange {
  minPrice?: number;
  maxPrice?: number;
}

export type SupplierCallStatus = 'ok' | 'failed';

export interface SupplierCallReport {
  supplier: SupplierName;
  status: SupplierCallStatus;
  offerCount: number;
  error?: string;
}

/** Value returned by getHotelOffersWorkflow. */
export interface HotelOffersWorkflowResult {
  city: string;
  partial: boolean;
  suppliers: SupplierCallReport[];
  rawOfferCount: number;
  deduplicatedCount: number;
  hotels: HotelOffer[];
}
