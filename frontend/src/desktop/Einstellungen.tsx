/**
 * Die Einstellungen der Desktop-App — dieselbe Formensprache wie die
 * Panel-Einstellungen: eine Reiterleiste oben (`TabBar`, dieselbe Komponente
 * wie `/settings` und `/profile` im Panel), darunter Karten. Eigene Inhalte:
 * was dieser **Rechner** tut, nicht was das Panel tut.
 *
 * Zusammengehöriges steht in einem Reiter: Profil (was andere sehen) und
 * Konto (E-Mail, Zeitzone, Standortfreigabe, Export) sind getrennt wie im
 * Panel; Messenger-PIN, Tresor und Geräte stehen unter Sicherheit, Wake-Word
 * unter Audio. `?tab=` wählt einen Reiter vor; frühere Reiter (`wakeword`,
 * `messenger`, `tresor`, `account`) führen zu ihrem neuen Ort.
 *
 * Diese Datei wählt nur den Reiter; die Inhalte liegen je Reiter in
 * `einstellungsreiter/`.
 *
 * Offline bleiben alle Reiter sichtbar. Was auf diesem Gerät lebt (Desktop,
 * Audio, Sicherheit, Rechtliches, Gefahrenzone), geht weiter; Konto und
 * Sozial liegen auf dem Server und zeigen bis zur Rückkehr nur, dass sie
 * auf ihn warten — mit einem anderen Symbol schon im Reiter.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  FileSignature,
  Mail,
  MonitorCog,
  Shield,
  User,
  Users,
  Volume2,
  WifiOff,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { TabBar, type TabDef } from '@/components/ui/TabBar'
import { Zustandsflaeche } from '@/Singra/UI'
import { KontoTab } from '@/pages/profile/KontoTab'
import { ProfilTab } from '@/pages/profile/ProfilTab'
import { SocialTab } from '@/pages/profile/SocialTab'
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

type EinstellungsTab = 'profil' | 'konto' | 'sicherheit' | 'social' | 'desktop' | 'audio' | 'rechtliches' | 'gefahr'

/** Reiter, deren Inhalt nur aus dem Panel kommt. */
const BRAUCHT_SERVER: ReadonlySet<EinstellungsTab> = new Set(['profil', 'konto', 'social'])

const FRUEHERE_REITER: Record<string, EinstellungsTab> = {
  account: 'konto',
  messenger: 'sicherheit',
  tresor: 'sicherheit',
  wakeword: 'audio',
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

  const tabs: TabDef<EinstellungsTab>[] = useMemo(() => [
    { id: 'profil', labelKey: 'profile.tabs.profile', icon: offline ? WifiOff : User },
    { id: 'konto', labelKey: 'profile.tabs.account', icon: offline ? WifiOff : Mail },
    ...(social || tresorAn
      ? [{ id: 'sicherheit' as const, labelKey: 'profile.tabs.security', icon: Shield }]
      : []),
    ...(social ? [{ id: 'social' as const, labelKey: 'profile.tabs.social', icon: offline ? WifiOff : Users }] : []),
    {
      id: 'desktop',
      labelKey: isAndroidClient ? 'mss.einstellungen.tab.app' : 'mss.einstellungen.tab.desktop',
      icon: MonitorCog,
    },
    { id: 'audio', labelKey: 'mss.einstellungen.tab.audio', icon: Volume2 },
    { id: 'rechtliches', labelKey: 'mss.einstellungen.tab.rechtliches', icon: FileSignature },
    { id: 'gefahr', labelKey: 'mss.einstellungen.tab.gefahr', icon: AlertTriangle, variant: 'danger' },
  ], [social, tresorAn, offline])

  const tabAusSuche = useCallback((suche: string): EinstellungsTab => {
    const wunsch = new URLSearchParams(suche).get('tab') ?? ''
    const aufgeloest = FRUEHERE_REITER[wunsch] ?? wunsch
    return tabs.some((entry) => entry.id === aufgeloest) ? (aufgeloest as EinstellungsTab) : 'desktop'
  }, [tabs])

  const [tab, setTab] = useState<EinstellungsTab>(() => tabAusSuche(ort.search))

  useEffect(() => {
    setTab(tabAusSuche(ort.search))
  }, [ort.search, tabAusSuche])

  useEffect(() => {
    if (!tabs.some((entry) => entry.id === tab)) setTab('desktop')
  }, [tab, tabs])

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <TabBar
        tabs={tabs}
        active={tab}
        onChange={setTab}
        ariaLabel={t('mss.app.einstellungen')}
      />
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
            // Schlüssel der Kamera-Sicherung sind keine Daten des Nutzers und gehören in keine Datei.
            eintraege: () => useVaultStore.getState().items.filter((i) => i.category !== SYSTEM_KATEGORIE),
            entsperren: () => navigate('/tresor'),
          } : undefined}
        />
      )}
      {tab === 'sicherheit' && (
        <SicherheitEinstellungen offline={offline} social={social} tresorAn={tresorAn} />
      )}
      {tab === 'social' && !offline && <SocialTab />}
      {tab === 'desktop' && <DesktopIntegration onKonfigAenderung={onKonfigAenderung} offline={offline} />}
      {tab === 'audio' && (
        <>
          <AudioEinstellungen />
          <WakewordEinrichtung />
        </>
      )}
      {tab === 'rechtliches' && <RechtlichesEinstellungen offline={offline} />}
      {tab === 'gefahr' && <Gefahrenzone />}
    </div>
  )
}
