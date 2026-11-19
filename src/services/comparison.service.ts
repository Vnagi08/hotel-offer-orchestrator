import {
  SUPPLIER_A,
  type HotelOffer,
  type SupplierHotel,
  type SupplierName,
  type SupplierOffer,
} from '../types/hotel.types';

/**
 * Canonical identity for a hotel: case-insensitive, with leading/trailing
 * whitespace removed and internal whitespace runs collapsed to one space.
 * Also used as the Redis sorted-set member and hash field.
 */
export function normalizeHotelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Display name for a hotel: whitespace-normalized but original casing preserved. */
export function displayHotelName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function tagOffers(hotels: readonly SupplierHotel[], supplier: SupplierName): SupplierOffer[] {
  return hotels.map((hotel) => ({ ...hotel, supplier }));
}

/**
 * Cheaper offer wins; on an exact price tie Supplier A wins. The comparison is a
 * pure function of its inputs so it stays deterministic inside a Temporal workflow.
 */
export function selectBetterOffer(current: SupplierOffer, candidate: SupplierOffer): SupplierOffer {
  if (candidate.price < current.price) return candidate;
  if (candidate.price > current.price) return current;
  if (current.supplier === SUPPLIER_A) return current;
  return candidate.supplier === SUPPLIER_A ? candidate : current;
}

export function toHotelOffer(offer: SupplierOffer): HotelOffer {
  return {
    name: displayHotelName(offer.name),
    price: offer.price,
    supplier: offer.supplier,
    commissionPct: offer.commissionPct,
  };
}

/** Ascending by price, then by normalized name so equal prices have a stable order. */
export function sortOffersByPrice<T extends HotelOffer>(offers: readonly T[]): T[] {
  return [...offers].sort(
    (left, right) =>
      left.price - right.price || normalizeHotelName(left.name).localeCompare(normalizeHotelName(right.name)),
  );
}

/**
 * Collapses any number of tagged supplier offers onto one offer per normalized
 * hotel name, keeping the best offer per the rules in `selectBetterOffer`.
 * Handles duplicates inside a single supplier as well as across suppliers.
 */
export function mergeSupplierOffers(...offerLists: readonly SupplierOffer[][]): HotelOffer[] {
  const best = new Map<string, SupplierOffer>();

  for (const offers of offerLists) {
    for (const offer of offers) {
      const key = normalizeHotelName(offer.name);
      if (key === '') continue;
      const current = best.get(key);
      best.set(key, current === undefined ? offer : selectBetterOffer(current, offer));
    }
  }

  return sortOffersByPrice([...best.values()].map(toHotelOffer));
}

/** Convenience wrapper used by the workflow: tag each supplier's raw records, then merge. */
export function compareAndDeduplicate(
  supplierAHotels: readonly SupplierHotel[],
  supplierBHotels: readonly SupplierHotel[],
): HotelOffer[] {
  return mergeSupplierOffers(tagOffers(supplierAHotels, 'Supplier A'), tagOffers(supplierBHotels, 'Supplier B'));
}
