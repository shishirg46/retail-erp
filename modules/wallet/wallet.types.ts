export type WalletTxnType = "DEPOSIT" | "WITHDRAWAL";

export type WalletTxnSource =
  | "SALE"
  | "CREDIT_PAYMENT"
  | "SUPPLIER_PAYMENT"
  | "OWNER_WITHDRAWAL"
  | "EXPENSE"
  | "BANK_DEPOSIT"
  | "OTHER";

export interface WalletTransaction {
  id: string;
  type: WalletTxnType;
  source: WalletTxnSource;
  amount: number;
  date: Date;
  note: string | null;
  saleId: string | null;
  creditPaymentId: string | null;
}

export interface CreateWalletTransactionInput {
  type: WalletTxnType;
  source: WalletTxnSource;
  amount: number;
  note?: string;
  saleId?: string;
  creditPaymentId?: string;
}

export interface WalletRepository {
  create(input: CreateWalletTransactionInput): Promise<WalletTransaction>;
}