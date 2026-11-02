import { Brain, ShieldCheck, Users } from 'lucide-react'
import type { RechteAbschnittDefinition, RechteZeile } from '@/Singra/UI'

export const ROLE_COLOR_PRESETS = [
  { label: 'Blau', value: '#3b82f6' },
  { label: 'Smaragd', value: '#10b981' },
  { label: 'Violett', value: '#8b5cf6' },
  { label: 'Bernstein', value: '#f59e0b' },
  { label: 'Rose', value: '#f43f5e' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Schiefer', value: '#64748b' },
] as const

export const TEAM_PERMISSION_DEFINITIONS: readonly RechteZeile[] = [
  // Teamverwaltung
  {
    key: 'team.members.invite',
    kategorie: 'team',
    titel: 'Mitglieder einladen',
    beschreibung: 'Darf neue Mitglieder in das Team einladen.',
    kennung: 'team.members.invite',
  },
  {
    key: 'team.members.kick',
    kategorie: 'team',
    titel: 'Mitglieder entfernen',
    beschreibung: 'Darf bestehende Mitglieder aus dem Team ausschließen.',
    kennung: 'team.members.kick',
  },
  {
    key: 'team.roles.manage',
    kategorie: 'team',
    titel: 'Team-Rollen verwalten',
    beschreibung: 'Darf Rollen erstellen, anpassen und Mitgliedern zuweisen.',
    kennung: 'team.roles.manage',
  },
  {
    key: 'team.servers.manage',
    kategorie: 'team',
    titel: 'Team-Server verwalten',
    beschreibung: 'Darf Server-Freigaben und Rechte des Teams anpassen.',
    kennung: 'team.servers.manage',
  },
  // KI & Wissen
  {
    key: 'ai.memory.read',
    kategorie: 'ai',
    titel: 'Team-Gedächtnis einsehen',
    beschreibung: 'Darf geteilte KI-Erinnerungen des Teams lesen.',
    kennung: 'ai.memory.read',
  },
  {
    key: 'ai.memory.write',
    kategorie: 'ai',
    titel: 'Team-Gedächtnis bearbeiten',
    beschreibung: 'Darf KI-Erinnerungen für das Team anlegen und löschen.',
    kennung: 'ai.memory.write',
  },
  {
    key: 'ai.skills.use',
    kategorie: 'ai',
    titel: 'Team-Skills ausführen',
    beschreibung: 'Darf freigegebene KI-Skills des Teams aufrufen.',
    kennung: 'ai.skills.use',
  },
  {
    key: 'ai.skills.manage',
    kategorie: 'ai',
    titel: 'Team-Skills verwalten',
    beschreibung: 'Darf Fähigkeiten und Skills für das Team erstellen und anpassen.',
    kennung: 'ai.skills.manage',
  },
  {
    key: 'ai.team_context.use',
    kategorie: 'ai',
    titel: 'Team-Kontext nutzen',
    beschreibung: 'Erlaubt der KI, geteiltes Wissen automatisch in Konversationen einzubinden.',
    kennung: 'ai.team_context.use',
  },
  // Team-Tresor
  {
    key: 'vault.read',
    kategorie: 'vault',
    titel: 'Team-Tresor einsehen',
    beschreibung: 'Darf geteilte Einträge im Team-Tresor entschlüsseln.',
    kennung: 'vault.read',
  },
  {
    key: 'vault.write',
    kategorie: 'vault',
    titel: 'Tresor-Einträge bearbeiten',
    beschreibung: 'Darf neue Passwörter und Einträge im Team-Tresor anlegen und bearbeiten.',
    kennung: 'vault.write',
  },
  {
    key: 'vault.files',
    kategorie: 'vault',
    titel: 'Dateianhänge verwalten',
    beschreibung: 'Darf Dokumente und Dateien im Team-Tresor verwalten.',
    kennung: 'vault.files',
  },
] as const

export const TEAM_PERMISSION_ABSCHNITTE: readonly RechteAbschnittDefinition[] = [
  {
    titel: 'Teamverwaltung',
    symbol: Users,
    kategorien: ['team'],
  },
  {
    titel: 'KI & Wissen',
    symbol: Brain,
    kategorien: ['ai'],
  },
  {
    titel: 'Team-Tresor',
    symbol: ShieldCheck,
    kategorien: ['vault'],
  },
] as const
