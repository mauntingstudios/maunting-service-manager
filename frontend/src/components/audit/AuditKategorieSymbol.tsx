import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  CreditCard,
  FileText,
  HardDrive,
  History,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  UserRound,
  Users,
} from 'lucide-react'
import type { AuditKategorie } from '@/services/auditPresentation'

interface Stil {
  icon: LucideIcon
  flaeche: string
}

/**
 * Ein Symbol je Audit-Kategorie. Die Farben bleiben bei den semantischen
 * Tokens der Design-DNA: Rot nur fuer Sicherheit, Gelb fuer Konfiguration,
 * Gruen fuer Benutzer. Die Kategorie ist Darstellung, keine Bewertung.
 */
const STILE: Record<AuditKategorie, Stil> = {
  server: { icon: Server, flaeche: 'border-primary/25 bg-primary/10 text-primary' },
  configuration: {
    icon: SlidersHorizontal,
    flaeche: 'border-status-warning/25 bg-status-warning/10 text-status-warning',
  },
  user: {
    icon: UserRound,
    flaeche: 'border-status-success/25 bg-status-success/10 text-status-success',
  },
  role: { icon: ShieldCheck, flaeche: 'border-secondary/25 bg-secondary/10 text-secondary' },
  team: { icon: Users, flaeche: 'border-primary/20 bg-primary/10 text-primary' },
  backup: {
    icon: HardDrive,
    flaeche: 'border-outline-variant bg-surface-container-high text-on-surface',
  },
  security: {
    icon: ShieldCheck,
    flaeche: 'border-status-destructive/25 bg-status-destructive/10 text-status-destructive',
  },
  ai: { icon: Bot, flaeche: 'border-secondary/20 bg-secondary/10 text-secondary' },
  docs: { icon: FileText, flaeche: 'border-primary/20 bg-primary/10 text-primary' },
  billing: {
    icon: CreditCard,
    flaeche: 'border-status-warning/20 bg-status-warning/10 text-status-warning',
  },
  system: {
    icon: History,
    flaeche: 'border-outline-variant bg-surface-container-high text-on-surface-variant',
  },
}

export function AuditKategorieSymbol({
  kategorie,
  groesse = 'sm',
  className = '',
}: {
  kategorie: AuditKategorie
  groesse?: 'sm' | 'md'
  className?: string
}) {
  const stil = STILE[kategorie] ?? STILE.system
  const Icon = stil.icon
  const kasten = groesse === 'md' ? 'h-10 w-10 rounded-xl' : 'h-8 w-8 rounded-lg'
  const symbol = groesse === 'md' ? 'h-5 w-5' : 'h-4 w-4'
  return (
    <span
      className={`flex shrink-0 items-center justify-center border ${kasten} ${stil.flaeche} ${className}`}
      aria-hidden="true"
    >
      <Icon className={symbol} />
    </span>
  )
}
