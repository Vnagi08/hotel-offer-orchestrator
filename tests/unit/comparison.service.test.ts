import { describe, expect, it } from 'vitest';
import {
  compareAndDeduplicate,
  displayHotelName,
  mergeSupplierOffers,
  normalizeHotelName,
  selectBetterOffer,
  sortOffersByPrice,
  tagOffers,
} from '../../src/services/comparison.service';
import { SUPPLIER_A, SUPPLIER_B, type SupplierHotel, type SupplierOffer } from '../../src/types/hotel.types';

function hotel(partial: Partial<SupplierHotel> & { name: string; price: number }): SupplierHotel {
  return {
    hotelId: partial.hotelId ?? `id-${partial.name}-${partial.price}`,
    name: partial.name,
    price: partial.price,
    city: partial.city ?? 'delhi',
    commissionPct: partial.commissionPct ?? 10,
  };
}

function offer(
  name: string,
  price: number,
  supplier: typeof SUPPLIER_A | typeof SUPPLIER_B,
  commissionPct = 10,
): SupplierOffer {
  return { ...hotel({ name, price, commissionPct }), supplier };
}

describe('normalizeHotelName', () => {
  it('lowercases the name', () => {
    expect(normalizeHotelName('Holtin')).toBe('holtin');
    expect(normalizeHotelName('HOLTIN')).toBe('holtin');
  });

  it('removes leading and trailing whitespace', () => {
    expect(normalizeHotelName('   Taj Palace  ')).toBe('taj palace');
    expect(normalizeHotelName('\t Novotel \n')).toBe('novotel');
  });

  it('collapses internal whitespace runs', () => {
    expect(normalizeHotelName('The   Leela')).toBe('the leela');
  });

  it('treats differently cased and spaced variants as the same hotel', () => {
    expect(normalizeHotelName('  tHe   lEEla ')).toBe(normalizeHotelName('The Leela'));
  });
});

describe('displayHotelName', () => {
  it('keeps the original casing but normalizes whitespace', () => {
    expect(displayHotelName('  The   Leela  ')).toBe('The Leela');
  });
});

describe('selectBetterOffer', () => {
  it('prefers the cheaper offer regardless of supplier', () => {
    const a = offer('Holtin', 6000, SUPPLIER_A);
    const b = offer('Holtin', 5340, SUPPLIER_B);
    expect(selectBetterOffer(a, b)).toBe(b);
    expect(selectBetterOffer(b, a)).toBe(b);
  });

  it('prefers Supplier A when prices are equal', () => {
    const a = offer('The Leela', 7200, SUPPLIER_A);
    const b = offer('The Leela', 7200, SUPPLIER_B);
    expect(selectBetterOffer(a, b).supplier).toBe(SUPPLIER_A);
    expect(selectBetterOffer(b, a).supplier).toBe(SUPPLIER_A);
  });

  it('keeps the incumbent when both offers come from the same supplier at the same price', () => {
    const first = offer('Novotel', 7500, SUPPLIER_B, 12);
    const second = offer('Novotel', 7500, SUPPLIER_B, 30);
    expect(selectBetterOffer(first, second)).toBe(first);
  });
});

describe('mergeSupplierOffers', () => {
  it('selects the cheapest offer for a hotel present in both suppliers and keeps its commission', () => {
    const result = mergeSupplierOffers(
      [offer('Holtin', 6000, SUPPLIER_A, 10)],
      [offer('Holtin', 5340, SUPPLIER_B, 20)],
    );

    expect(result).toEqual([{ name: 'Holtin', price: 5340, supplier: SUPPLIER_B, commissionPct: 20 }]);
  });

  it('retains hotels offered by only one supplier', () => {
    const result = mergeSupplierOffers(
      [offer('Taj Palace', 9000, SUPPLIER_A, 15)],
      [offer('Novotel', 7500, SUPPLIER_B, 12)],
    );

    expect(result.map((item) => item.name)).toEqual(['Novotel', 'Taj Palace']);
  });

  it('deduplicates repeated entries inside a single supplier, keeping the cheapest', () => {
    const result = mergeSupplierOffers(
      [offer('Holtin', 6450, SUPPLIER_A, 8), offer('  holtin ', 6000, SUPPLIER_A, 10)],
      [],
    );

    // The winning record's own (whitespace-normalized) name is what gets published.
    expect(result).toEqual([{ name: 'holtin', price: 6000, supplier: SUPPLIER_A, commissionPct: 10 }]);
  });

  it('breaks an exact price tie in favour of Supplier A and keeps Supplier A commission', () => {
    const result = mergeSupplierOffers(
      [offer('  The Leela  ', 7200, SUPPLIER_A, 11)],
      [offer('The Leela', 7200, SUPPLIER_B, 17)],
    );

    expect(result).toEqual([{ name: 'The Leela', price: 7200, supplier: SUPPLIER_A, commissionPct: 11 }]);
  });

  it('ignores entries whose name normalizes to an empty string', () => {
    const result = mergeSupplierOffers([offer('   ', 1000, SUPPLIER_A)], []);
    expect(result).toEqual([]);
  });

  it('returns an empty list when both suppliers return nothing', () => {
    expect(mergeSupplierOffers([], [])).toEqual([]);
  });

  it('produces a deterministic result regardless of merge order within a supplier', () => {
    const a = [offer('Holtin', 6000, SUPPLIER_A), offer('Radison', 5900, SUPPLIER_A)];
    const b = [offer('Radison', 6200, SUPPLIER_B), offer('Holtin', 5340, SUPPLIER_B)];

    expect(mergeSupplierOffers(a, b)).toEqual(mergeSupplierOffers([...a].reverse(), [...b].reverse()));
  });
});

describe('sortOffersByPrice', () => {
  it('sorts ascending by price and uses the name as a stable tiebreaker', () => {
    const sorted = sortOffersByPrice([
      { name: 'Zeta', price: 5000, supplier: SUPPLIER_A, commissionPct: 1 },
      { name: 'Alpha', price: 5000, supplier: SUPPLIER_B, commissionPct: 2 },
      { name: 'Cheap', price: 100, supplier: SUPPLIER_A, commissionPct: 3 },
    ]);

    expect(sorted.map((item) => item.name)).toEqual(['Cheap', 'Alpha', 'Zeta']);
  });
});

describe('compareAndDeduplicate (full mock catalogues)', () => {
  const supplierA: SupplierHotel[] = [
    hotel({ name: 'Holtin', price: 6000, commissionPct: 10 }),
    hotel({ name: 'Radison', price: 5900, commissionPct: 13 }),
    hotel({ name: 'Taj Palace', price: 9000, commissionPct: 15 }),
    hotel({ name: '  The Leela  ', price: 7200, commissionPct: 11 }),
    hotel({ name: 'HOLTIN', price: 6450, commissionPct: 8 }),
    hotel({ name: 'The Imperial', price: 4800, commissionPct: 9 }),
  ];
  const supplierB: SupplierHotel[] = [
    hotel({ name: 'Holtin', price: 5340, commissionPct: 20 }),
    hotel({ name: 'Radison', price: 6200, commissionPct: 18 }),
    hotel({ name: 'Novotel', price: 7500, commissionPct: 12 }),
    hotel({ name: 'The Leela', price: 7200, commissionPct: 17 }),
    hotel({ name: ' novotel ', price: 7900, commissionPct: 10 }),
    hotel({ name: 'The Oberoi', price: 11000, commissionPct: 14 }),
  ];

  it('produces one price-ascending entry per hotel with the winning supplier and commission', () => {
    expect(compareAndDeduplicate(supplierA, supplierB)).toEqual([
      { name: 'The Imperial', price: 4800, supplier: SUPPLIER_A, commissionPct: 9 },
      { name: 'Holtin', price: 5340, supplier: SUPPLIER_B, commissionPct: 20 },
      { name: 'Radison', price: 5900, supplier: SUPPLIER_A, commissionPct: 13 },
      { name: 'The Leela', price: 7200, supplier: SUPPLIER_A, commissionPct: 11 },
      { name: 'Novotel', price: 7500, supplier: SUPPLIER_B, commissionPct: 12 },
      { name: 'Taj Palace', price: 9000, supplier: SUPPLIER_A, commissionPct: 15 },
      { name: 'The Oberoi', price: 11000, supplier: SUPPLIER_B, commissionPct: 14 },
    ]);
  });

  it('never emits duplicate normalized names', () => {
    const names = compareAndDeduplicate(supplierA, supplierB).map((item) => normalizeHotelName(item.name));
    expect(new Set(names).size).toBe(names.length);
  });

  it('falls back to a single supplier when the other returned nothing (partial results)', () => {
    const result = compareAndDeduplicate(supplierA, []);
    expect(result.every((item) => item.supplier === SUPPLIER_A)).toBe(true);
    expect(result).toHaveLength(5);
  });
});

describe('tagOffers', () => {
  it('attaches the supplier name to every record', () => {
    const tagged = tagOffers([hotel({ name: 'Holtin', price: 6000 })], SUPPLIER_B);
    expect(tagged[0]?.supplier).toBe(SUPPLIER_B);
  });
});
