/**
 * Die Maunting-Search-Fläche (`pontis://suche?q=…`).
 *
 * Die Treffer kommen vom eigenen Server (`POST /api/browser/suche`), der über
 * seine Metasuch-Instanz sucht. Keine Drittanbieter-Abhängigkeiten: Favicons
 * werden über die Rust-Brücke (`SeitenSymbol`) geholt, Vorschaubilder und
 * Wikipedia-Wissensdaten über den eigenen Server-Proxy.
 *
 * Aufbau der Web-Ansicht: Korrekturhinweis, Singra-Überblick, Direktantwort,
 * hervorgehobenes Top-Ergebnis, Fragen zum Thema, die übrige Trefferliste,
 * Bilderstreifen, verwandte Suchanfragen, Seitenwahl. Rechts laufen die
 * Wissenskarte und Nachrichten zum Thema mit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Globe, Image as ImageIcon, Newspaper, Play, Video } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { api, isNetworkOrOfflineError } from '@/api/client'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { useTageszeitMotiv } from '@/lib/tageszeit'
import { Button, Dropdown, TabBar, Zustandsflaeche, type DropdownOption, type TabDef } from '@maunting/ui'
import { useZurueckSchliesst } from '@maunting/ui'

import { DATENSCHUTZ_TEIL } from '../einstellungen/kategorien'
import { SuchEingabeLeiste } from '../kopf/SuchEingabeLeiste'
import { useEinstellungenStore } from '../services/einstellungenStore'
import { msmSucheAdresse, msmSucheBegriff } from '../services/intern'
import { nativ, type SchutzStand } from '../services/nativ'
import { suchAdresse } from '../services/searchEngines'
import { useTabsStore, type Tab } from '../services/tabsStore'
import { SuchBild, vorladenSuchBild } from './SuchBild'
import { SuchzusammenfassungKachel } from './suchzusammenfassung/SuchzusammenfassungKachel'
import { BilderStreifen } from './suche/BilderStreifen'
import { DirektAntwort } from './suche/DirektAntwort'
import { Ergebniszeile } from './suche/Ergebniszeile'
import { FormatierterText } from './suche/FormatierterText'
import { kontextFragen, verwandteSuchen } from './suche/fragen'
import { KorrekturHinweis } from './suche/KorrekturHinweis'
import { MedienVorschauDialog } from './suche/MedienVorschau'
import { NachrichtenSpalte } from './suche/NachrichtenSpalte'
import { SeitenPager } from './suche/SeitenPager'
import { SuchFooter } from './suche/SuchFooter'
import { VerwandteSuchen } from './suche/VerwandteSuchen'
import { WeitereFragen } from './suche/WeitereFragen'
import { Wissenskarte } from './suche/Wissenskarte'
import { host } from './suche/helfer'

export interface Treffer {
  titel: string
  url: string
  inhalt: string
  bild?: string
  published?: string
  bildOriginal?: string
  bildBreite?: number
  bildHoehe?: number
  quelle?: string
}

export interface WissensAttribut {
  label: string
  value: string
}

export interface WissensUrl {
  title: string
  url: string
}

export interface WissensPanelDaten {
  titel: string
  untertitel?: string
  inhalt: string
  bild?: string
  attribute?: WissensAttribut[]
  urls?: WissensUrl[]
  verwandte?: string[]
}

export type SuchKategorie = 'web' | 'images' | 'videos' | 'news'

type Stand =
  | { art: 'laedt' }
  | {
      art: 'da'
      treffer: Treffer[]
      vorschlaege: string[]
      korrekturen: string[]
      infobox?: WissensPanelDaten | null
      antworten?: string[]
      seite: number
      mehr: boolean
      weitereLaedt: boolean
      dauerSek: number
      sicher: boolean
    }
  | { art: 'fehler'; zuViele: boolean; abgemeldet?: boolean }
  | { art: 'offline' }
  | { art: 'nichtEingerichtet' }

/** Zuletzt gesehene Treffer, damit Zurück nicht noch einmal sucht. Nur im Speicher. */
const GEMERKT_MAX = 15
const gemerkt = new Map<string, Extract<Stand, { art: 'da' }>>()
const wissenGemerkt = new Map<string, WissensPanelDaten | null>()

function merken(schluessel: string, stand: Extract<Stand, { art: 'da' }>) {
  gemerkt.delete(schluessel)
  gemerkt.set(schluessel, { ...stand, weitereLaedt: false })
  if (gemerkt.size > GEMERKT_MAX) gemerkt.delete(gemerkt.keys().next().value as string)
}

function wissenMerken(schluessel: string, daten: WissensPanelDaten | null) {
  wissenGemerkt.delete(schluessel)
  wissenGemerkt.set(schluessel, daten)
  if (wissenGemerkt.size > GEMERKT_MAX) wissenGemerkt.delete(wissenGemerkt.keys().next().value as string)
}

/** Für Tests. */
export function gemerktLeeren() {
  gemerkt.clear()
  wissenGemerkt.clear()
}

/** Sichere Suche, sobald Erwachsenen-Inhalte gesperrt sind; im Zweifel ja. */
export function sichereSuche(stand: SchutzStand | null): boolean {
  if (!stand || stand.beschaedigt) return true
  return stand.regeln.aktiv && stand.regeln.kategorien.includes('erwachsene')
}

async function holen(
  begriff: string,
  seite: number,
  sprache: string,
  kategorie: SuchKategorie,
  sicher: boolean,
  signal?: AbortSignal,
): Promise<{
  treffer: Treffer[]
  vorschlaege: string[]
  korrekturen: string[]
  infobox?: WissensPanelDaten | null
  antworten: string[]
  dauerSek: number
}> {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const katParam = kategorie === 'web' ? undefined : kategorie
  const antwort = await api<{
    treffer: Treffer[]
    vorschlaege?: string[]
    korrekturen?: string[]
    infobox?: WissensPanelDaten | null
    antworten?: string[]
  }>('/browser/suche', {
    method: 'POST',
    signal,
    body: JSON.stringify({
      q: begriff,
      seite,
      sicher,
      sprache,
      ...(katParam ? { kategorie: katParam } : {}),
    }),
  })
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now()
  const dauerSek = Math.max(0.05, Math.round(((t1 - t0) / 1000) * 100) / 100)
  return {
    treffer: antwort.treffer,
    vorschlaege: antwort.vorschlaege ?? [],
    korrekturen: antwort.korrekturen ?? [],
    infobox: antwort.infobox ?? null,
    antworten: antwort.antworten ?? [],
    dauerSek,
  }
}

export function MsmSuche({ tab }: { tab: Tab }) {
  const { t, i18n } = useTranslation()
  const oeffnen = useTabsStore((s) => s.oeffnen)
  const neuerTab = useTabsStore((s) => s.neuerTab)
  const startseite = useTabsStore((s) => s.startseite)
  const einstellungenOeffnen = useTabsStore((s) => s.einstellungen)
  const begriff = msmSucheBegriff(tab.url) ?? ''
  // Ohne eigene Wahl gilt die Sprache des Browsers; der gespeicherte Wert setzt
  // sich nicht wieder zurück, wenn der Nutzer unterwegs umgestellt hat.
  const gespeicherteRegion = useEinstellungenStore((s) => s.suchRegion)
  const regionSetzen = useEinstellungenStore((s) => s.setzen)
  const standardSprache = gespeicherteRegion ?? (i18n.language.slice(0, 2) === 'en' ? 'en' : 'de')

  const [region, setRegion] = useState<string>(standardSprache)
  const [kategorie, setKategorie] = useState<SuchKategorie>('web')
  const [wissenFallback, setWissenFallback] = useState<WissensPanelDaten | null>(null)
  const [wissenMobilOffen, setWissenMobilOffen] = useState(false)
  const [medienVorschau, setMedienVorschau] = useState<{ treffer: Treffer; art: 'bild' | 'video' } | null>(null)
  // Nachrichten zum Thema: `null` heißt, die Abfrage läuft noch.
  const [themaNews, setThemaNews] = useState<Treffer[] | null>(null)
  const tagesMotiv = useTageszeitMotiv('suche')

  const speicherSchluessel = `${tab.url}::${region}::${kategorie}`
  const [stand, setStand] = useState<Stand>(() => {
    if ((tab.ladeZaehler ?? 0) > 0) {
      gemerkt.delete(speicherSchluessel)
      return { art: 'laedt' }
    }
    return gemerkt.get(speicherSchluessel) ?? { art: 'laedt' }
  })
  const [versuch, setVersuch] = useState(0)

  const aktiverLaufRef = useRef(0)
  const seitenAbortRef = useRef<AbortController | null>(null)

  // Der Schutzstand ändert sich selten; eine Suche soll nicht jedes Mal auf die
  // IPC warten. Der erste Aufruf behält sein Rennen, danach gilt der Wert 30 s.
  const schutzMerker = useRef<{ stand: SchutzStand | null; bis: number } | null>(null)
  const sicherFuerSuche = useCallback(async (): Promise<boolean> => {
    const jetzt = Date.now()
    const gemerkt = schutzMerker.current
    if (gemerkt && gemerkt.bis > jetzt) return sichereSuche(gemerkt.stand)
    const versprechen = nativ.schutzStand().catch(() => null)
    const frist = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500))
    const stand = await Promise.race([versprechen, frist])
    schutzMerker.current = { stand, bis: jetzt + 30_000 }
    return sichereSuche(stand)
  }, [])

  useEffect(() => {
    aktiverLaufRef.current += 1
    const meinLauf = aktiverLaufRef.current
    seitenAbortRef.current?.abort()
    seitenAbortRef.current = null

    if ((tab.ladeZaehler ?? 0) > 0) {
      gemerkt.delete(speicherSchluessel)
    }
    const schon = gemerkt.get(speicherSchluessel)
    if (schon && versuch === 0) {
      setStand(schon)
      return
    }
    if (!begriff) return
    let aktiv = true
    const controller = new AbortController()
    let isTimedOut = false

    const timeoutId = setTimeout(() => {
      isTimedOut = true
      const timeoutErr = new DOMException('Search request timed out', 'TimeoutError')
      try {
        controller.abort(timeoutErr)
      } catch {
        controller.abort()
      }
    }, 12000)

    setStand({ art: 'laedt' })
    void sicherFuerSuche().then((sicher) => holen(begriff, 1, region, kategorie, sicher, controller.signal).then(
      ({ treffer, vorschlaege, korrekturen, infobox, antworten, dauerSek }) => {
        clearTimeout(timeoutId)
        if (!aktiv || aktiverLaufRef.current !== meinLauf) return
        const neu: Extract<Stand, { art: 'da' }> = {
          art: 'da',
          treffer,
          vorschlaege,
          korrekturen,
          infobox,
          antworten,
          seite: 1,
          mehr: treffer.length > 0,
          weitereLaedt: false,
          dauerSek,
          sicher,
        }
        if (infobox?.bild) vorladenSuchBild(infobox.bild)
        merken(speicherSchluessel, neu)
        setStand(neu)
      },
      (fehler: unknown) => {
        clearTimeout(timeoutId)

        const fehlerObj = fehler as { name?: string; code?: string; status?: number } | null
        const isTimeout =
          isTimedOut ||
          fehlerObj?.name === 'TimeoutError' ||
          fehlerObj?.code === 'BROWSER_SUCHE_TIMEOUT' ||
          controller.signal.reason?.name === 'TimeoutError'

        const isUserAbort =
          !isTimeout &&
          ((fehler instanceof DOMException && fehler.name === 'AbortError') ||
            fehlerObj?.name === 'AbortError' ||
            controller.signal.aborted)

        // Ein Abbruch durch Navigation oder Kategoriewechsel endet sauber,
        // ohne einen Fehler aufblitzen zu lassen.
        if (isUserAbort) {
          return
        }

        if ((!aktiv || aktiverLaufRef.current !== meinLauf) && !isTimeout) {
          return
        }

        const code = fehlerObj?.code
        const status = fehlerObj?.status

        if (code === 'BROWSER_SUCHE_NICHT_EINGERICHTET') {
          setStand({ art: 'nichtEingerichtet' })
        } else if (status === 401 || code === 'UNAUTHORIZED' || code === 'SESSION_EXPIRED') {
          setStand({ art: 'fehler', zuViele: false, abgemeldet: true })
        } else if (code === 'BROWSER_SUCHE_ZU_VIELE' || status === 429) {
          setStand({ art: 'fehler', zuViele: true })
        } else if (isTimeout || (!code?.startsWith('BROWSER_SUCHE_') && isNetworkOrOfflineError(fehler))) {
          setStand({ art: 'offline' })
        } else {
          setStand({ art: 'fehler', zuViele: false })
        }
      },
    ))
    return () => {
      aktiv = false
      clearTimeout(timeoutId)
      controller.abort()
      seitenAbortRef.current?.abort()
      seitenAbortRef.current = null
    }
  }, [speicherSchluessel, begriff, region, kategorie, versuch, sicherFuerSuche])

  // Nachrichten zum Thema: dieselbe Metasuch-Instanz, Kategorie news, mit dem
  // echten Suchbegriff. Läuft nur neben der Web-Ansicht und nur, wenn es
  // Treffer gibt; ohne Ergebnis bleibt der Block unsichtbar.
  const hatWebTreffer = kategorie === 'web' && stand.art === 'da' && stand.treffer.length > 0
  useEffect(() => {
    setThemaNews(null)
    if (!hatWebTreffer || !begriff) return
    let aktiv = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    void sicherFuerSuche().then((sicher) =>
      holen(begriff, 1, region, 'news', sicher, controller.signal).then(
        ({ treffer }) => {
          if (aktiv) setThemaNews(treffer.slice(0, 5))
        },
        () => {
          if (aktiv) setThemaNews([])
        },
      ),
    )
    return () => {
      aktiv = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [hatWebTreffer, begriff, region, sicherFuerSuche])

  // Dynamisches Wikipedia-Knowledge-Panel: startet sofort parallel zur Websuche,
  // damit Fakten und Wikipedia-Bild ohne Wasserfall-Verzögerung bereitstehen.
  const wissenMoeglich = kategorie === 'web' && begriff.length > 1
  const wissenSchluessel = `${region.slice(0, 2)}\0${begriff.toLowerCase()}`

  useEffect(() => {
    setWissenFallback(null)
    if (!wissenMoeglich) return
    if (wissenGemerkt.has(wissenSchluessel)) {
      const gespeichert = wissenGemerkt.get(wissenSchluessel) ?? null
      setWissenFallback(gespeichert)
      if (gespeichert?.bild) vorladenSuchBild(gespeichert.bild)
      return
    }
    let aktiv = true
    const controller = new AbortController()
    api<{ wissen?: WissensPanelDaten | null }>('/browser/suche/wissen', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({ q: begriff, sprache: region.slice(0, 2) }),
    })
      .then((res) => {
        const wissen = res?.wissen ?? null
        wissenMerken(wissenSchluessel, wissen)
        if (wissen?.bild) vorladenSuchBild(wissen.bild)
        if (aktiv && wissen) {
          setWissenFallback(wissen)
        }
      })
      .catch(() => {
        // Stilles Ausblenden, falls kein Wikipedia-Eintrag existiert
      })
    return () => {
      aktiv = false
      controller.abort()
    }
  }, [wissenMoeglich, wissenSchluessel, begriff, region])

  // Ohne Netz lädt die Seite von selbst, sobald es wieder da ist.
  useEffect(() => {
    if (stand.art !== 'offline') return
    const wieder = () => setVersuch((v) => v + 1)
    window.addEventListener('online', wieder)
    return () => window.removeEventListener('online', wieder)
  }, [stand.art])

  const weitere = async () => {
    if (stand.art !== 'da' || stand.weitereLaedt) return
    const bisher = stand
    const meinLauf = aktiverLaufRef.current
    const startSchluessel = speicherSchluessel
    seitenAbortRef.current?.abort()
    const controller = new AbortController()
    seitenAbortRef.current = controller
    let istTimeout = false

    setStand({ ...bisher, weitereLaedt: true })
    const timer = setTimeout(() => {
      istTimeout = true
      try {
        controller.abort(new DOMException('Timeout', 'TimeoutError'))
      } catch {
        controller.abort()
      }
    }, 12000)

    const sicher = await sicherFuerSuche()
    if (controller.signal.aborted || aktiverLaufRef.current !== meinLauf) {
      clearTimeout(timer)
      return
    }

    holen(begriff, bisher.seite + 1, region, kategorie, sicher, controller.signal).then(
      ({ treffer: neu, vorschlaege: neueVorschlaege }) => {
        clearTimeout(timer)
        if (seitenAbortRef.current === controller) seitenAbortRef.current = null
        if (controller.signal.aborted || aktiverLaufRef.current !== meinLauf) return
        const bekannt = new Set(bisher.treffer.map((x) => x.url))
        const dazu = neu.filter((x) => !bekannt.has(x.url))
        const kombiniertVorschlaege = Array.from(new Set([...bisher.vorschlaege, ...neueVorschlaege]))
        const naechster: Extract<Stand, { art: 'da' }> = {
          ...bisher,
          treffer: [...bisher.treffer, ...dazu],
          vorschlaege: kombiniertVorschlaege,
          seite: bisher.seite + 1,
          mehr: dazu.length > 0,
          weitereLaedt: false,
        }
        merken(startSchluessel, naechster)
        setStand(naechster)
      },
      () => {
        clearTimeout(timer)
        if (seitenAbortRef.current === controller) seitenAbortRef.current = null
        if (aktiverLaufRef.current !== meinLauf || (!istTimeout && controller.signal.aborted)) return
        setStand({ ...bisher, weitereLaedt: false, mehr: true })
      },
    )
  }

  const seiteWechseln = async (zielSeite: number) => {
    if (stand.art !== 'da' || stand.weitereLaedt || zielSeite < 1 || zielSeite === stand.seite) return
    if (zielSeite === stand.seite + 1) {
      void weitere()
      return
    }
    const bisher = stand
    const meinLauf = aktiverLaufRef.current
    const startSchluessel = speicherSchluessel
    seitenAbortRef.current?.abort()
    const controller = new AbortController()
    seitenAbortRef.current = controller
    let istTimeout = false

    setStand({ ...bisher, weitereLaedt: true })
    const timer = setTimeout(() => {
      istTimeout = true
      try {
        controller.abort(new DOMException('Timeout', 'TimeoutError'))
      } catch {
        controller.abort()
      }
    }, 12000)

    const sicher = await sicherFuerSuche()
    if (controller.signal.aborted || aktiverLaufRef.current !== meinLauf) {
      clearTimeout(timer)
      return
    }

    holen(begriff, zielSeite, region, kategorie, sicher, controller.signal).then(
      ({ treffer: neu, vorschlaege: neueVorschlaege, infobox, dauerSek }) => {
        clearTimeout(timer)
        if (seitenAbortRef.current === controller) seitenAbortRef.current = null
        if (controller.signal.aborted || aktiverLaufRef.current !== meinLauf) return
        const naechster: Extract<Stand, { art: 'da' }> = {
          ...bisher,
          treffer: neu,
          vorschlaege: neueVorschlaege.length > 0 ? neueVorschlaege : bisher.vorschlaege,
          infobox: infobox ?? bisher.infobox,
          seite: zielSeite,
          mehr: neu.length > 0,
          weitereLaedt: false,
          dauerSek,
        }
        merken(startSchluessel, naechster)
        setStand(naechster)
      },
      () => {
        clearTimeout(timer)
        if (seitenAbortRef.current === controller) seitenAbortRef.current = null
        if (aktiverLaufRef.current !== meinLauf || (!istTimeout && controller.signal.aborted)) return
        setStand({ ...bisher, weitereLaedt: false })
      },
    )
  }

  const onNeueTreffer = (neue: Treffer[]) => {
    setStand((prev) => {
      if (prev.art !== 'da') return prev
      const bekannte = new Set(prev.treffer.map((x) => x.url))
      const dazu = neue.filter((x) => !bekannte.has(x.url))
      if (dazu.length === 0) return prev
      const aktualisiert = { ...prev, treffer: [...prev.treffer, ...dazu] }
      merken(speicherSchluessel, aktualisiert)
      return aktualisiert
    })
  }

  const mitDuckDuckGo = () => {
    const ziel = suchAdresse(begriff, 'duckduckgo')
    if (ziel) oeffnen(ziel, tab.id)
  }

  const zielOeffnen = (url: string, imNeuenTab = false) => {
    if (imNeuenTab) {
      neuerTab(url, { nach: tab.id, privat: tab.privat, hintergrund: true })
    } else {
      oeffnen(url, tab.id)
    }
  }

  // Die gewählte Region bleibt über Suchen hinweg erhalten.
  const regionWaehlen = (wert: string) => {
    setRegion(wert)
    regionSetzen({ suchRegion: wert })
  }

  // Kategorie-Reiter ohne Zähler-Badges (entspricht der schlichten Unterstrich-Leiste).
  const kategorieTabs: TabDef<SuchKategorie>[] = useMemo(
    () => [
      { id: 'web', labelKey: 'browser.msmSuche.tabWeb', icon: Globe },
      { id: 'images', labelKey: 'browser.msmSuche.tabBilder', icon: ImageIcon },
      { id: 'videos', labelKey: 'browser.msmSuche.tabVideos', icon: Video },
      { id: 'news', labelKey: 'browser.msmSuche.tabNews', icon: Newspaper },
    ],
    [],
  )

  const regionOptionen: DropdownOption[] = useMemo(
    () => [
      { value: 'de', label: t('browser.msmSuche.regionDe') },
      { value: 'en', label: t('browser.msmSuche.regionEn') },
      { value: 'at', label: t('browser.msmSuche.regionAt') },
      { value: 'ch', label: t('browser.msmSuche.regionCh') },
      { value: 'fr', label: t('browser.msmSuche.regionFr') },
      { value: 'es', label: t('browser.msmSuche.regionEs') },
      { value: 'it', label: t('browser.msmSuche.regionIt') },
      { value: 'nl', label: t('browser.msmSuche.regionNl') },
    ],
    [t],
  )
  const aktuellesRegionLabel = regionOptionen.find((opt) => opt.value === region)?.label ?? region

  // Ein Wissens-Panel ohne Titel ist ein leerer Platzhalter: es erscheint nicht,
  // statt eine leere Kachel zu zeigen. Ohne Web-Treffer gibt es keines.
  const wissensPanel = useMemo(() => {
    if (kategorie !== 'web' || stand.art !== 'da' || stand.treffer.length === 0) return null
    const roh = stand.infobox ?? wissenFallback
    return roh && roh.titel.trim() ? roh : null
  }, [kategorie, stand, wissenFallback])
  const fragenListe = useMemo(
    () => (stand.art === 'da' ? kontextFragen(begriff, stand.vorschlaege, stand.treffer) : []),
    [begriff, stand],
  )
  const verwandteListe = useMemo(
    () => (stand.art === 'da' ? verwandteSuchen(begriff, stand.vorschlaege) : []),
    [begriff, stand],
  )

  const renderWissensPanel = (kompaktMobil = false) => {
    if (!wissensPanel) return null
    return (
      <Wissenskarte
        daten={wissensPanel}
        kompaktMobil={kompaktMobil}
        mobilOffen={wissenMobilOffen}
        onMobilToggle={() => setWissenMobilOffen((v) => !v)}
        onOeffnen={zielOeffnen}
        onThema={(thema) => oeffnen(msmSucheAdresse(thema), tab.id)}
      />
    )
  }

  let inhalt: React.ReactNode
  if (!begriff) {
    inhalt = <Zustandsflaeche art="leer" titel={t('browser.msmSuche.ohneBegriff')} />
  } else if (stand.art === 'laedt') {
    inhalt = (
      <div role="status" aria-label={t('browser.msmSuche.laedt')} className="max-w-[780px] space-y-5">
        <span className="sr-only">{t('browser.msmSuche.laedt')}</span>
        <div
          aria-hidden="true"
          className="animate-pulse motion-reduce:animate-none space-y-3 rounded-2xl border border-outline-variant/30 bg-surface-container/60 p-5"
        >
          <div className="h-3.5 w-36 rounded-full bg-surface-container-high/80" />
          <div className="h-3 w-full rounded-full bg-surface-container-high/60" />
          <div className="h-3 w-5/6 rounded-full bg-surface-container-high/45" />
        </div>
        {Array.from({ length: 4 }, (_, i) => (
          <div
            key={i}
            aria-hidden="true"
            className="animate-pulse motion-reduce:animate-none space-y-2 border-b border-outline-variant/20 pb-4"
          >
            <div className="h-3 w-40 rounded-full bg-surface-container-high/75" />
            <div className="h-4 w-3/4 rounded-full bg-surface-container-high" />
            <div className="h-3 w-full rounded-full bg-surface-container/80" />
          </div>
        ))}
      </div>
    )
  } else if (stand.art === 'offline') {
    inhalt = <Zustandsflaeche art="offline" titel={t('browser.msmSuche.offlineTitel')} text={t('browser.msmSuche.offlineText')} />
  } else if (stand.art === 'fehler') {
    if (stand.abgemeldet) {
      inhalt = (
        <Zustandsflaeche
          art="fehler"
          titel={t('browser.msmSuche.anmeldungErforderlichTitel', { defaultValue: 'Anmeldung erforderlich' })}
          text={t('browser.msmSuche.anmeldungErforderlichText', {
            defaultValue: 'Deine Sitzung ist abgelaufen oder du bist nicht angemeldet. Bitte melde dich mit deinem Maunting-Konto an, um Maunting Search und die Singra-KI zu nutzen.',
          })}
          erneutLabel={t('browser.einstellungen.anmeldenKoppeln', { defaultValue: 'In Einstellungen anmelden' })}
          onErneut={() => oeffnen('pontis://einstellungen?teil=dienste', tab.id)}
        />
      )
    } else {
      inhalt = (
        <Zustandsflaeche
          art="fehler"
          titel={t('browser.msmSuche.fehlerTitel')}
          text={t(stand.zuViele ? 'browser.msmSuche.zuVieleText' : 'browser.msmSuche.fehlerText')}
          erneutLabel={t('common.retry')}
          onErneut={() => setVersuch((v) => v + 1)}
        />
      )
    }
  } else if (stand.art === 'nichtEingerichtet') {
    inhalt = (
      <Zustandsflaeche art="leer" titel={t('browser.msmSuche.nichtEingerichtetTitel')} text={t('browser.msmSuche.nichtEingerichtetText')}>
        <Button variant="secondary" onClick={mitDuckDuckGo}>
          {t('browser.msmSuche.mitDuckDuckGo')}
        </Button>
      </Zustandsflaeche>
    )
  } else if (stand.treffer.length === 0) {
    inhalt = <Zustandsflaeche art="leer" ansagen titel={t('browser.msmSuche.keineTreffer', { begriff })} />
  } else if (kategorie === 'images') {
    // Bilder als Masonry-Raster: keine Kartenrahmen, natürliche Höhen.
    inhalt = (
      <div className="columns-2 gap-3 sm:columns-3 lg:columns-4 animate-fade-in">
        {stand.treffer.map((x, idx) => {
          const domain = host(x.url)
          return (
            <button
              key={`${x.url}-${idx}`}
              type="button"
              onClick={() => setMedienVorschau({ treffer: x, art: 'bild' })}
              onAuxClick={(ev) => ev.button === 1 && zielOeffnen(x.url, true)}
              className="group relative mb-3 block w-full break-inside-avoid overflow-hidden rounded-xl border border-outline-variant/30 bg-surface-container/75 text-left shadow-sm transition-all duration-200 hover:border-primary/50 hover:shadow-float"
              style={
                x.bildBreite && x.bildHoehe
                  ? { aspectRatio: `${x.bildBreite} / ${x.bildHoehe}` }
                  : { aspectRatio: '4 / 3' }
              }
            >
              {x.bild ? (
                <SuchBild
                  url={x.bild}
                  alt={x.titel}
                  width={x.bildBreite}
                  height={x.bildHoehe}
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-primary">
                  <ImageIcon className="h-6 w-6" aria-hidden="true" />
                </div>
              )}
              <span className="absolute inset-x-0 bottom-0 block truncate bg-gradient-to-t from-black/80 via-black/35 to-transparent px-2.5 pb-2 pt-8 text-label-sm text-white transition-opacity duration-150 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
                <span className="block truncate font-medium">{x.titel || domain}</span>
                <span className="block truncate text-white/75">{domain}</span>
              </span>
            </button>
          )
        })}
      </div>
    )
  } else if (kategorie === 'videos') {
    inhalt = (
      <div className="grid max-w-4xl grid-cols-1 gap-4 md:grid-cols-2 animate-fade-in">
        {stand.treffer.map((x, idx) => {
          const domain = host(x.url)
          return (
            <button
              key={`${x.url}-${idx}`}
              type="button"
              onClick={() => setMedienVorschau({ treffer: x, art: 'video' })}
              onAuxClick={(ev) => ev.button === 1 && zielOeffnen(x.url, true)}
              className="group flex flex-col overflow-hidden rounded-2xl border border-outline-variant/35 bg-surface-container/75 text-left backdrop-blur-xl shadow-hairline transition-all duration-200 hover:border-primary/55 hover:bg-surface-container/95 hover:shadow-float"
            >
              <div className="relative flex h-44 w-full flex-col justify-between overflow-hidden border-b border-outline-variant/25 bg-gradient-to-br from-surface-container-high via-surface-container to-primary-container/25 p-4">
                {x.bild && (
                  <SuchBild
                    url={x.bild}
                    alt={x.titel}
                    className="absolute inset-0 h-full w-full object-cover opacity-70 transition-transform duration-300 group-hover:scale-105"
                  />
                )}
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/20" aria-hidden="true" />
                <div className="relative z-10 flex items-center justify-between">
                  <span className="rounded-full border border-white/15 bg-black/55 px-2.5 py-0.5 text-label-sm font-medium text-white backdrop-blur-md">
                    {domain}
                  </span>
                </div>
                <div className="relative z-10 my-auto flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white shadow-float backdrop-blur-md transition-all duration-200 group-hover:scale-110 group-hover:border-primary/60 group-hover:bg-primary group-hover:text-on-primary">
                    <Play className="ml-0.5 h-5 w-5 fill-current" aria-hidden="true" />
                  </div>
                </div>
              </div>
              <div className="p-4">
                <h3 className="line-clamp-2 text-body-md font-semibold text-on-surface transition-colors group-hover:text-primary">
                  <FormatierterText text={x.titel || domain} />
                </h3>
                {x.inhalt && (
                  <p className="mt-1.5 line-clamp-2 text-label-sm text-on-surface-variant">
                    <FormatierterText text={x.inhalt} />
                  </p>
                )}
              </div>
            </button>
          )
        })}
      </div>
    )
  } else if (kategorie === 'news') {
    inhalt = (
      <div className="max-w-[780px] divide-y divide-outline-variant/20 animate-fade-in">
        {stand.treffer.map((n, idx) => {
          const domain = host(n.url)
          return (
            <article key={`${n.url}-${idx}`} className="flex flex-col py-1.5 first:pt-0 last:pb-0">
              <button
                type="button"
                onClick={(ev) => zielOeffnen(n.url, ev.ctrlKey || ev.metaKey)}
                onAuxClick={(ev) => ev.button === 1 && zielOeffnen(n.url, true)}
                className="group -mx-3 block rounded-2xl px-3 py-3 text-left transition-colors duration-150 hover:bg-surface-container-low/45"
              >
                <span className="text-label-sm font-medium text-primary">{domain}</span>
                <h3 className="mt-1 text-title-sm font-semibold text-on-surface decoration-primary/60 underline-offset-4 group-hover:text-primary group-hover:underline">
                  <FormatierterText text={n.titel || domain} />
                </h3>
                {n.inhalt && (
                  <p className="mt-1 line-clamp-2 text-body-sm leading-relaxed text-on-surface-variant sm:line-clamp-3">
                    <FormatierterText text={n.inhalt} />
                  </p>
                )}
              </button>
            </article>
          )
        })}
      </div>
    )
  } else {
    // Web-Ansicht: breite Lesespalte, rechts Wissenskarte und Themen-Nachrichten.
    inhalt = (
      <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,1fr)_352px] animate-fade-in">
        <div className="min-w-0 max-w-[780px] space-y-6">
          {stand.korrekturen.length > 0 && (
            <KorrekturHinweis
              korrekturen={stand.korrekturen}
              onSuchen={(neu) => oeffnen(msmSucheAdresse(neu), tab.id)}
            />
          )}

          <SuchzusammenfassungKachel
            begriff={begriff}
            treffer={stand.treffer}
            vorschlaege={verwandteListe}
            onNeueTreffer={onNeueTreffer}
            onOeffnen={zielOeffnen}
          />

          <DirektAntwort antworten={stand.antworten ?? []} />

          {/* Der erste Treffer als hervorgehobene Karte direkt unter dem Überblick. */}
          <div id="treffer-1">
            <Ergebniszeile
              treffer={stand.treffer[0]}
              sprache={region}
              hervorgehoben
              sitelinks={stand.vorschlaege.slice(0, 4)}
              onOeffnen={zielOeffnen}
              onSitelink={(link) => oeffnen(msmSucheAdresse(link), tab.id)}
            />
          </div>

          {/* Auf Mobilgeräten / Tablets reiht sich die Wissenskarte kompakt ein. */}
          {wissensPanel && <div className="lg:hidden">{renderWissensPanel(true)}</div>}

          <WeitereFragen
            fragen={fragenListe}
            onFrage={(frage) => oeffnen(msmSucheAdresse(frage), tab.id)}
          />

          {/* Die übrigen Treffer: eine ruhige Liste, keine Karten. */}
          {stand.treffer.length > 1 && (
            <ol
              className="divide-y divide-outline-variant/25"
              aria-label={t('browser.msmSuche.trefferListe', { begriff })}
            >
              {stand.treffer.slice(1).map((x, idx) => (
                <li key={x.url} id={`treffer-${idx + 2}`}>
                  <Ergebniszeile
                    treffer={x}
                    sprache={region}
                    onOeffnen={zielOeffnen}
                    onSitelink={(link) => oeffnen(msmSucheAdresse(link), tab.id)}
                  />
                </li>
              ))}
            </ol>
          )}

          <BilderStreifen
            treffer={stand.treffer}
            onBild={(x) => setMedienVorschau({ treffer: x, art: 'bild' })}
            onAlle={() => setKategorie('images')}
          />

          <VerwandteSuchen
            suchen={verwandteListe}
            onSuchen={(v) => oeffnen(msmSucheAdresse(v), tab.id)}
          />

          <SeitenPager
            seite={stand.seite}
            mehr={stand.mehr}
            laedt={stand.weitereLaedt}
            onSeite={(nr) => void seiteWechseln(nr)}
            onWeitere={() => void weitere()}
          />
        </div>

        {/* Rechte Spalte: Wissenskarte und Nachrichten zum Thema, mitlaufend. */}
        <aside className="hidden space-y-5 lg:sticky lg:top-[7.5rem] lg:block">
          {wissensPanel && renderWissensPanel(false)}
          <NachrichtenSpalte news={themaNews} sprache={region} onOeffnen={zielOeffnen} />
        </aside>
      </div>
    )
  }

  return (
    <div className="relative isolate flex h-full flex-col overflow-hidden bg-background text-on-surface">
      <TageszeitHintergrund
        motiv={tagesMotiv}
        hoehe="h-full min-h-full"
        deckkraft="opacity-40"
        verlauf="msm-tageszeit-verlauf"
        ebene="z-0"
        auslaufMaske="linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.92) 20%, rgba(0,0,0,0.65) 45%, rgba(0,0,0,0.3) 70%, rgba(0,0,0,0.08) 88%, transparent 100%)"
      />
      <div
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-background/30 via-background/60 to-background/95"
        aria-hidden="true"
      />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden scroll-pt-[9rem]">
        <h1 className="sr-only">{t('browser.msmSuche.titel', { begriff })}</h1>

        {/* Sticky Suchkopf: Wortmarke, Regionswahl, Suchfeld, Kategorien. */}
        <header className="msm-suche-kopf-huelle">
          <div className="msm-suche-kopf px-4 pt-3.5 sm:px-6">
            <div className="mx-auto max-w-[1400px]">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => startseite(tab.id)}
                  className="group order-1 flex shrink-0 items-center gap-2.5 text-left md:w-[196px]"
                >
                  <img
                    src="/msp.png"
                    alt=""
                    className="h-8 w-8 shrink-0 rounded-full border border-primary/40 shadow-[0_0_16px_hsl(var(--mui-focus)/0.2)] transition-transform group-hover:scale-105"
                  />
                  <div className="flex items-baseline gap-1.5 leading-none">
                    <span className="text-title-md font-semibold tracking-tight text-on-surface">Maunting</span>
                    <span className="text-title-md font-medium tracking-tight text-primary">Search</span>
                  </div>
                </button>

                {/* Regionsauswahl: Mobil neben dem Logo, Desktop rechts außen */}
                <div className="order-2 ml-auto flex shrink-0 items-center md:order-5">
                  <div className="w-36 shrink-0 sm:w-44">
                    <Dropdown
                      value={region}
                      onChange={regionWaehlen}
                      options={regionOptionen}
                      align="end"
                      buttonClassName="h-9 rounded-full border-outline-variant/45 bg-surface-container-low/80 px-3.5 text-label-sm shadow-hairline backdrop-blur-md hover:border-outline-variant/80 hover:bg-surface-container/90"
                      aria-label={t('browser.msmSuche.regionLabel')}
                    />
                  </div>
                </div>

                {/* Wiederverwendete DNA-Suchleiste mit Live-Autocomplete */}
                <div className="order-3 w-full min-w-0 md:order-2 md:max-w-[680px] md:flex-1">
                  <SuchEingabeLeiste
                    initialWert={begriff}
                    onSuchen={(neu) => oeffnen(msmSucheAdresse(neu), tab.id)}
                    kompakt
                    autocomplete={!tab.privat}
                    sprache={region}
                    variante="glass"
                  />
                </div>
              </div>

              {/* Untere Header-Zeile: flache Unterstrich-Kategorien & Treffer-Statistik */}
              <div className="mt-2.5 flex items-center justify-between gap-3 md:pl-[208px]">
                <TabBar
                  tabs={kategorieTabs}
                  active={kategorie}
                  onChange={setKategorie}
                  ariaLabel={t('browser.msmSuche.kategorienLabel')}
                  variante="underline"
                  einzeilig
                  kompakt
                  className="-mb-px"
                />

                {stand.art === 'da' && stand.treffer.length > 0 && (
                  <span className="hidden pb-1.5 text-label-sm tabular-nums text-on-surface-variant sm:inline">
                    {t('browser.msmSuche.trefferStatistik', {
                      anzahl: stand.treffer.length,
                      dauer: stand.dauerSek.toFixed(2).replace('.', ','),
                    })}
                  </span>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Hauptinhalt (kein zweites <main>: die Fläche des Browsers ist bereits eins) */}
        <div className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 md:pl-[208px]">
          {inhalt}
        </div>

        <MedienVorschauDialog
          vorschau={medienVorschau}
          onSchliessen={() => setMedienVorschau(null)}
          onOeffnen={zielOeffnen}
        />

        <SuchFooter
          regionLabel={aktuellesRegionLabel}
          sicher={stand.art === 'da' ? stand.sicher : true}
          onDatenschutz={() => einstellungenOeffnen(DATENSCHUTZ_TEIL)}
        />
      </div>
    </div>
  )
}

/**
 * Der gemerkte Rückweg (`vorher`) kennt keine Webview: von einem Treffer zur
 * Suche, von der Suche zur Seite davor. Unter Android landet die Zurück-Taste
 * dann in der Oberfläche; ein Verlaufseintrag dort geht diesen Weg, statt die
 * App zu beenden.
 */
export function useZurueckZurSuche(tab: Tab | undefined) {
  const aktion = useTabsStore((s) => s.aktion)
  const id = tab?.id
  useZurueckSchliesst(!!tab && !tab.zurueck && !!tab.vorher, () => {
    if (id) aktion('zurueck', id)
  })
}