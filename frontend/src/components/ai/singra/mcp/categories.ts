import type { McpCategory } from './types'

export interface McpCategoryItem {
  id: 'all' | McpCategory
  label: string
}

export const MCP_CATEGORIES: McpCategoryItem[] = [
  { id: 'all', label: 'Alle' },
  { id: 'code_cloud', label: 'Code & Cloud' },
  { id: 'design_media', label: 'Design & Medien' },
  { id: 'productivity', label: 'Produktivität & Office' },
  { id: 'commerce_finance', label: 'E-Commerce & Finanzen' },
  { id: 'communication', label: 'Team-Chat & CRM' },
  { id: 'storage_files', label: 'Dateien & Speicher' },
  { id: 'travel_lifestyle', label: 'Medien & Services' },
]
