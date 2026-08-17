// Money is whole paisa in the domain (D11). Rupee values convert at the
// API boundary (routes out; settings accept rupee values on input).

export interface ShopSettings {
  id: string;
  goLiveAt: Date;
  walletOpeningBalance: number; // paisa; cash-box balance at ERP go-live (D26)
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateSettingsInput {
  goLiveAt?: Date;
  walletOpeningBalance?: number; // paisa; optional
}

export interface SettingsRepository {
  findOrCreate(): Promise<ShopSettings>;
  update(input: UpdateSettingsInput): Promise<ShopSettings>;
}
