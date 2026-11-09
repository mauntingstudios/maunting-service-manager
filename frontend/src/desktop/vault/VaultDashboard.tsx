import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  Briefcase,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Gamepad2,
  Image as ImageIcon,
  Images,
  KeyRound,
  Layers,
  LayoutGrid,
  List,
  Lock,
  Monitor,
  MoreHorizontal,
  MoreVertical,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Upload,
  User,
  Wallet,
  WifiOff,
  X,
} from 'lucide-react'
import {
  ActionMenu,
  BrandIcon,
  Button,
  Dropdown,
  FileButton,
  ProgressBar,
  Zustandsflaeche,
} from '@maunting/ui'
import { formatBytes } from '@/lib/format'
import { headerHintergrundWaehlen } from '@/lib/tageszeit'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import type { VaultItem } from './vaultEintrag'
import {
  STANDARD_KATEGORIEN,
  TRESOR_FILTER,
  dieseWoche,
  passwortPunkte,
  passtZumFilter,
  sammlungen,
  sichtbareEintraege,
  sicherheitsStufe,
  sortiereEintraege,
  tresorSicherheit,
  zaehleEintraege,
  type Sammlung,
  type StandardKategorieDef,
  type TresorFilter,
  type TresorSortierung,
} from './vaultKennzahlen'

export interface SicherheitscheckStand {
  laeuft: boolean
  geprueft: number
  gesamt: number
  gefunden: number
  abgeschlossen: boolean
}

export interface VaultDashboardProps {
  items: VaultItem[]
  begruessung: string
  isTeam: boolean
  syncStatus: 'synced' | 'syncing' | 'offline' | 'error' | 'idle'
  geraete: number | null
  sicherheitscheck: SicherheitscheckStand
  onNeuerEintrag: () => void
  onPasswortGenerieren: () => void
  onDateiHochladen: (datei: File) => void
  onSichereNotiz?: () => void
  onSicherheitscheck: () => void
  onSammlung: (id: string) => void
  onSammlungUmbenennen: (sammlung: Sammlung) => void
  onSammlungBildAendern?: (sammlung: Sammlung) => void
  onStandardKategorieBildAendern?: (schluessel: StandardKategorieDef['schluessel'], name: string, aktuellesBild: string) => void
  standardKategorieBilder?: Partial<Record<StandardKategorieDef['schluessel'], string>>
  onNeueSammlung: () => void
  onAlleEintraege: () => void
  onFilterAnsicht?: (filter: TresorFilter) => void
  onEintrag: (item: VaultItem) => void
  suchbegriff?: string
  onSucheAendern?: (wert: string) => void
  dateiBusy?: boolean
}

const FILTER_TEXT: Record<TresorFilter, string> = {
  alle: 'mss.vault.dashboard.filterAlle',
  passwoerter: 'mss.vault.dashboard.filterPasswoerter',
  karten: 'mss.vault.dashboard.filterKarten',
  dateien: 'mss.vault.dashboard.filterDateien',
  notizen: 'mss.vault.dashboard.filterNotizen',
}

function StandardKategorieIcon({ schluessel }: { schluessel?: StandardKategorieDef['schluessel'] }) {
  switch (schluessel) {
    case 'arbeit':
      return <Briefcase className="h-4 w-4 text-primary" aria-hidden="true" />
    case 'gaming':
      return <Gamepad2 className="h-4 w-4 text-primary" aria-hidden="true" />
    case 'finanzen':
      return <Wallet className="h-4 w-4 text-primary" aria-hidden="true" />
    case 'persoenliches':
      return <User className="h-4 w-4 text-primary" aria-hidden="true" />
    case 'accounts':
    default:
      return <Folder className="h-4 w-4 text-primary" aria-hidden="true" />
  }
}

function EintragVorschauSymbol({ item }: { item: VaultItem }) {
  if (item.category === 'ordner') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-outline-variant/20 bg-surface-container text-primary">
        <Folder className="h-4 w-4" aria-hidden="true" />
      </span>
    )
  }
  if (item.category === 'album') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-outline-variant/20 bg-surface-container text-primary">
        <Images className="h-4 w-4" aria-hidden="true" />
      </span>
    )
  }
  if (item.category === 'datei') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-outline-variant/20 bg-surface-container text-primary">
        <FileText className="h-4 w-4" aria-hidden="true" />
      </span>
    )
  }
  if (item.category === 'secure_note') {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-outline-variant/20 bg-surface-container text-primary">
        <Lock className="h-4 w-4" aria-hidden="true" />
      </span>
    )
  }
  return <BrandIcon name={item.service} domainOrUrl={item.url} size="md" />
}

function Kennzahl({
  label,
  wert,
  hinweis,
  icon,
  prozent,
  warm,
  betont,
}: {
  label: string
  wert: string
  hinweis: string
  icon: React.ReactNode
  prozent?: number | null
  warm?: boolean
  betont?: boolean
}) {
  return (
    <section
      className={`relative overflow-hidden rounded-2xl border p-4 backdrop-blur-md transition-colors ${
        betont
          ? 'border-status-success/30 bg-gradient-to-br from-status-success/12 via-surface-container-low/85 to-surface-container-low/85'
          : 'border-outline-variant/20 bg-surface-container-low/80'
      }`}
    >
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
              betont
                ? 'border-status-success/30 bg-status-success/15 text-status-success'
                : 'border-outline-variant/20 bg-surface-container text-primary'
            }`}
          >
            {icon}
          </span>
          <p className="truncate text-xs font-semibold text-on-surface-variant">{label}</p>
        </div>
      </div>

      {prozent !== undefined ? (
        <div className="relative mt-3 space-y-1.5">
          <div className="flex items-center gap-3">
            <p className="font-headline text-2xl font-bold leading-none text-on-surface">{wert}</p>
            <div className="flex-1">
              <ProgressBar value={prozent} heat={warm} />
            </div>
          </div>
          <p className="text-xs text-on-surface-variant">{hinweis}</p>
        </div>
      ) : (
        <>
          <p className="relative mt-2.5 font-headline text-2xl font-bold leading-none text-on-surface">
            {wert}
          </p>
          <p className="relative mt-1.5 truncate text-xs text-on-surface-variant">{hinweis}</p>
        </>
      )}
    </section>
  )
}

function Schnellaktion({
  icon,
  label,
  kurzLabel,
  onClick,
  betont,
}: {
  icon: React.ReactNode
  label: string
  kurzLabel?: string
  onClick: () => void
  betont?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-h-[74px] w-full flex-col items-center justify-center gap-2 rounded-2xl border px-3 py-3 text-center transition-all ${
        betont
          ? 'border-primary/35 bg-primary/12 hover:border-primary/50 hover:bg-primary/18'
          : 'border-outline-variant/20 bg-surface-container-low/75 hover:border-outline-variant/40 hover:bg-surface-container/80'
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-xl border transition-transform group-hover:scale-105 ${
          betont
            ? 'border-primary/35 bg-primary/20 text-primary'
            : 'border-outline-variant/20 bg-surface-container text-on-surface'
        }`}
      >
        {icon}
      </span>
      <span className="hidden text-xs font-medium text-on-surface sm:inline">{label}</span>
      <span className="text-label-sm font-medium text-on-surface sm:hidden">
        {kurzLabel ?? label}
      </span>
    </button>
  )
}

export function VaultDashboard({
  items,
  begruessung,
  isTeam,
  syncStatus,
  geraete,
  sicherheitscheck,
  onNeuerEintrag,
  onPasswortGenerieren,
  onDateiHochladen,
  onSichereNotiz,
  onSicherheitscheck,
  onSammlung,
  onSammlungUmbenennen,
  onSammlungBildAendern,
  onStandardKategorieBildAendern,
  standardKategorieBilder,
  onNeueSammlung,
  onAlleEintraege,
  onFilterAnsicht,
  onEintrag,
  suchbegriff = '',
  onSucheAendern,
  dateiBusy = false,
}: VaultDashboardProps) {
  const { t } = useTranslation()
  const [aktivFilter, setAktivFilter] = useState<TresorFilter>('alle')
  const [sortierung, setSortierung] = useState<TresorSortierung>('zuletzt')
  const [darstellung, setDarstellung] = useState<'raster' | 'liste'>('raster')
  const [aktiveStandardKategorie, setAktiveStandardKategorie] = useState<StandardKategorieDef['schluessel'] | null>(null)
  const headerZufall = useRef(Math.random() * 5)

  const headerMotiv = useMemo(
    () => headerHintergrundWaehlen(new Date().getHours(), headerZufall.current),
    [],
  )

  const anzahl = useMemo(() => zaehleEintraege(items), [items])
  const neue = useMemo(() => dieseWoche(items), [items])
  const sicherheit = useMemo(() => tresorSicherheit(items), [items])
  const stufe = sicherheitsStufe(sicherheit.prozent)
  const ordner = useMemo(() => sammlungen(items), [items])
  const geraetezahl = geraete

  // Standard-Kategorien mit echten Zählern aus dem Bestand berechnen
  const standardKarten = useMemo(() => {
    const sichtbar = sichtbareEintraege(items).filter(
      (item) => item.category !== 'ordner' && item.category !== 'album',
    )
    return STANDARD_KATEGORIEN.map((def) => {
      const passende = sichtbar.filter((item) => {
        if (def.schluessel === 'finanzen' && item.category === 'zahlung') return true
        if (def.schluessel === 'persoenliches' && item.category === 'secure_note') return true
        return def.suchbegriffe.test(`${item.service} ${item.url ?? ''}`)
      })
      const neuester = passende.reduce<VaultItem | null>(
        (bisher, akt) => (!bisher || akt.updatedAt > bisher.updatedAt ? akt : bisher),
        null,
      )
      return {
        id: `std-${def.schluessel}`,
        name: t(def.i18nKey),
        anzahl: passende.length,
        neuester,
        titelbild: standardKategorieBilder?.[def.schluessel] || def.standardBild,
        akzentFarbe: def.akzentFarbe,
        istStandard: true,
        standardSchluessel: def.schluessel,
      } satisfies Sammlung
    })
  }, [items, standardKategorieBilder, t])

  // Gefilterte & sortierte Einträge für den unteren Katalogbereich
  const katalogEintraege = useMemo(() => {
    const sichtbar = sichtbareEintraege(items).filter(
      (item) => item.category !== 'ordner' && item.category !== 'album',
    )
    const nachFilter = sichtbar.filter((item) => passtZumFilter(item, aktivFilter))
    const nachKategorie = aktiveStandardKategorie
      ? nachFilter.filter((item) => {
          const def = STANDARD_KATEGORIEN.find((k) => k.schluessel === aktiveStandardKategorie)
          if (!def) return true
          if (def.schluessel === 'finanzen' && item.category === 'zahlung') return true
          if (def.schluessel === 'persoenliches' && item.category === 'secure_note') return true
          return def.suchbegriffe.test(`${item.service} ${item.url ?? ''}`)
        })
      : nachFilter
    const q = suchbegriff.trim().toLowerCase()
    const nachSuche = q
      ? nachKategorie.filter(
          (item) =>
            item.service.toLowerCase().includes(q) ||
            item.username.toLowerCase().includes(q) ||
            (item.url ?? '').toLowerCase().includes(q),
        )
      : nachKategorie
    return sortiereEintraege(nachSuche, sortierung).slice(0, 10)
  }, [items, aktivFilter, aktiveStandardKategorie, suchbegriff, sortierung])

  const stufeText =
    stufe === 'sehrGut'
      ? t('mss.vault.dashboard.sicherheitSehrGutHinweis')
      : stufe === 'gut'
        ? t('mss.vault.dashboard.sicherheitGutHinweis')
        : stufe === 'mittel'
          ? t('mss.vault.dashboard.sicherheitMittelHinweis')
          : stufe === 'schwach'
            ? t('mss.vault.dashboard.sicherheitSchwachHinweis')
            : t('mss.vault.dashboard.lecksUngeprueft')

  const leckWert = sicherheitscheck.abgeschlossen ? String(sicherheitscheck.gefunden) : '0'
  const leckHinweis = sicherheitscheck.laeuft
    ? t('mss.vault.dashboard.sicherheitscheckLaeuft', {
        geprueft: sicherheitscheck.geprueft,
        gesamt: sicherheitscheck.gesamt,
      })
    : sicherheitscheck.abgeschlossen
      ? sicherheitscheck.gefunden > 0
        ? t('mss.vault.dashboard.lecksGefunden', { count: sicherheitscheck.gefunden })
        : t('mss.vault.dashboard.lecksKeine')
      : t('mss.vault.dashboard.lecksKeine')

  const syncText =
    syncStatus === 'offline'
      ? t('mss.vault.dashboard.offline')
      : syncStatus === 'error'
        ? t('mss.vault.abgleichAbgelehnt')
        : t('mss.vault.dashboard.synchronisiert')

  const kategorieLabel = (item: VaultItem) => {
    if (item.zahlung) {
      const quelle = item.zahlung.art === 'konto' ? item.zahlung.iban : item.zahlung.nummer
      const endziffern = quelle?.replace(/\D/g, '').slice(-4)
      return endziffern ? `•••• ${endziffern}` : t('mss.vault.dashboard.filterKarten')
    }
    if (item.category === 'secure_note') return t('mss.vault.dashboard.filterNotizen')
    if (item.category === 'datei' || item.category === 'album' || item.category === 'ordner') {
      return t('mss.vault.dashboard.filterDateien')
    }
    return t('mss.vault.dashboard.filterPasswoerter')
  }

  const sortierOptionen = useMemo(
    () => [
      { value: 'zuletzt', label: `${t('mss.vault.dashboard.sortieren')}: ${t('mss.vault.dashboard.sortZuletzt')}` },
      { value: 'alphabetisch', label: `${t('mss.vault.dashboard.sortieren')}: ${t('mss.vault.dashboard.sortAlphabetisch')}` },
      { value: 'neueste', label: `${t('mss.vault.dashboard.sortieren')}: ${t('mss.vault.dashboard.sortNeueste')}` },
    ],
    [t],
  )

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Atmosphärischer Header-Bereich mit tageszeitabhängigem Motiv & weichem Übergang */}
      <div className="relative overflow-hidden">
        <TageszeitHintergrund motiv={headerMotiv} hoehe="h-[520px] sm:h-[580px] lg:h-[640px]" />

        <div className="relative mx-auto w-full max-w-6xl space-y-6 px-4 py-5 sm:px-6">
          {/* Obere Such- & Statusleiste */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {onSucheAendern ? (
              <div className="relative w-full max-w-md flex-1">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  value={suchbegriff}
                  onChange={(e) => onSucheAendern(e.target.value)}
                  placeholder={t('common.search')}
                  aria-label={t('common.search')}
                  className="w-full rounded-xl border border-outline-variant/25 bg-surface-container-low/80 py-2 pl-10 pr-8 text-xs text-on-surface placeholder:text-on-surface-variant/70 backdrop-blur-md focus:border-primary/50 focus:outline-none"
                />
                {suchbegriff && (
                  <button
                    type="button"
                    onClick={() => onSucheAendern('')}
                    aria-label={t('common.reset')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            ) : (
              <div />
            )}

            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs backdrop-blur-md ${
                syncStatus === 'offline' || syncStatus === 'error'
                  ? 'border-status-warning/30 bg-status-warning/15 text-status-warning'
                  : 'border-outline-variant/20 bg-surface-container-low/80 text-on-surface-variant'
              }`}
              role="status"
            >
              {syncStatus === 'syncing' ? (
                <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
              ) : syncStatus === 'offline' || syncStatus === 'error' ? (
                <WifiOff className="h-3 w-3" aria-hidden="true" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 text-status-success" aria-hidden="true" />
              )}
              <span>{syncText}</span>
            </span>
          </div>

          {/* Begrüßung */}
          <header className="space-y-1">
            <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
              {begruessung}
            </h2>
            <p className="hidden text-sm text-on-surface-variant sm:block">
              {t('mss.vault.dashboard.untertitel')}
            </p>
            <p className="text-xs text-on-surface-variant sm:hidden">
              {t('mss.vault.dashboard.untertitelKurz')}
            </p>
          </header>

          {/* 4 Status- & Metrik-Karten */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kennzahl
              label={t('mss.vault.dashboard.tresorSicherheit')}
              wert={sicherheit.prozent == null ? '—' : `${sicherheit.prozent} %`}
              hinweis={stufeText}
              icon={<ShieldCheck className="h-4 w-4" />}
              prozent={sicherheit.prozent ?? 100}
              warm={sicherheit.prozent != null && sicherheit.prozent < 40}
              betont
            />
            <div className="hidden sm:block">
              <Kennzahl
                label={t('mss.vault.dashboard.eintraege')}
                wert={String(anzahl)}
                hinweis={t('mss.vault.dashboard.dieseWoche', { count: neue })}
                icon={<Layers className="h-4 w-4" />}
              />
            </div>
            <div className="hidden sm:block">
              <Kennzahl
                label={t('mss.vault.dashboard.geraete')}
                wert={geraetezahl == null ? '1' : String(geraetezahl)}
                hinweis={
                  isTeam
                    ? t('mss.vault.dashboard.geraeteHinweisTeam')
                    : t('mss.vault.dashboard.geraeteSynchronisiert')
                }
                icon={<Monitor className="h-4 w-4" />}
              />
            </div>
            <div className="hidden sm:block">
              <Kennzahl
                label={t('mss.vault.dashboard.datenlecks')}
                wert={leckWert}
                hinweis={leckHinweis}
                icon={
                  sicherheitscheck.abgeschlossen && sicherheitscheck.gefunden > 0 ? (
                    <ShieldAlert className="h-4 w-4" />
                  ) : (
                    <Activity className="h-4 w-4" />
                  )
                }
              />
            </div>
          </div>

          {/* Schnellzugriff */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h3 className="text-base font-semibold text-on-surface">
                {t('mss.vault.dashboard.schnellzugriff')}
              </h3>
            </div>
            <div className="grid grid-cols-4 gap-2.5 lg:grid-cols-5">
              <Schnellaktion
                betont
                icon={<Plus className="h-4 w-4" />}
                label={t('mss.vault.dashboard.neuerEintrag')}
                kurzLabel={t('mss.vault.dashboard.neuKurz')}
                onClick={onNeuerEintrag}
              />
              <Schnellaktion
                icon={<Sparkles className="h-4 w-4" />}
                label={t('mss.vault.dashboard.passwortGenerieren')}
                kurzLabel={t('mss.vault.dashboard.generatorKurz')}
                onClick={onPasswortGenerieren}
              />
              <FileButton
                onFile={onDateiHochladen}
                disabled={dateiBusy}
                variant="ghost"
                className="min-h-[74px] w-full rounded-2xl border border-outline-variant/20 bg-surface-container-low/75 px-3 py-3 hover:border-outline-variant/40 hover:bg-surface-container/80"
              >
                <span className="flex w-full flex-col items-center justify-center gap-2 text-center">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-outline-variant/20 bg-surface-container text-on-surface">
                    {dateiBusy ? (
                      <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Upload className="h-4 w-4" aria-hidden="true" />
                    )}
                  </span>
                  <span className="hidden text-xs font-medium text-on-surface sm:inline">
                    {t('mss.vault.dashboard.dateiHochladen')}
                  </span>
                  <span className="text-label-sm font-medium text-on-surface sm:hidden">
                    {t('mss.vault.dashboard.hochladenKurz')}
                  </span>
                </span>
              </FileButton>
              {onSichereNotiz && (
                <Schnellaktion
                  icon={<FileText className="h-4 w-4" />}
                  label={t('mss.vault.dashboard.sichereNotiz')}
                  kurzLabel={t('mss.vault.dashboard.notizKurz')}
                  onClick={onSichereNotiz}
                />
              )}
              <div className="hidden lg:block">
                <Schnellaktion
                  icon={
                    sicherheitscheck.laeuft ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <ShieldCheck className="h-4 w-4 text-status-success" />
                    )
                  }
                  label={t('mss.vault.dashboard.sicherheitscheck')}
                  onClick={onSicherheitscheck}
                />
              </div>
            </div>
          </section>

          {/* Eigene Sammlungen / Ordner */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h3 className="text-base font-semibold text-on-surface">
                  {t('mss.vault.dashboard.sammlungen')}
                </h3>
                <p className="text-xs text-on-surface-variant">
                  {t('mss.vault.dashboard.sammlungenHinweis')}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onNeueSammlung}
                className="text-xs"
              >
                <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                {t('mss.vault.dashboard.sammlungAnlegen')}
              </Button>
            </div>

            {ordner.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {ordner.map((eintrag) => {
                  const hatBild = Boolean(eintrag.titelbild)
                  return (
                    <article
                      key={eintrag.id}
                      className={`group relative h-32 overflow-hidden rounded-2xl border border-outline-variant/20 transition-all hover:border-primary/40 ${
                        hatBild
                          ? 'bg-surface-container-low'
                          : 'bg-surface-container-low/85 hover:bg-surface-container/80'
                      }`}
                    >
                      {hatBild && (
                        <>
                          <img
                            src={eintrag.titelbild}
                            alt=""
                            loading="lazy"
                            className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-60 transition-transform duration-500 group-hover:scale-105"
                          />
                          <div
                            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/15"
                            aria-hidden="true"
                          />
                        </>
                      )}
                      <div className="relative flex h-full flex-col justify-between p-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => onSammlung(eintrag.id)}
                            className={`flex h-8 w-8 items-center justify-center rounded-xl border text-primary ${
                              hatBild
                                ? 'border-white/15 bg-black/45 backdrop-blur-md'
                                : 'border-outline-variant/25 bg-surface-container'
                            }`}
                            aria-label={t('mss.vault.dashboard.sammlungOeffnen', { name: eintrag.name })}
                          >
                            <Folder className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <div className="flex items-center gap-1">
                            {onSammlungBildAendern && (
                              <button
                                type="button"
                                onClick={() => onSammlungBildAendern(eintrag)}
                                aria-label={t('mss.vault.dashboard.hintergrundWaehlen', { name: eintrag.name })}
                                className={`flex h-7 w-7 items-center justify-center rounded-lg border opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 ${
                                  hatBild
                                    ? 'border-white/15 bg-black/45 text-white/80 backdrop-blur-md hover:text-white'
                                    : 'border-outline-variant/25 bg-surface-container text-on-surface-variant hover:text-on-surface'
                                }`}
                              >
                                <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                              </button>
                            )}
                            <ActionMenu
                              iconOnly
                              variant="ghost"
                              label={eintrag.name}
                              ariaLabel={t('mss.vault.dashboard.sammlungOeffnen', { name: eintrag.name })}
                              icon={
                                <MoreVertical
                                  className={`h-4 w-4 ${hatBild ? 'text-white/80' : 'text-on-surface-variant'}`}
                                />
                              }
                              items={[
                                {
                                  key: 'oeffnen',
                                  label: t('mss.vault.dashboard.alleAnsehen'),
                                  icon: <Folder className="h-4 w-4" />,
                                  onSelect: () => onSammlung(eintrag.id),
                                },
                                ...(onSammlungBildAendern
                                  ? [
                                      {
                                        key: 'bild',
                                        label: t('mss.vault.dashboard.hintergrundAendern'),
                                        icon: <ImageIcon className="h-4 w-4" />,
                                        onSelect: () => onSammlungBildAendern(eintrag),
                                      },
                                    ]
                                  : []),
                                {
                                  key: 'umbenennen',
                                  label: t('mss.vault.dateien.umbenennen'),
                                  icon: <FileText className="h-4 w-4" />,
                                  onSelect: () => onSammlungUmbenennen(eintrag),
                                },
                              ]}
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => onSammlung(eintrag.id)}
                          className="flex w-full flex-col items-start text-left"
                        >
                          <span
                            className={`w-full truncate text-sm font-semibold ${
                              hatBild ? 'text-white' : 'text-on-surface'
                            }`}
                          >
                            {eintrag.name}
                          </span>
                          <span className={`text-xs ${hatBild ? 'text-white/75' : 'text-on-surface-variant'}`}>
                            {t('mss.vault.dashboard.eintraegeAnzahl', { count: eintrag.anzahl })}
                          </span>
                        </button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>

          {/* Tresor-Katalog mit Filter-Pills, Standard-Kategorien (mit Bildern) und Einträgen */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-on-surface">
                {t('mss.vault.titelManager')}
              </h3>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onAlleEintraege}
                className="text-xs"
              >
                {t('mss.vault.dashboard.alleAnsehen')}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </div>

            {/* Filter-Pills + Ansichtsumschalter + Sortierung */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {TRESOR_FILTER.map((schluessel) => {
                  const aktiv = aktivFilter === schluessel && !aktiveStandardKategorie
                  return (
                    <button
                      key={schluessel}
                      type="button"
                      onClick={() => {
                        setAktivFilter(schluessel)
                        setAktiveStandardKategorie(null)
                      }}
                      className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
                        aktiv
                          ? 'border-primary/40 bg-primary/15 text-on-surface'
                          : 'border-outline-variant/20 bg-surface-container-low/75 text-on-surface-variant hover:border-outline-variant/40 hover:text-on-surface'
                      }`}
                    >
                      {t(FILTER_TEXT[schluessel])}
                    </button>
                  )
                })}
              </div>

              <div className="hidden items-center gap-2 sm:flex">
                <div className="flex items-center rounded-xl border border-outline-variant/20 bg-surface-container-low p-0.5">
                  <button
                    type="button"
                    onClick={() => setDarstellung('raster')}
                    aria-label={t('mss.vault.dashboard.ansichtRaster')}
                    aria-pressed={darstellung === 'raster'}
                    className={`rounded-lg p-1.5 transition-colors ${
                      darstellung === 'raster'
                        ? 'bg-primary/15 text-primary'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDarstellung('liste')}
                    aria-label={t('mss.vault.dashboard.ansichtListe')}
                    aria-pressed={darstellung === 'liste'}
                    className={`rounded-lg p-1.5 transition-colors ${
                      darstellung === 'liste'
                        ? 'bg-primary/15 text-primary'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <List className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>

                <div className="w-52">
                  <Dropdown
                    value={sortierung}
                    onChange={(wert) => setSortierung(wert as TresorSortierung)}
                    options={sortierOptionen}
                  />
                </div>
              </div>
            </div>

            {/* 5 Standard-Kategorien mit thematischen Hintergrundbildern (Desktop) */}
            <div className="hidden grid-cols-2 gap-3 md:grid lg:grid-cols-5">
              {standardKarten.map((karte) => {
                const istAktiv = aktiveStandardKategorie === karte.standardSchluessel
                return (
                  <article
                    key={karte.id}
                    className={`group relative h-32 overflow-hidden rounded-2xl border transition-all ${
                      istAktiv
                        ? 'border-primary ring-2 ring-primary/35'
                        : 'border-outline-variant/20 bg-surface-container-low hover:border-outline-variant/40'
                    }`}
                  >
                    {karte.titelbild && (
                      <img
                        src={karte.titelbild}
                        alt=""
                        loading="lazy"
                        className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-65 transition-transform duration-500 group-hover:scale-105"
                      />
                    )}
                    {karte.akzentFarbe && (
                      <div
                        className="pointer-events-none absolute inset-0"
                        style={{ background: karte.akzentFarbe }}
                        aria-hidden="true"
                      />
                    )}
                    <div
                      className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent"
                      aria-hidden="true"
                    />
                    <div className="relative flex h-full flex-col justify-between p-3">
                      <div className="flex justify-end gap-1">
                        {onStandardKategorieBildAendern && karte.standardSchluessel && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                if (karte.standardSchluessel) {
                                  onStandardKategorieBildAendern(
                                    karte.standardSchluessel,
                                    karte.name,
                                    karte.titelbild ?? '',
                                  )
                                }
                              }}
                              aria-label={t('mss.vault.dashboard.hintergrundWaehlen', { name: karte.name })}
                              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/15 bg-black/45 text-white/80 opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100 hover:text-white focus:opacity-100"
                            >
                              <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <ActionMenu
                              iconOnly
                              variant="ghost"
                              label={karte.name}
                              ariaLabel={t('mss.vault.dashboard.sammlungOeffnen', { name: karte.name })}
                              icon={<MoreHorizontal className="h-4 w-4 text-white/80" />}
                              items={[
                                {
                                  key: 'filtern',
                                  label: t('mss.vault.dashboard.sammlungOeffnen', { name: karte.name }),
                                  icon: <Folder className="h-4 w-4" />,
                                  onSelect: () =>
                                    setAktiveStandardKategorie((aktuell) =>
                                      aktuell === karte.standardSchluessel ? null : karte.standardSchluessel ?? null,
                                    ),
                                },
                                {
                                  key: 'bild',
                                  label: t('mss.vault.dashboard.hintergrundAendern'),
                                  icon: <ImageIcon className="h-4 w-4" />,
                                  onSelect: () => {
                                    if (karte.standardSchluessel) {
                                      onStandardKategorieBildAendern(
                                        karte.standardSchluessel,
                                        karte.name,
                                        karte.titelbild ?? '',
                                      )
                                    }
                                  },
                                },
                              ]}
                            />
                          </>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setAktiveStandardKategorie((aktuell) =>
                            aktuell === karte.standardSchluessel ? null : karte.standardSchluessel ?? null,
                          )
                        }
                        className="flex w-full flex-col items-start gap-0.5 text-left"
                      >
                        <span className="flex w-full items-center gap-1.5 truncate text-xs font-semibold text-white">
                          <StandardKategorieIcon schluessel={karte.standardSchluessel} />
                          <span className="truncate">{karte.name}</span>
                        </span>
                        <span className="text-label-sm text-white/75">
                          {t('mss.vault.dashboard.eintraegeAnzahl', { count: karte.anzahl })}
                        </span>
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>

            {/* Eintrags-Karten (Raster oder Liste) */}
            {katalogEintraege.length === 0 ? (
              <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-low/60">
                <Zustandsflaeche
                  art="leer"
                  icon={<KeyRound className="h-8 w-8" />}
                  titel={t('mss.vault.dashboard.keineEintraege')}
                  text={t('mss.vault.dashboard.keineEintraegeHinweis')}
                >
                  <Button
                    type="button"
                    size="sm"
                    onClick={onNeuerEintrag}
                    className="max-sm:min-h-11"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('mss.vault.dashboard.neuerEintrag')}
                  </Button>
                </Zustandsflaeche>
              </div>
            ) : darstellung === 'raster' ? (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
                {katalogEintraege.map((eintragItem) => (
                  <button
                    key={eintragItem.id}
                    type="button"
                    onClick={() => onEintrag(eintragItem)}
                    className="group flex items-center gap-3 rounded-2xl border border-outline-variant/20 bg-surface-container-low/80 px-3.5 py-3 text-left transition-all hover:border-outline-variant/40 hover:bg-surface-container/80"
                  >
                    <EintragVorschauSymbol item={eintragItem} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-on-surface">
                        {eintragItem.service}
                      </span>
                      <span className="block truncate text-xs text-on-surface-variant">
                        {eintragItem.username || kategorieLabel(eintragItem)}
                      </span>
                    </span>
                    <MoreHorizontal
                      className="h-4 w-4 shrink-0 text-on-surface-variant/70 transition-colors group-hover:text-on-surface"
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-outline-variant/15 overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-low/80">
                {katalogEintraege.map((eintragItem) => {
                  const groesse = eintragItem.datei?.original.echt
                  const punkte = eintragItem.password ? passwortPunkte(eintragItem.password) : null
                  return (
                    <li key={eintragItem.id}>
                      <button
                        type="button"
                        onClick={() => onEintrag(eintragItem)}
                        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-container/70"
                      >
                        <EintragVorschauSymbol item={eintragItem} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-on-surface">
                            {eintragItem.service}
                          </span>
                          <span className="block truncate text-xs text-on-surface-variant">
                            {eintragItem.username || kategorieLabel(eintragItem)}
                          </span>
                        </span>
                        {groesse ? (
                          <span className="hidden shrink-0 text-xs text-on-surface-variant sm:block">
                            {formatBytes(groesse)}
                          </span>
                        ) : punkte != null ? (
                          <span
                            className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-surface-container sm:block"
                            aria-hidden="true"
                          >
                            <span
                              className={`block h-full rounded-full ${
                                punkte >= 65
                                  ? 'bg-status-success'
                                  : punkte >= 40
                                    ? 'bg-status-warning'
                                    : 'bg-status-destructive'
                              }`}
                              style={{ width: `${punkte}%` }}
                            />
                          </span>
                        ) : null}
                        <span className="hidden shrink-0 text-xs text-on-surface-variant md:block">
                          {kategorieLabel(eintragItem)}
                        </span>
                        <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant/70" aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            {onFilterAnsicht && aktivFilter !== 'alle' && (
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onFilterAnsicht(aktivFilter)}
                  className="text-xs"
                >
                  {t('mss.vault.dashboard.alleAnsehen')}
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
