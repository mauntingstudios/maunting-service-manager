import type { SingraMcpPreset } from './types'
import { CODE_CLOUD_PRESETS } from './presets/codeCloud'
import { DESIGN_MEDIA_PRESETS } from './presets/designMedia'
import { PRODUCTIVITY_PRESETS } from './presets/productivity'
import { COMMERCE_FINANCE_PRESETS } from './presets/commerceFinance'
import { COMMUNICATION_PRESETS } from './presets/communication'
import { STORAGE_FILES_PRESETS } from './presets/storageFiles'
import { MEDIA_LIFESTYLE_PRESETS } from './presets/mediaLifestyle'

export * from './types'
export * from './categories'

export const SINGRA_MCP_PRESETS: SingraMcpPreset[] = [
  ...COMMERCE_FINANCE_PRESETS,
  ...CODE_CLOUD_PRESETS,
  ...DESIGN_MEDIA_PRESETS,
  ...PRODUCTIVITY_PRESETS,
  ...COMMUNICATION_PRESETS,
  ...STORAGE_FILES_PRESETS,
  ...MEDIA_LIFESTYLE_PRESETS,
]
