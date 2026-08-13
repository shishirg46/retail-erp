// Shared defensive upper bounds for externally supplied numeric inputs (F-04).
//
// These are security/defensive limits, NOT business rules: they exist to stop
// memory-exhaustion (calculatePrice allocates new Array(qty+1)), absurd
// persisted values, and integer/float overflow, and are deliberately set far
// above any realistic small-shop value so legitimate data is never rejected.
// If a real trade ever needs more, raise the constant (documented change).

// Max units on a single line: bounds the calculatePrice DP array to ~0.8 MB
// and its O(qty x tiers) work; well under Postgres Int (2^31-1). A small-shop
// line never approaches this (a commodity truckload is ~1-2k units).
export const MAX_ITEM_QUANTITY = 100000;

// Max line entries on one document (sales / purchases `items`). Mirrors the
// F-01 MAX_TIERS = 50 precedent; a counter receipt or supplier order with
// more than 100 distinct products is implausible for this shop.
export const MAX_ITEMS_PER_DOCUMENT = 100;

// Max value for any single monetary input (payment amount, costPerUnit,
// product prices). Largest observed document value in the ledger is ~5,020
// (D7); 10,000,000 (Rs 1 crore) is ~2,000x headroom and keeps paisa-exact
// sums far inside the JS safe-integer range.
export const MAX_AMOUNT = 10000000;