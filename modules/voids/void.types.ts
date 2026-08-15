// M18 void / correction domain types (D18).
// Voids are OWNER-only, whole-transaction, all-or-nothing (D18.1, D18.3). The
// original transactional record is never deleted; a VoidRecord row is written
// atomically together with the reversal of the transaction's financial and
// stock side effects (D18.7, D18.11).

export type VoidTargetType =
  | "SALE"
  | "PURCHASE"
  | "CREDIT_PAYMENT"
  | "SUPPLIER_PAYMENT"
  | "STOCK_MOVEMENT";

export interface VoidRecord {
  id: string;
  targetType: VoidTargetType;
  targetId: string;
  reason: string;
  note: string | null;
  voidedBy: string;
  voidedAt: Date;
}

export interface CreateVoidRecordInput {
  targetType: VoidTargetType;
  targetId: string;
  reason: string;
  note?: string;
  voidedBy: string;
}

export interface VoidInput {
  reason: string;
  note?: string;
  voidedBy: string;
}

// Returned by every void operation.
export interface VoidResult {
  voidId: string;
  targetType: VoidTargetType;
  targetId: string;
  reason: string;
  note: string | null;
  voidedAt: Date;
}

// Derived status attached to transaction domain objects (D18.9). `status` is
// computed at the API boundary; the repository only fills in the void facts.
export interface VoidInfo {
  voidedAt: Date | null;
  reason: string | null;
}

export interface VoidStatus {
  voidInfo: VoidInfo;
}

// API-output view of a transaction's void status (D18.9).
export type VoidStatusLabel = "ACTIVE" | "VOIDED";

export interface VoidStatusOutput {
  status: VoidStatusLabel;
  voidedAt: Date | null;
  voidReason: string | null;
}

export interface VoidRecordRepository {
  create(input: CreateVoidRecordInput): Promise<VoidRecord>;
  findByTarget(targetType: VoidTargetType, targetId: string): Promise<VoidRecord | null>;
}
