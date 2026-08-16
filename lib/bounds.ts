// Shared defensive upper bounds for externally supplied numeric inputs (F-04).
//
// These are security/defensive limits, NOT business rules: they exist to stop
// memory-exhaustion (calculatePrice allocates new Array(qty+1)), absurd
// persisted values, and integer/float overflow, and are deliberately set far
// above any realistic small-shop value so legitimate data is never rejected.
// If a real trade ever needs more, raise the constant (documented change).

// Max quantity on a single line/tier/adjustment, in HUMAN-READABLE quantity
// units with up to 2 decimal places (D25). 1000.00 covers any small-shop line
// (a commodity truckload is ~1-2k units) while keeping the internal
// hundredths-scaled representation (lib/quantity.ts) at 100000 scaled units —
// the same bound the calculatePrice DP array had before D25, so its memory
// footprint (~0.8 MB) and O(qty x tiers) work are unchanged. Raise the constant
// (documented change) if a real trade ever needs more.
export const MAX_ITEM_QUANTITY = 1000;

// Max line entries on one document (sales / purchases `items`). Mirrors the
// F-01 MAX_TIERS = 50 precedent; a counter receipt or supplier order with
// more than 100 distinct products is implausible for this shop.
export const MAX_ITEMS_PER_DOCUMENT = 100;

// Max value for any single monetary input (payment amount, costPerUnit,
// product prices). Largest observed document value in the ledger is ~5,020
// (D7); 10,000,000 (Rs 1 crore) is ~2,000x headroom and keeps paisa-exact
// sums far inside the JS safe-integer range.
export const MAX_AMOUNT = 10000000;