import { prisma } from "../../lib/prisma";
import { paisaFromDecimal, paisaToRupees } from "../../lib/money";

import type {
  ShopSettings,
  SettingsRepository,
  UpdateSettingsInput,
} from "./settings.types";

type Db = {
  shopSettings: typeof prisma.shopSettings;
};

function toShopSettings(raw: {
  id: string;
  goLiveAt: Date;
  walletOpeningBalance: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ShopSettings {
  return {
    id: raw.id,
    goLiveAt: raw.goLiveAt,
    walletOpeningBalance: paisaFromDecimal(raw.walletOpeningBalance),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

// API output view: whole-paisa domain -> rupee wire representation (D11).
export function toSettingsApi(settings: ShopSettings): ShopSettings {
  return {
    ...settings,
    walletOpeningBalance: paisaToRupees(settings.walletOpeningBalance),
  };
}

const SINGLETON_ID = "singleton";

export class PrismaSettingsRepository implements SettingsRepository {
  constructor(private readonly db: Db = prisma) {}

  async findOrCreate(): Promise<ShopSettings> {
    const existing = await this.db.shopSettings.findUnique({
      where: { id: SINGLETON_ID },
    });

    if (existing) {
      return toShopSettings(existing);
    }

    // Create with a default go-live date of now if no settings exist yet.
    const created = await this.db.shopSettings.create({
      data: {
        id: SINGLETON_ID,
        goLiveAt: new Date(),
      },
    });

    return toShopSettings(created);
  }

  async update(input: UpdateSettingsInput): Promise<ShopSettings> {
    // Ensure the singleton row exists before updating.
    await this.findOrCreate();

    const data: Record<string, unknown> = {};

    if (input.goLiveAt !== undefined) {
      data.goLiveAt = input.goLiveAt;
    }

    if (input.walletOpeningBalance !== undefined) {
      data.walletOpeningBalance = paisaToRupees(input.walletOpeningBalance);
    }

    const raw = await this.db.shopSettings.update({
      where: { id: SINGLETON_ID },
      data,
    });

    return toShopSettings(raw);
  }
}
