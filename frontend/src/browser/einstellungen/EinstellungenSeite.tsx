/**
 * Die Einstellungen als eigene Seite im Tab (`msb://einstellungen/<kategorie>`).
 * Links die Kategorien, rechts ihr Inhalt; ist die Fläche schmal, stehen die
 * Kategorien als wischbare Reiterleiste oben. Die Kategorie steht in der
 * Adresse des Tabs, nicht in einem Zustand daneben.
 */
import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { Button, SettingsLayout, Spinner, type SettingsSectionEintrag } from '@maunting/ui'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

import { istGekoppelt, useSitzung } from '../services/sitzung'
import { useTabsStore } from '../services/tabsStore'
import { Allgemein } from './Allgemein'
import { Abschnitt, Aktionszeile } from './bausteine'
import { Design } from './Design'
import { Dienste } from './Dienste'
import { Downloads } from './Downloads'
import { Erweiterungen } from './Erweiterungen'
import { Jugendschutz } from './Jugendschutz'
import { istAndroid } from '../services/plattform'
import { DATENSCHUTZ_TEIL, sichtbareKategorien, type Kategorie } from './kategorien'
import { Leistung } from './Leistung'
import { Passwoerter } from './Passwoerter'
import { Schutz } from './Schutz'
import { Suche } from './Suche'
import { Ueber } from './Ueber'
import { VerlaufDaten } from './VerlaufDaten'

const Privacy = lazy(() => import('@/pages/Privacy').then((m) => ({ default: m.Privacy })))
const SicherheitEinstellungen = lazy(() =>
  import('@/desktop/einstellungsreiter/SicherheitEinstellungen').then((m) => ({
    default: m.SicherheitEinstellungen,
  })),
)
const ProfilTab = lazy(() => import('@/pages/profile/ProfilTab').then((m) => ({ default: m.ProfilTab })))
const KontoTab = lazy(() => import('@/pages/profile/KontoTab').then((m) => ({ default: m.KontoTab })))
const SocialTab = lazy(() => import('@/pages/profile/SocialTab').then((m) => ({ default: m.SocialTab })))
const AiTab = lazy(() => import('@/pages/profile/AiTab').then((m) => ({ default: m.AiTab })))

type GekoppelteKategorie = 'profil' | 'konto' | 'soziales' | 'ki'

const INHALT: Record<Exclude<Kategorie, 'sicherheit' | GekoppelteKategorie>, () => JSX.Element | null> = {
  allgemein: Allgemein,
  suche: Suche,
  schutz: Schutz,
  jugendschutz: Jugendschutz,
  verlauf: VerlaufDaten,
  passwoerter: Passwoerter,
  downloads: Downloads,
  erweiterungen: Erweiterungen,
  design: Design,
  leistung: Leistung,
  dienste: Dienste,
  ueber: Ueber,
}

/** Profil, Konto und Soziales liegen auf dem Server und brauchen die Kopplung. */
function GekoppelteSeite({ teil }: { teil: GekoppelteKategorie }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const stand = useSitzung((s) => s.stand)
  const social = usePublicSettingsStore((s) => s.social_enabled)

  if (stand === 'pruefen') {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!istGekoppelt(stand)) {
    return (
      <Abschnitt titel={t(`browser.einstellungen.kategorie.${teil}`)}>
        <Aktionszeile name={t('browser.einstellungen.nichtGekoppelt')}>
          <Button variant="secondary" size="sm" onClick={() => navigate('/koppeln')}>
            {t('browser.leiste.koppeln')}
          </Button>
        </Aktionszeile>
      </Abschnitt>
    )
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      }
    >
      {teil === 'profil' && <ProfilTab social={social} />}
      {teil === 'konto' && <KontoTab />}
      {teil === 'soziales' && <SocialTab />}
      {teil === 'ki' && <AiTab />}
    </Suspense>
  )
}

function SicherheitSeite({ offline }: { offline: boolean }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const stand = useSitzung((s) => s.stand)

  if (stand === 'pruefen') {
    return (
      <div className="flex h-40 items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (!istGekoppelt(stand)) {
    return (
      <Abschnitt titel={t('browser.einstellungen.kategorie.sicherheit')}>
        <Aktionszeile name={t('browser.einstellungen.nichtGekoppelt')}>
          <Button variant="secondary" size="sm" onClick={() => navigate('/koppeln')}>
            {t('browser.leiste.koppeln')}
          </Button>
        </Aktionszeile>
      </Abschnitt>
    )
  }

  return (
    <Suspense
      fallback={
        <div className="flex h-40 items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <SicherheitEinstellungen offline={offline} />
    </Suspense>
  )
}

export function EinstellungenSeite({ teil }: { teil: string | null }) {
  const { t } = useTranslation()
  const oeffnen = useTabsStore((s) => s.einstellungen)
  const stand = useSitzung((s) => s.stand)
  const social = usePublicSettingsStore((s) => s.social_enabled)
  const gekoppelt = istGekoppelt(stand)

  if (teil === DATENSCHUTZ_TEIL) {
    return (
      <div className="h-full overflow-y-auto">
        <Suspense fallback={null}>
          <Privacy zurueck="/" zurueckAktion={() => oeffnen('ueber')} />
        </Suspense>
      </div>
    )
  }

  const kategorien = sichtbareKategorien(istAndroid(), gekoppelt, social)
  // Profil und Konto zeigen auch ungekoppelt den Kopplungshinweis, statt still
  // auf „Allgemein" zu springen; Soziales gibt es ohne Messenger nicht.
  const angefordert: Kategorie | null = teil === 'sicherheit'
    ? 'sicherheit'
    : teil === 'profil' || teil === 'konto' || teil === 'ki'
      ? teil
      : teil === 'soziales' && social
        ? 'soziales'
        : null
  const kategorie = angefordert ?? kategorien.find((k) => k.id === teil)?.id ?? 'allgemein'
  const titel = t('common.settings')
  const sections: SettingsSectionEintrag<Kategorie>[] = kategorien.map((k) => ({
    id: k.id,
    label: t(`browser.einstellungen.kategorie.${k.id}`),
    icon: k.symbol,
    group: k.id === 'ueber' ? 'ueber' : k.unterpunkt ? 'konto' : 'browser',
    indent: k.unterpunkt,
  }))

  return (
    // Eigener Bereich: die Breakpoints richten sich nach der Seitenfläche, nicht nach dem Fenster.
    <div className="msb-bereich h-full overflow-y-auto bg-surface">
      <div className="msm-page">
        <SettingsLayout
          sections={sections}
          active={kategorie}
          onChange={oeffnen}
          title={titel}
          showGroupHeaders={false}
        >
          {kategorie === 'sicherheit' ? (
            <SicherheitSeite offline={stand === 'offline'} />
          ) : kategorie === 'profil' || kategorie === 'konto' || kategorie === 'soziales' || kategorie === 'ki' ? (
            <GekoppelteSeite teil={kategorie} />
          ) : (
            (() => {
              const Inhalt = INHALT[kategorie]
              return Inhalt ? <Inhalt /> : null
            })()
          )}
        </SettingsLayout>
      </div>
    </div>
  )
}
