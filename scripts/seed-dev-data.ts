// M24 — Pure data definitions for the dev seed dataset.
//
// This file contains NO business logic — only declarative data that the seed
// script (seed-dev.ts) turns into real database records via the production
// services/repositories. All monetary values are in RUPEES (wire format) for
// readability; the seed script converts to paisa at insertion time. All
// quantities are in HUMAN UNITS; the seed script converts to scaled units
// (× 100) at insertion time.
//
// Invariant note: the seed script independently verifies all D3/D4/D6/D18
// invariants after insertion — this file does NOT contain expected balances.

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export interface ProductDef {
  name: string;
  unit: string;
  costPrice: number; // rupees
  currentPrice: number; // rupees
  unitsPerPack?: number; // D28 — pcs-only, >= 2
  priceTiers?: { minQty: number; price: number }[]; // human-unit thresholds
  openingStock: number; // human units for OPENING stock
}

// Opening stock quantities represent what was counted on hand at ERP go-live.
// Post-go-live purchases add to these; sales subtract from them.
export const PRODUCTS: ProductDef[] = [
  // --- Staple grains & pulses ---
  {
    name: "Basmati Rice",
    unit: "kg",
    costPrice: 120,
    currentPrice: 150,
    priceTiers: [
      { minQty: 5, price: 140 },
      { minQty: 10, price: 135 },
    ],
    openingStock: 50,
  },
  {
    name: "Regular Rice (Mansuli)",
    unit: "kg",
    costPrice: 80,
    currentPrice: 100,
    priceTiers: [
      { minQty: 5, price: 95 },
      { minQty: 10, price: 90 },
    ],
    openingStock: 80,
  },
  {
    name: "Red Lentils (Masoor Dal)",
    unit: "kg",
    costPrice: 140,
    currentPrice: 180,
    priceTiers: [{ minQty: 3, price: 170 }],
    openingStock: 30,
  },
  {
    name: "All-Purpose Flour (Maida)",
    unit: "kg",
    costPrice: 40,
    currentPrice: 55,
    openingStock: 50,
  },

  // --- Cooking essentials ---
  {
    name: "Refined Cooking Oil (Soybean)",
    unit: "liter",
    costPrice: 180,
    currentPrice: 220,
    priceTiers: [
      { minQty: 3, price: 210 },
      { minQty: 5, price: 200 },
    ],
    openingStock: 40,
  },
  {
    name: "Sugar (Chini)",
    unit: "kg",
    costPrice: 90,
    currentPrice: 120,
    priceTiers: [{ minQty: 5, price: 115 }],
    openingStock: 40,
  },
  {
    name: "Iodized Salt (Nun)",
    unit: "kg",
    costPrice: 20,
    currentPrice: 30,
    openingStock: 30,
  },
  {
    name: "Turmeric Powder (Besar)",
    unit: "pcs",
    costPrice: 40,
    currentPrice: 60,
    openingStock: 40,
  },

  // --- Beverages ---
  {
    name: "Tea Leaves (Chiya Patti)",
    unit: "pcs",
    costPrice: 150,
    currentPrice: 200,
    openingStock: 60,
  },
  {
    name: "Milk (Pasteurized — 1L)",
    unit: "liter",
    costPrice: 55,
    currentPrice: 70,
    openingStock: 20,
  },

  // --- Personal care ---
  {
    name: "Toothpaste (Close-Up 100g)",
    unit: "pcs",
    costPrice: 60,
    currentPrice: 85,
    openingStock: 50,
  },
  {
    name: "Shampoo Sachet (Clinic Plus 100ml)",
    unit: "pcs",
    costPrice: 50,
    currentPrice: 75,
    openingStock: 40,
  },
  {
    name: "Soap Bar (Lux 100g)",
    unit: "pcs",
    costPrice: 25,
    currentPrice: 40,
    unitsPerPack: 6,
    openingStock: 120,
  },

  // --- Household ---
  {
    name: "Detergent Powder (Surf Excel 500g)",
    unit: "pcs",
    costPrice: 80,
    currentPrice: 120,
    openingStock: 30,
  },

  // --- Packaged products (D28) ---
  {
    name: "Biscuits (Cream — Good Day)",
    unit: "pcs",
    costPrice: 10,
    currentPrice: 15,
    unitsPerPack: 24,
    openingStock: 240,
  },
  {
    name: "Instant Noodles (Wai Wai)",
    unit: "pcs",
    costPrice: 12,
    currentPrice: 20,
    unitsPerPack: 12,
    openingStock: 240,
  },
  {
    name: "Bottled Water (Bisleri 1L)",
    unit: "pcs",
    costPrice: 10,
    currentPrice: 20,
    unitsPerPack: 12,
    openingStock: 240,
  },
  {
    name: "Eggs (Brown — Desi)",
    unit: "pcs",
    costPrice: 8,
    currentPrice: 12,
    unitsPerPack: 30,
    openingStock: 300,
  },
];

// ---------------------------------------------------------------------------
// Suppliers
// ---------------------------------------------------------------------------

export interface SupplierDef {
  name: string;
  contact: string; // anonymized
  openingBalance: number; // rupees — what the shop already owes at go-live
}

export const SUPPLIERS: SupplierDef[] = [
  { name: "Himalayan Wholesale Traders", contact: "+977-9841-23XXXX", openingBalance: 15000 },
  { name: "Kathmandu Dairy & Provisions", contact: "+977-9851-67XXXX", openingBalance: 0 },
  { name: "Valley Cleaning Supplies", contact: "+977-9842-34XXXX", openingBalance: 5000 },
  { name: "Nepal Snacks & Beverages Co.", contact: "+977-9860-78XXXX", openingBalance: 0 },
  { name: "Fresh Farm Direct", contact: "+977-9812-45XXXX", openingBalance: 8000 },
];

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface CustomerDef {
  name: string;
  contact: string; // anonymized
  openingBalance: number; // rupees — what the customer owed at go-live
}

export const CUSTOMERS: CustomerDef[] = [
  { name: "Ram Sharma", contact: "+977-9841-11XXXX", openingBalance: 2000 },
  { name: "Sita Devi", contact: "+977-9851-22XXXX", openingBalance: 0 },
  { name: "Hari Prasad", contact: "+977-9842-33XXXX", openingBalance: 1500 },
  { name: "Gita Poudel", contact: "+977-9860-44XXXX", openingBalance: 500 },
  { name: "Krishna Thapa", contact: "+977-9812-55XXXX", openingBalance: 0 },
  { name: "Laxmi Gurung", contact: "+977-9841-66XXXX", openingBalance: 3000 },
  { name: "Suresh Rai", contact: "+977-9851-77XXXX", openingBalance: 0 },
  { name: "Anita Shrestha", contact: "+977-9842-88XXXX", openingBalance: 1000 },
  { name: "Bikash Tamang", contact: "+977-9860-99XXXX", openingBalance: 0 },
  { name: "Deepa Karki", contact: "+977-9812-10XXXX", openingBalance: 750 },
  { name: "Ramesh Adhikari", contact: "+977-9841-20XXXX", openingBalance: 0 },
  { name: "Sunita Magar", contact: "+977-9851-30XXXX", openingBalance: 2500 },
  { name: "Prakash Limbu", contact: "+977-9842-40XXXX", openingBalance: 0 },
  { name: "Kabita Bisht", contact: "+977-9860-50XXXX", openingBalance: 1200 },
  { name: "Rajan Khatri", contact: "+977-9812-60XXXX", openingBalance: 0 },
  { name: "Manisha Pandey", contact: "+977-9841-70XXXX", openingBalance: 400 },
  { name: "Nabin Chhetri", contact: "+977-9851-80XXXX", openingBalance: 0 },
  { name: "Pushpa Bhandari", contact: "+977-9842-90XXXX", openingBalance: 800 },
];

// ---------------------------------------------------------------------------
// Shop Settings
// ---------------------------------------------------------------------------

export const SHOP_SETTINGS = {
  goLiveAt: new Date("2026-07-15T00:00:00+05:45"),
  walletOpeningBalance: 50000, // Rs 50,000 — realistic starting cash box
};

// ---------------------------------------------------------------------------
// Purchases  (12 transactions)
// ---------------------------------------------------------------------------

export interface PurchaseItemDef {
  /** Index into PRODUCTS array */
  productIndex: number;
  /** Quantity in human units (seed converts to scaled) */
  quantity: number;
  /** Cost per human unit in rupees */
  costPerUnit: number;
}

export interface PurchaseDef {
  /** Index into SUPPLIERS array */
  supplierIndex: number;
  paymentType: "CASH" | "CREDIT";
  /** Day offset from Jul 15 (0 = Jul 16) */
  dayOffset: number;
  items: PurchaseItemDef[];
}

// Purchases are spread across the period, clustered on realistic market days.
// Each purchase restocks 1-3 products from a specific supplier.
export const PURCHASES: PurchaseDef[] = [
  // Week 1: initial restocking after go-live
  {
    supplierIndex: 0, // Himalayan Wholesale
    paymentType: "CASH",
    dayOffset: 1, // Jul 16
    items: [
      { productIndex: 0, quantity: 20, costPerUnit: 120 }, // Basmati Rice 20kg
      { productIndex: 1, quantity: 30, costPerUnit: 80 },  // Regular Rice 30kg
      { productIndex: 4, quantity: 10, costPerUnit: 180 }, // Cooking Oil 10L
    ],
  },
  {
    supplierIndex: 4, // Fresh Farm Direct
    paymentType: "CASH",
    dayOffset: 2, // Jul 17
    items: [
      { productIndex: 2, quantity: 15, costPerUnit: 140 }, // Red Lentils 15kg
      { productIndex: 9, quantity: 10, costPerUnit: 55 }, // Milk 10L
      { productIndex: 17, quantity: 10, costPerUnit: 8 },  // Eggs 10 packs (300 pcs)
    ],
  },
  {
    supplierIndex: 3, // Nepal Snacks & Beverages
    paymentType: "CREDIT",
    dayOffset: 3, // Jul 18
    items: [
      { productIndex: 15, quantity: 20, costPerUnit: 12 }, // Wai Wai 20 packs (240 pcs)
      { productIndex: 14, quantity: 15, costPerUnit: 10 }, // Biscuits 15 packs (360 pcs)
    ],
  },
  // Week 2
  {
    supplierIndex: 2, // Valley Cleaning
    paymentType: "CASH",
    dayOffset: 7, // Jul 22
    items: [
      { productIndex: 10, quantity: 20, costPerUnit: 60 },  // Toothpaste 20 pcs
      { productIndex: 11, quantity: 25, costPerUnit: 50 },  // Shampoo 25 pcs
      { productIndex: 13, quantity: 30, costPerUnit: 80 },  // Detergent 30 pcs
    ],
  },
  {
    supplierIndex: 0, // Himalayan Wholesale
    paymentType: "CREDIT",
    dayOffset: 9, // Jul 24
    items: [
      { productIndex: 0, quantity: 15, costPerUnit: 120 }, // Basmati Rice 15kg
      { productIndex: 5, quantity: 20, costPerUnit: 90 },  // Sugar 20kg
      { productIndex: 6, quantity: 15, costPerUnit: 20 },  // Salt 15kg
    ],
  },
  // Week 3
  {
    supplierIndex: 3, // Nepal Snacks & Beverages
    paymentType: "CASH",
    dayOffset: 14, // Jul 29
    items: [
      { productIndex: 16, quantity: 10, costPerUnit: 10 },  // Water 10 packs (120 pcs)
      { productIndex: 14, quantity: 10, costPerUnit: 10 },  // Biscuits 10 packs (240 pcs)
    ],
  },
  {
    supplierIndex: 4, // Fresh Farm Direct
    paymentType: "CREDIT",
    dayOffset: 16, // Jul 31
    items: [
      { productIndex: 9, quantity: 8, costPerUnit: 55 },   // Milk 8L
      { productIndex: 17, quantity: 5, costPerUnit: 8 },    // Eggs 5 packs (150 pcs)
    ],
  },
  // Week 4
  {
    supplierIndex: 0, // Himalayan Wholesale
    paymentType: "CASH",
    dayOffset: 21, // Aug 5
    items: [
      { productIndex: 1, quantity: 25, costPerUnit: 80 },   // Regular Rice 25kg
      { productIndex: 4, quantity: 8, costPerUnit: 180 },   // Cooking Oil 8L
      { productIndex: 3, quantity: 10, costPerUnit: 40 },   // Maida 10kg
    ],
  },
  {
    supplierIndex: 2, // Valley Cleaning
    paymentType: "CASH",
    dayOffset: 23, // Aug 7
    items: [
      { productIndex: 10, quantity: 15, costPerUnit: 60 },  // Toothpaste 15 pcs
      { productIndex: 13, quantity: 20, costPerUnit: 80 },  // Detergent 20 pcs
    ],
  },
  // Week 5 (partial)
  {
    supplierIndex: 3, // Nepal Snacks & Beverages
    paymentType: "CREDIT",
    dayOffset: 25, // Aug 9
    items: [
      { productIndex: 15, quantity: 15, costPerUnit: 12 },  // Wai Wai 15 packs (180 pcs)
      { productIndex: 16, quantity: 8, costPerUnit: 10 },   // Water 8 packs (96 pcs)
    ],
  },
  {
    supplierIndex: 4, // Fresh Farm Direct
    paymentType: "CASH",
    dayOffset: 26, // Aug 10
    items: [
      { productIndex: 2, quantity: 10, costPerUnit: 140 },  // Red Lentils 10kg
      { productIndex: 9, quantity: 5, costPerUnit: 55 },   // Milk 5L
    ],
  },
];

// ---------------------------------------------------------------------------
// Sales  (35 transactions)
// ---------------------------------------------------------------------------

export interface SaleItemDef {
  /** Index into PRODUCTS array */
  productIndex: number;
  /** Quantity in human units (seed converts to scaled) */
  quantity: number;
}

export interface SaleDef {
  /** Index into CUSTOMERS array, or null for walk-in */
  customerIndex: number | null;
  paymentType: "CASH" | "ECASH" | "CREDIT";
  /** Day offset from Jul 15 (0 = Jul 16) */
  dayOffset: number;
  items: SaleItemDef[];
}

// Sales are clustered on Tue/Fri/Sat (market days) with lighter activity
// on Mon/Wed. Some days have no sales. Mix of payment types.
// Tier-qualified quantities are included for Basmati Rice (5kg/10kg tiers)
// and Cooking Oil (3L/5L tiers).
export const SALES: SaleDef[] = [
  // --- Week 1: Jul 16-22 ---
  // Jul 16 (Thu) — light opening day
  { customerIndex: 0, paymentType: "CREDIT", dayOffset: 1, items: [
    { productIndex: 0, quantity: 5 }, { productIndex: 4, quantity: 2 },
  ]},
  { customerIndex: null, paymentType: "CASH", dayOffset: 1, items: [
    { productIndex: 9, quantity: 1 }, { productIndex: 14, quantity: 3 },
  ]},
  // Jul 17 (Fri) — busy
  { customerIndex: 2, paymentType: "CREDIT", dayOffset: 2, items: [
    { productIndex: 1, quantity: 10 }, { productIndex: 6, quantity: 2 },
  ]},
  { customerIndex: null, paymentType: "CASH", dayOffset: 2, items: [
    { productIndex: 0, quantity: 3 },
  ]},
  { customerIndex: null, paymentType: "ECASH", dayOffset: 2, items: [
    { productIndex: 5, quantity: 1 }, { productIndex: 8, quantity: 5 },
  ]},
  { customerIndex: 5, paymentType: "CREDIT", dayOffset: 2, items: [
    { productIndex: 4, quantity: 5 }, // tier-qualified: 5L Cooking Oil
  ]},
  // Jul 18 (Sat) — market day
  { customerIndex: null, paymentType: "CASH", dayOffset: 3, items: [
    { productIndex: 13, quantity: 6 }, { productIndex: 17, quantity: 12 },
  ]},
  { customerIndex: 3, paymentType: "CREDIT", dayOffset: 3, items: [
    { productIndex: 0, quantity: 10 }, // tier-qualified: 10kg Basmati
    { productIndex: 7, quantity: 2 },
  ]},
  { customerIndex: null, paymentType: "CASH", dayOffset: 3, items: [
    { productIndex: 14, quantity: 6 }, { productIndex: 15, quantity: 2 },
  ]},
  // Jul 20 (Mon) — light
  { customerIndex: null, paymentType: "CASH", dayOffset: 5, items: [
    { productIndex: 12, quantity: 2 },
  ]},
  // Jul 21 (Tue) — medium
  { customerIndex: 7, paymentType: "CREDIT", dayOffset: 6, items: [
    { productIndex: 1, quantity: 5 },
    { productIndex: 11, quantity: 3 },
  ]},
  { customerIndex: null, paymentType: "ECASH", dayOffset: 6, items: [
    { productIndex: 16, quantity: 12 },
  ]},

  // --- Week 2: Jul 23-29 ---
  // Jul 23 (Thu)
  { customerIndex: null, paymentType: "CASH", dayOffset: 8, items: [
    { productIndex: 9, quantity: 3 }, { productIndex: 13, quantity: 4 },
  ]},
  // Jul 24 (Fri) — busy
  { customerIndex: 1, paymentType: "CASH", dayOffset: 9, items: [
    { productIndex: 0, quantity: 3 },
    { productIndex: 2, quantity: 2 },
  ]},
  { customerIndex: 4, paymentType: "CREDIT", dayOffset: 9, items: [
    { productIndex: 4, quantity: 3 }, // tier-qualified: 3L Oil
    { productIndex: 5, quantity: 5 }, // tier-qualified: 5kg Sugar
  ]},
  { customerIndex: null, paymentType: "CASH", dayOffset: 9, items: [
    { productIndex: 14, quantity: 12 }, { productIndex: 17, quantity: 6 },
  ]},
  // Jul 25 (Sat) — market day
  { customerIndex: 6, paymentType: "CREDIT", dayOffset: 10, items: [
    { productIndex: 0, quantity: 5 },
    { productIndex: 10, quantity: 2 },
  ]},
  { customerIndex: null, paymentType: "CASH", dayOffset: 10, items: [
    { productIndex: 1, quantity: 2 },
  ]},
  { customerIndex: null, paymentType: "ECASH", dayOffset: 10, items: [
    { productIndex: 15, quantity: 1 }, { productIndex: 8, quantity: 2 },
  ]},
  // Jul 28 (Tue)
  { customerIndex: 8, paymentType: "CREDIT", dayOffset: 13, items: [
    { productIndex: 1, quantity: 10 }, // tier-qualified: 10kg Regular Rice
    { productIndex: 14, quantity: 6 },
  ]},
  { customerIndex: null, paymentType: "CASH", dayOffset: 13, items: [
    { productIndex: 12, quantity: 1 },
  ]},

  // --- Week 3: Jul 30 - Aug 5 ---
  // Jul 30 (Wed)
  { customerIndex: null, paymentType: "CASH", dayOffset: 15, items: [
    { productIndex: 16, quantity: 30 },
  ]},
  // Jul 31 (Thu)
  { customerIndex: 9, paymentType: "CREDIT", dayOffset: 16, items: [
    { productIndex: 2, quantity: 3 },
    { productIndex: 11, quantity: 2 },
  ]},
  // Aug 1 (Fri) — busy
  { customerIndex: null, paymentType: "CASH", dayOffset: 17, items: [
    { productIndex: 0, quantity: 3 }, { productIndex: 13, quantity: 6 },
  ]},
  { customerIndex: 10, paymentType: "CASH", dayOffset: 17, items: [
    { productIndex: 4, quantity: 5 }, // tier-qualified: 5L Oil
  ]},
  { customerIndex: null, paymentType: "ECASH", dayOffset: 17, items: [
    { productIndex: 17, quantity: 15 },
  ]},
  // Aug 2 (Sat) — market day
  { customerIndex: 13, paymentType: "CREDIT", dayOffset: 18, items: [
    { productIndex: 0, quantity: 5 },
    { productIndex: 3, quantity: 2 },
  ]},
  { customerIndex: null, paymentType: "CASH", dayOffset: 18, items: [
    { productIndex: 14, quantity: 12 }, { productIndex: 9, quantity: 1 },
  ]},
  // Aug 4 (Mon)
  { customerIndex: null, paymentType: "CASH", dayOffset: 20, items: [
    { productIndex: 12, quantity: 2 },
  ]},
  // Aug 5 (Tue)
  { customerIndex: 14, paymentType: "CREDIT", dayOffset: 21, items: [
    { productIndex: 1, quantity: 5 },
    { productIndex: 16, quantity: 12 },
  ]},

  // --- Week 4: Aug 6-12 ---
  // Aug 7 (Thu)
  { customerIndex: 15, paymentType: "CASH", dayOffset: 22, items: [
    { productIndex: 0, quantity: 3 },
    { productIndex: 7, quantity: 1 },
  ]},
  // Aug 8 (Fri) — busy
  { customerIndex: 16, paymentType: "CREDIT", dayOffset: 23, items: [
    { productIndex: 4, quantity: 3 }, // tier-qualified: 3L Oil
    { productIndex: 5, quantity: 2 },
  ]},
  { customerIndex: null, paymentType: "CASH", dayOffset: 23, items: [
    { productIndex: 14, quantity: 6 }, { productIndex: 17, quantity: 10 },
  ]},
  { customerIndex: null, paymentType: "ECASH", dayOffset: 23, items: [
    { productIndex: 1, quantity: 2 },
  ]},
  // Aug 9 (Sat) — market day
  { customerIndex: 17, paymentType: "CREDIT", dayOffset: 24, items: [
    { productIndex: 0, quantity: 5 },
    { productIndex: 15, quantity: 2 },
  ]},
  { customerIndex: null, paymentType: "CASH", dayOffset: 24, items: [
    { productIndex: 13, quantity: 4 }, { productIndex: 9, quantity: 2 },
  ]},
];

// ---------------------------------------------------------------------------
// Credit Payments  (10 transactions)
// ---------------------------------------------------------------------------

export interface CreditPaymentDef {
  /** Index into CUSTOMERS array */
  customerIndex: number;
  /** Amount in rupees */
  amount: number;
  /** Day offset from Jul 15 */
  dayOffset: number;
  /** Optional: index into SALES array (for linked payments) */
  saleIndex?: number;
}

// Customers pay down their credit balances over time. Some payments are linked
// to specific sales, others are general account payments.
export const CREDIT_PAYMENTS: CreditPaymentDef[] = [
  // Ram Sharma (customer 0) — pays down opening + credit sale
  { customerIndex: 0, amount: 1500, dayOffset: 5 },
  { customerIndex: 0, amount: 1000, dayOffset: 15, saleIndex: 0 },

  // Hari Prasad (customer 2) — partial payment
  { customerIndex: 2, amount: 2000, dayOffset: 10 },

  // Gita Poudel (customer 3) — linked payment
  { customerIndex: 3, amount: 1500, dayOffset: 12, saleIndex: 7 },

  // Laxmi Gurung (customer 5) — large payment
  { customerIndex: 5, amount: 3000, dayOffset: 14 },

  // Anita Shrestha (customer 8)
  { customerIndex: 8, amount: 1000, dayOffset: 20 },

  // Kabita Bisht (customer 13)
  { customerIndex: 13, amount: 1200, dayOffset: 22 },

  // Deepa Karki (customer 9)
  { customerIndex: 9, amount: 500, dayOffset: 25 },

  // Nabin Chhetri (customer 16) — pays after credit sale
  { customerIndex: 16, amount: 800, dayOffset: 26 },

  // Pushpa Bhandari (customer 17)
  { customerIndex: 17, amount: 600, dayOffset: 27 },
];

// ---------------------------------------------------------------------------
// Supplier Payments  (5 transactions)
// ---------------------------------------------------------------------------

export interface SupplierPaymentDef {
  /** Index into SUPPLIERS array */
  supplierIndex: number;
  /** Amount in rupees */
  amount: number;
  /** Day offset from Jul 15 */
  dayOffset: number;
}

// The shop pays down CREDIT purchase balances over time.
export const SUPPLIER_PAYMENTS: SupplierPaymentDef[] = [
  // Pay Himalayan Wholesale (supplier 0) — partially pays the Jul 24 CREDIT purchase
  { supplierIndex: 0, amount: 8000, dayOffset: 12 },

  // Pay Nepal Snacks (supplier 3) — partially pays the Jul 18 CREDIT purchase
  { supplierIndex: 3, amount: 3000, dayOffset: 18 },

  // Pay Fresh Farm Direct (supplier 4) — partially pays the Jul 31 CREDIT purchase
  { supplierIndex: 4, amount: 2000, dayOffset: 22 },

  // Pay Himalayan Wholesale again
  { supplierIndex: 0, amount: 5000, dayOffset: 26 },

  // Pay Nepal Snacks again
  { supplierIndex: 3, amount: 2000, dayOffset: 27 },
];

// ---------------------------------------------------------------------------
// Stock Adjustments  (3 transactions)
// ---------------------------------------------------------------------------

export interface StockAdjustmentDef {
  /** Index into PRODUCTS array */
  productIndex: number;
  reason: "DAMAGE" | "CORRECTION";
  /** Quantity in human units (positive = add stock for CORRECTION, negative = remove for DAMAGE) */
  quantity: number;
  /** Day offset from Jul 15 */
  dayOffset: number;
  note?: string;
}

export const STOCK_ADJUSTMENTS: StockAdjustmentDef[] = [
  // Damaged biscuits found during shelf check
  {
    productIndex: 14, // Biscuits
    reason: "DAMAGE",
    quantity: -12, // 12 biscuits damaged (1 pack)
    dayOffset: 11,
    note: "Expired cream biscuits found on shelf",
  },
  // Correction: milk count was off by 2L after delivery
  {
    productIndex: 9, // Milk
    reason: "CORRECTION",
    quantity: 2,
    dayOffset: 19,
    note: "Delivery count reconciliation — 2L unaccounted",
  },
  // Correction: egg count adjustment after breakage report
  {
    productIndex: 17, // Eggs
    reason: "CORRECTION",
    quantity: -5, // 5 eggs broken (not worth a DAMAGE entry)
    dayOffset: 25,
    note: "Weekly inventory count — minor breakage adjustment",
  },
];

// ---------------------------------------------------------------------------
// OWNER_WITHDRAWAL  (2 transactions)
// ---------------------------------------------------------------------------

export interface OwnerWithdrawalDef {
  /** Amount in rupees */
  amount: number;
  /** Day offset from Jul 15 */
  dayOffset: number;
  note: string;
}

export const OWNER_WITHDRAWALS: OwnerWithdrawalDef[] = [
  {
    amount: 3000,
    dayOffset: 10,
    note: "Owner withdrew cash for personal expenses",
  },
  {
    amount: 5000,
    dayOffset: 22,
    note: "Owner withdrew cash for household shopping",
  },
];

// ---------------------------------------------------------------------------
// Voids  (4 transactions)
// ---------------------------------------------------------------------------

export interface VoidDef {
  targetType: "SALE" | "CREDIT_PAYMENT" | "STOCK_MOVEMENT" | "PURCHASE";
  /** Index into the respective array (SALES, CREDIT_PAYMENTS, STOCK_ADJUSTMENTS, PURCHASES) */
  targetIndex: number;
  reason: string;
  /** Day offset from Jul 15 (when the void happens) */
  dayOffset: number;
  /** Owner who performs the void */
  voidedBy: string;
}

// 4 void scenarios:
// 1. Void a CASH sale — stock restored, wallet WITHDRAWAL (reverses DEPOSIT)
// 2. Void a CREDIT payment — customer balance restored, wallet WITHDRAWAL
// 3. Void a DAMAGE stock adjustment — stock restored
// 4. Void a CASH purchase — stock removed, wallet DEPOSIT (reverses WITHDRAWAL)
export const VOIDS: VoidDef[] = [
  // Void the DAMAGE adjustment on biscuits (stock movement #0 after opening)
  // This reverses the DAMAGE, so biscuits get 12 pieces back.
  {
    targetType: "STOCK_MOVEMENT",
    targetIndex: 0, // first stock adjustment
    reason: "Damage report was incorrect — biscuits still sellable",
    dayOffset: 13,
    voidedBy: "owner@erp.local",
  },

  // Void a CREDIT payment from Deepa Karki — she paid too early,
  // the amount was incorrect
  {
    targetType: "CREDIT_PAYMENT",
    targetIndex: 7, // Deepa Karki's payment (index 7 in CREDIT_PAYMENTS)
    reason: "Customer stated incorrect amount — payment reversed",
    dayOffset: 26,
    voidedBy: "owner@erp.local",
  },

  // Void a CASH sale (walk-in sale on Jul 20 — index 9 in SALES)
  // Stock is restored, wallet gets a WITHDRAWAL (reversing the original DEPOSIT)
  {
    targetType: "SALE",
    targetIndex: 9, // Jul 20 walk-in CASH sale (milk)
    reason: "Customer returned — wrong item purchased",
    dayOffset: 21,
    voidedBy: "owner@erp.local",
  },

  // Void a CASH purchase (Valley Cleaning, Jul 22 — index 3 in PURCHASES)
  // Stock is removed, wallet gets a DEPOSIT (reversing the original WITHDRAWAL)
  {
    targetType: "PURCHASE",
    targetIndex: 3, // Jul 22 CASH purchase from Valley Cleaning
    reason: "Supplier delivered wrong items — full return accepted",
    dayOffset: 24,
    voidedBy: "owner@erp.local",
  },
];
