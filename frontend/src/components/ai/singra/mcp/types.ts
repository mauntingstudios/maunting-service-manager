export type McpCategory =
  | 'code_cloud'
  | 'design_media'
  | 'productivity'
  | 'commerce_finance'
  | 'communication'
  | 'storage_files'
  | 'travel_lifestyle'

export type McpAuthType =
  | 'none'              // Kein Token nötig (z. B. lokales Dateisystem, Puppeteer-Browser)
  | 'token'             // API-Key, Personal Access Token (PAT), Secret
  | 'oauth_or_token'    // Unterstützt Browser-Login/OAuth oder Personal Access Token (z. B. Vercel, Supabase, GitHub)
  | 'connection_string' // Verbindungs-URL (z. B. Postgres postgresql://...)
  | 'custom'            // Spezifische Konfiguration

export interface SingraMcpPreset {
  id: string
  name: string
  description: string
  category: McpCategory
  transport: 'http' | 'sse' | 'stdio'
  endpoint_url?: string
  command?: string
  args?: string[]
  auth_header?: string
  badge: string

  // Modulare Auth- und Hilfestellungs-Informationen
  authType: McpAuthType
  authLabel?: string
  authPlaceholder?: string
  authHelp?: string
  docUrl?: string
  isOptionalAuth?: boolean
}
