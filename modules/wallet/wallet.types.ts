// Money is whole paisa in the domain (D11). Rupee values convert at the
// repository boundary (write: paisa -> Decimal rupees; read: the reverse).
export type WalletTxnType = "DEPOSIT" | "WITHDRAWAL";

export type WalletTxnSource =
  | "SALE"
  | "CREDIT_PAYMENT"
  | "SUPPLIER_PAYMENT"
  | "OWNER_WITHDRAWAL"
  | "EXPENSE"
  | "BANK_DEPOSIT"
  | "OTHER"
  | "VOID";

export interface WalletTransaction {
  id: string;
  type: WalletTxnType;
  source: WalletTxnSource;
  amount: number; // paisa
  date: Date;
  note: string | null;
  saleId: string | null;
  purchaseId: string | null;
  creditPaymentId: string | null;
  supplierPaymentId: string | null;
}

export interface CreateWalletTransactionInput {
  type: WalletTxnType;
  source: WalletTxnSource;
  amount: number; // paisa
  note?: string;
  saleId?: string;
  purchaseId?: string;
  creditPaymentId?: string;
  supplierPaymentId?: string;
}

export interface WalletRepository {
  create(input: CreateWalletTransactionInput): Promise<WalletTransaction>;
}