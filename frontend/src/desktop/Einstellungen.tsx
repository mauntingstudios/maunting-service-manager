/**
 * Die Einstellungen der Desktop-App — dieselbe Formensprache wie die
 * Panel-Einstellungen: links die Abschnitte, rechts die Zeilen. Eigene Inhalte:
 * was dieser **Rechner** tut, nicht was das Panel tut.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Bot,
  FileSignature,
  Link2,
  Mail,
  MonitorCog,
  Shield,
  User,
  Users,
  Volume2,
  WifiOff,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SettingsLayout, Zustandsflaeche, type SettingsSectionEintrag } from '@maunting/ui'
import { KontoTab } from '@/pages/profile/KontoTab'
import { ProfilTab } from '@/pages/profile/ProfilTab'
import { SocialTab } from '@/pages/profile/SocialTab'
import { AiTab } from '@/pages/profile/AiTab'
import { LinkedAccountsTab } from '@/pages/profile/LinkedAccountsTab'
import { CredentialsTab } from '@/pages/profile/CredentialsTab'
import { useHasPermission } from '@/hooks/useHasPermission'
import { SYSTEM_KATEGORIE } from './vault/vaultEintrag'
import { useVaultStore } from './vault/vaultStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { Gefahrenzone } from './Gefahrenzone'
import { WakewordEinrichtung } from './WakewordEinrichtung'
import {
  AudioEinstellungen,
  DesktopIntegration,
  RechtlichesEinstellungen,
  SicherheitEinstellungen,
} from './einstellungsreiter'

type EinstellungsTab =
  | 'profil'
  | 'konto'
  | 'sicherheit'
  | 'social'
  | 'verbindungen'
  | 'ki'
  | 'desktop'
  | 'audio'
  | 'rechtliches'
  | 'gefahr'

const BRAUCHT_SERVER: ReadonlySet<EinstellungsTab> = new Set([
  'profil',
  'konto',
  'social',
  'verbindungen',
  'ki',
])

const FRUEHERE_REITER: Record<string, EinstellungsTab> = {
  account: 'konto',
  messenger: 'sicherheit',
  tresor: 'sicherheit',
  wakeword: 'audio',
  gedaechtnis: 'ki',
  ai: 'ki',
  connections: 'verbindungen',
  credentials: 'verbindungen',
  linked: 'verbindungen',
}

const isAndroidClient = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)

export function Einstellungen({
  onKonfigAenderung,
  offline = false,
}: {
  onKonfigAenderung?: () => void
  offline?: boolean
}) {
  const { t } = useTranslation()
  const ort = useLocation()
  const navigate = useNavigate()
  const publicSettings = usePublicSettingsStore()
  const social = publicSettings.social_enabled
  const tresorAn = publicSettings.vault_enabled
  const tresorEntsperrt = useVaultStore((s) => s.isUnlocked)
  const canUseAi = useHasPermission('ai.chat.use') || useHasPermission('ai.memory.use')

  const sections: SettingsSectionEintrag<EinstellungsTab>[] = useMemo(() => [
    { id: 'profil', label: t('profile.tabs.profile'), icon: offline ? WifiOff : User, group: t('mss.einstellungen.groups.identitaet') },
    { id: 'konto', label: t('profile.tabs.account'), icon: offline ? WifiOff : Mail, group: t('mss.einstellungen.groups.identitaet') },
    ...(social || tresorAn
      ? [{ id: 'sicherheit' as const, label: t('profile.tabs.security'), icon: Shield, group: t('mss.einstellungen.groups.schutz') }]
      : []),
    ...(social ? [{ id: 'social' as const, label: t('profile.tabs.social'), icon: offline ? WifiOff : Users, group: t('mss.einstellungen.groups.schutz') }] : []),
    { id: 'verbindungen' as const, label: t('profile.tabs.connections'), icon: offline ? WifiOff : Link2, group: t('mss.einstellungen.groups.schutz') },
    ...(canUseAi || offline
      ? [{ id: 'ki' as const, label: t('profile.tabs.ai'), icon: offline ? WifiOff : Bot, group: t('mss.einstellungen.groups.arbeit') }]
      : []),
    {
      id: 'desktop',
      label: t(isAndroidClient ? 'mss.einstellungen.tab.app' : 'mss.einstellungen.tab.desktop'),
      icon: MonitorCog,
      group: t('mss.einstellungen.groups.app'),
    },
    { id: 'audio', label: t('mss.einstellungen.tab.audio'), icon: Volume2, group: t('mss.einstellungen.groups.arbeit') },
    { id: 'rechtliches', label: t('mss.einstellungen.tab.rechtliches'), icon: FileSignature, group: t('mss.einstellungen.groups.erweitert') },
    { id: 'gefahr', label: t('mss.einstellungen.tab.gefahr'), icon: AlertTriangle, tone: 'danger', group: t('mss.einstellungen.groups.erweitert') },
  ], [social, tresorAn, offline, canUseAi, t])

  const tabAusSuche = useCallback((suche: string): EinstellungsTab => {
    const wunsch = new URLSearchParams(suche).get('tab') ?? ''
    const aufgeloest = FRUEHERE_REITER[wunsch] ?? wunsch
    return sections.some((entry) => entry.id === aufgeloest) ? (aufgeloest as EinstellungsTab) : 'desktop'
  }, [sections])

  const [tab, setTab] = useState<EinstellungsTab>(() => tabAusSuche(ort.search))

  useEffect(() => {
    setTab(tabAusSuche(ort.search))
  }, [ort.search, tabAusSuche])

  useEffect(() => {
    if (!sections.some((entry) => entry.id === tab)) setTab('desktop')
  }, [tab, sections])

  return (
    <div className="mx-auto w-full max-w-[1440px]">
      <SettingsLayout
        sections={sections}
        active={tab}
        onChange={setTab}
        title={t('common.settings')}
      >
        {offline && BRAUCHT_SERVER.has(tab) && (
          <section className="msm-card">
            <Zustandsflaeche
              art="offline"
              titel={t('mss.einstellungen.offline.titel')}
              text={t('mss.einstellungen.offline.text')}
            />
          </section>
        )}
        {tab === 'profil' && !offline && <ProfilTab social={social} />}
        {tab === 'konto' && !offline && (
          <KontoTab
            tresor={tresorAn ? {
              entsperrt: tresorEntsperrt,
              eintraege: () => useVaultStore.getState().items.filter((i) => i.category !== SYSTEM_KATEGORIE),
              entsperren: () => navigate('/tresor'),
            } : undefined}
          />
        )}
        {tab === 'sicherheit' && <SicherheitEinstellungen offline={offline} social={social} tresorAn={tresorAn} />}
        {tab === 'social' && !offline && <SocialTab />}
        {tab === 'verbindungen' && !offline && (
          <div className="space-y-6">
            <LinkedAccountsTab />
            <CredentialsTab />
          </div>
        )}
        {tab === 'ki' && !offline && <AiTab />}
        {tab === 'desktop' && <DesktopIntegration onKonfigAenderung={onKonfigAenderung} offline={offline} />}
        {tab === 'audio' && (
          <>
            <AudioEinstellungen />
            <WakewordEinrichtung />
          </>
        )}
        {tab === 'rechtliches' && <RechtlichesEinstellungen offline={offline} />}
        {tab === 'gefahr' && <Gefahrenzone />}
      </SettingsLayout>
    </div>
  )
}
