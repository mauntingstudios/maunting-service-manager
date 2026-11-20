import type { LucideIcon } from 'lucide-react'
import {
  Building2,
  Factory,
  Flame,
  Mountain,
  Rocket,
  Skull,
  Snowflake,
  Sun,
  Trees,
  Waves,
} from 'lucide-react'

interface Motiv {
  klassen: string
  icon: LucideIcon
}

/**
 * Nur semantische Tokens: Die Gradienten unterscheiden sich in Farbton und
 * Deckkraft, nicht ueber eine Rohpalette. `check-classes` wuerde sonst
 * `from-emerald-500` & Co. beanstanden.
 */
const MOTIVE: Record<string, Motiv> = {
  dschungel: {
    klassen: 'from-status-success/25 via-surface-container-high to-background',
    icon: Trees,
  },
  wueste: {
    klassen: 'from-status-warning/20 via-surface-container-high to-background',
    icon: Sun,
  },
  eis: {
    klassen: 'from-primary/20 via-surface-container-high to-background',
    icon: Snowflake,
  },
  wald: {
    klassen: 'from-status-success/15 via-surface-container-highest to-background',
    icon: Mountain,
  },
  stadt: {
    klassen: 'from-secondary/20 via-surface-container-high to-background',
    icon: Building2,
  },
  weltraum: {
    klassen: 'from-cyan-glow/20 via-surface-container-high to-background',
    icon: Rocket,
  },
  fabrik: {
    klassen: 'from-status-warning/15 via-surface-container-highest to-background',
    icon: Factory,
  },
  insel: {
    klassen: 'from-primary/15 via-surface-container-high to-background',
    icon: Waves,
  },
  hoehle: {
    klassen: 'from-status-destructive/15 via-surface-container-high to-background',
    icon: Skull,
  },
  vulkan: {
    klassen: 'from-status-destructive/20 via-surface-container-highest to-background',
    icon: Flame,
  },
}

const FALLBACK: Motiv = {
  klassen: 'from-primary/20 via-surface-container-high to-background',
  icon: Rocket,
}

export function motivFuer(schluessel: string): Motiv {
  return MOTIVE[schluessel] ?? FALLBACK
}
