import type { SingraMcpPreset } from '../types'

export const COMMERCE_FINANCE_PRESETS: SingraMcpPreset[] = [
  {
    id: 'stripe',
    name: 'Stripe Zahlungen & Abos MCP',
    description: 'Zahlungsflüsse, Kunden, Abonnements, Rechnungen und Auszahlungen direkt abfragen.',
    category: 'commerce_finance',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@stripe/mcp'],
    auth_header: 'Bearer <STRIPE_RESTRICTED_KEY>',
    badge: 'Zahlungen',
    authType: 'token',
    authLabel: 'Stripe Restricted API Key',
    authPlaceholder: 'Bearer rk_live_...',
    authHelp:
      'Im Stripe Dashboard unter Entwickler -> API-Schlüssel einen Restricted Key mit minimal nötigen Leserechten anlegen (z. B. Charges: Read, Customers: Read).',
    docUrl: 'https://dashboard.stripe.com/apikeys',
    isOptionalAuth: false,
  },
  {
    id: 'shopify',
    name: 'Shopify Store MCP',
    description: 'Shopify-Bestellungen, Produktkatalog, Kundenstammdaten und Inventar verwalten.',
    category: 'commerce_finance',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@shopify/mcp-server'],
    auth_header: 'Bearer <SHOPIFY_ADMIN_ACCESS_TOKEN>',
    badge: 'E-Commerce',
    authType: 'token',
    authLabel: 'Shopify Admin API Access Token',
    authPlaceholder: 'Bearer shpat_...',
    authHelp:
      'Im Shopify Admin unter Einstellungen -> Apps und Vertriebskanäle -> App entwickeln ein Admin API Token erstellen.',
    docUrl: 'https://help.shopify.com/manual/apps/custom-apps',
    isOptionalAuth: false,
  },
]
