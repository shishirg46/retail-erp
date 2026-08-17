import type { ShopSettings, SettingsRepository, UpdateSettingsInput } from "./settings.types";

export class SettingsService {
  constructor(private readonly repository: SettingsRepository) {}

  async getSettings(): Promise<ShopSettings> {
    return this.repository.findOrCreate();
  }

  async updateSettings(input: UpdateSettingsInput): Promise<ShopSettings> {
    return this.repository.update(input);
  }
}
