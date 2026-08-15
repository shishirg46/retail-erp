import { Prisma } from "../../generated/prisma/client";
import { prisma } from "../../lib/prisma";
import { ConflictError } from "../../lib/errors";

import type {
  CreateVoidRecordInput,
  VoidRecord,
  VoidRecordRepository,
  VoidStatus,
  VoidTargetType,
} from "./void.types";

type Db = {
  voidRecord: typeof prisma.voidRecord;
};

function toVoidRecord(raw: {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  note: string | null;
  voidedBy: string;
  voidedAt: Date;
}): VoidRecord {
  return {
    id: raw.id,
    targetType: raw.targetType as VoidRecord["targetType"],
    targetId: raw.targetId,
    reason: raw.reason,
    note: raw.note,
    voidedBy: raw.voidedBy,
    voidedAt: raw.voidedAt,
  };
}

export class PrismaVoidRecordRepository implements VoidRecordRepository {
  constructor(private readonly db: Db = prisma) {}

  async create(input: CreateVoidRecordInput): Promise<VoidRecord> {
    // The unique (targetType, targetId) constraint is the authoritative
    // double-void protection (D18.11); a lost race surfaces as a clean 409.
    try {
      const raw = await this.db.voidRecord.create({
        data: {
          targetType: input.targetType,
          targetId: input.targetId,
          reason: input.reason,
          note: input.note,
          voidedBy: input.voidedBy,
        },
      });

      return toVoidRecord(raw);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictError(
          `This ${input.targetType.toLowerCase().replace("_", " ")} is already voided`
        );
      }
      throw error;
    }
  }

  async findByTarget(
    targetType: VoidTargetType,
    targetId: string
  ): Promise<VoidRecord | null> {
    const raw = await this.db.voidRecord.findUnique({
      where: { targetType_targetId: { targetType, targetId } },
    });

    return raw ? toVoidRecord(raw) : null;
  }

  // IDs of every record of a type that has been voided — used by reports to
  // exclude voided activity and by repositories to derive status (D18.8/D18.9).
  async listVoidedTargetIds(targetType: VoidTargetType): Promise<string[]> {
    const rows = await this.db.voidRecord.findMany({
      where: { targetType },
      select: { targetId: true },
    });

    return rows.map((row) => row.targetId);
  }
}

// Attach void facts (voidedAt, reason) to a batch of already-mapped domain
// rows, keyed by their id. Used by module repositories so list/detail APIs can
// derive `status` at the output boundary (D18.9) without per-row queries.
export async function attachVoidStatus<T extends { id: string }>(
  db: Db,
  targetType: VoidTargetType,
  rows: T[]
): Promise<(T & VoidStatus)[]> {
  if (rows.length === 0) return [];

  const records = await db.voidRecord.findMany({
    where: { targetType, targetId: { in: rows.map((row) => row.id) } },
    select: { targetId: true, voidedAt: true, reason: true },
  });

  const byId = new Map(records.map((record) => [record.targetId, record]));

  return rows.map((row) => {
    const record = byId.get(row.id);
    return {
      ...row,
      voidInfo: record
        ? { voidedAt: record.voidedAt, reason: record.reason }
        : { voidedAt: null, reason: null },
    };
  });
}
