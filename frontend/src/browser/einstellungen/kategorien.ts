import type { LucideIcon } from 'lucide-react'
import {
  Blocks,
  Download,
  Gauge,
  History,
  Info,
  KeyRound,
  Mail,
  Palette,
  Puzzle,
  Search,
  Shield,
  ShieldBan,
  ShieldCheck,
  SlidersHorizontal,
  User,
  Users,
} from 'lucide-react'

export type Kategorie =
  | 'allgemein'
  | 'suche'
  | 'schutz'
  | 'jugendschutz'
  | 'verlauf'
  | 'passwoerter'
  | 'downloads'
  | 'erweiterungen'
  | 'design'
  | 'leistung'
  | 'dienste'
  | 'profil'
  | 'konto'
  | 'sicherheit'
  | 'soziales'
  | 'ueber'

export const KATEGORIEN: { id: Kategorie; symbol: LucideIcon; unterpunkt?: boolean }[] = [
  { id: 'allgemein', symbol: SlidersHorizontal },
  { id: 'suche', symbol: Search },
  { id: 'schutz', symbol: ShieldCheck },
  { id: 'jugendschutz', symbol: ShieldBan },
  { id: 'verlauf', symbol: History },
  { id: 'passwoerter', symbol: KeyRound },
  { id: 'downloads', symbol: Download },
  { id: 'erweiterungen', symbol: Puzzle },
  { id: 'design', symbol: Palette },
  { id: 'leistung', symbol: Gauge },
  { id: 'dienste', symbol: Blocks },
  { id: 'profil', symbol: User, unterpunkt: true },
  { id: 'konto', symbol: Mail, unterpunkt: true },
  { id: 'sicherheit', symbol: Shield, unterpunkt: true },
  { id: 'soziales', symbol: Users, unterpunkt: true },
  { id: 'ueber', symbol: Info },
]

/**
 * Was das Gerät kann: auf Android schlafen Tabs nicht nach Regeln des Browsers,
 * und Erweiterungen kennt die WebView nicht. Profil, Konto, Sicherheit und
 * Soziales gehören zum MSM-Konto und brauchen die Kopplung.
 */
export function sichtbareKategorien(android: boolean, gekoppelt = false, social = true) {
  return KATEGORIEN.filter((k) => {
    if (android && (k.id === 'leistung' || k.id === 'erweiterungen')) return false
    if ((k.id === 'sicherheit' || k.id === 'profil' || k.id === 'konto') && !gekoppelt) return false
    if (k.id === 'soziales' && (!gekoppelt || !social)) return false
    return true
  })
}

/** Unterseite mit der Datenschutzerklärung, erreichbar aus „Über“. */
export const DATENSCHUTZ_TEIL = 'datenschutzerklaerung'
