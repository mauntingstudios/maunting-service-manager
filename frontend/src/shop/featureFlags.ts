/**
 * Phase-1-Schalter. `shop_enabled` ist bereits eine echte Panel-Einstellung;
 * die folgenden Bereiche sind sichtbar, aber noch Demo. In Phase 2/3 werden
 * sie durch echte Einstellungen bzw. Backend-Faehigkeiten ersetzt.
 */
export const SHOP_FEATURES = {
  payments: false,
  invoices: false,
  slots: false,
  hosterV2: false,
} as const

export type ShopFeature = keyof typeof SHOP_FEATURES
