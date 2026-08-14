
// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (validators in, routes out).

// A price tier — one row of "buy at least this many, pay this price"
export interface PriceTier {
  minQty: number;
  price: number; // paisa
}

// A Product, as your app's business logic sees it —
export interface Product {
  id: string;
  name: string;
  category: string | null;
  unit: string;
  costPrice: number; // paisa
  currentPrice: number; // paisa
  stockQty: number;
  priceTiers: PriceTier[];
}


export interface CreateProductInput {
  name: string;
  category?: string;
  unit: string;
  costPrice: number;
  currentPrice: number;
  priceTiers?: PriceTier[];
}

export interface ProductRepository {
  create(input: CreateProductInput): Promise<Product>;
  findById(id: string): Promise<Product | null>;
  list(): Promise<Product[]>;
  updateStock(id: string, qtyChange: number): Promise<Product>;
  // Atomically decrement stock if sufficient quantity is available (F-02).
  // Returns the updated product on success, or null when stockQty < qty.
  // The successful atomic update is the authority for availability.
  reserveStock(id: string, qty: number): Promise<Product | null>;
  // Purchases reprice the product to the latest buying cost (see D2).
  updateCostPrice(id: string, costPrice: number): Promise<Product>;
}