/**
 * Audit-Protokoll: Kennzahlen, Suche, Filter und Detailansicht.
 *
 * Sichtbar nur mit system.audit.read (Route + Nav). Die Anzeige erfindet
 * nichts: was das Backend nicht liefert, bleibt leer oder „—“.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ChevronRight,
  Download,
  Filter,
  Minus,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  UserRound,
  X,
} from 'lucide-react'
import {
  ActionMenu,
  Badge,
  Button,
  Dialog,
  DialogContent,
  Dropdown,
  Input,
  Kurzinfo,
  Pagination,
  Spinner,
  Zustandsflaeche,
  type DropdownOption,
} from '@maunting/ui'
import { api } from '@/api/client'
import { useMedienabfrage } from '@/hooks/useMedienabfrage'
import {
  AUDIT_KATEGORIEN,
  type AuditKategorie,
  type AuditLogRow,
  type AuditSeite,
  type AuditUebersicht,
  auditAktionText,
  auditKategorie,
  formatAuditTarget,
  formatAuditTime,
  formatAuditZeitKurz,
  mapAuditSeite,
} from '@/services/auditPresentation'
import { toast } from '@/stores/toastStore'
import { AuditKategorieSymbol } from '@/components/audit/AuditKategorieSymbol'
import { AuditDetailPanel } from '@/components/audit/AuditDetailPanel'

const SEITENGROESSE = 25
const EXPORT_MAX = 5000

type Bereich = '1' | '7' | '30' | '90'

interface KennzahlStil {
  icon: LucideIcon
  flaeche: string
}

const KENNZAHL_STIL: Record<'total' | 'users' | 'security' | 'failed', KennzahlStil> = {
  total: { icon: Shield, flaeche: 'border-primary/25 bg-primary/10 text-primary' },
  users: { icon: UserRound, flaeche: 'border-status-success/25 bg-status-success/10 text-status-success' },
  security: { icon: ShieldAlert, flaeche: 'border-status-warning/25 bg-status-warning/10 text-status-warning' },
  failed: { icon: AlertTriangle, flaeche: 'border-status-destructive/25 bg-status-destructive/10 text-status-destructive' },
}

function Kennzahl({
  label,
  wert,
  delta,
  deltaKlasse,
  stil,
  laden,
  locale,
}: {
  label: string
  wert: number | null
  delta: string
  deltaKlasse: string
  stil: KennzahlStil
  laden: boolean
  locale: string
}) {
  const Icon = stil.icon
  const Pfeil = delta.startsWith('+') ? ArrowUpRight : delta.startsWith('-') ? ArrowDownRight : Minus
  return (
    <div className="msm-card flex items-start gap-3 p-3.5 sm:p-4">
      <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg border ${stil.flaeche}`} aria-hidden="true">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-label-sm font-semibold uppercase tracking-[0.08em] text-on-surface-variant">{label}</p>
        <p className="mt-0.5 font-headline text-title-lg font-semibold leading-none text-on-surface">
          {laden ? (
            <span className="inline-block h-6 w-14 animate-pulse rounded bg-surface-container-high" />
          ) : wert == null ? (
            '—'
          ) : (
            wert.toLocaleString(locale)
          )}
        </p>
        <span className={`mt-1.5 inline-flex items-center gap-0.5 text-label-sm font-medium ${deltaKlasse}`}>
          <Pfeil className="h-3 w-3" aria-hidden="true" />
          {delta}
        </span>
      </div>
    </div>
  )
}

function prozentDelta(jetzt: number, vorher: number, neuText: string): { text: string; klasse: string } {
  if (vorher === 0) {
    if (jetzt === 0) return { text: '±0 %', klasse: 'text-on-surface-variant' }
    return { text: neuText, klasse: 'text-primary' }
  }
  const prozent = Math.round(((jetzt - vorher) / vorher) * 100)
  if (prozent === 0) return { text: '±0 %', klasse: 'text-on-surface-variant' }
  return {
    text: `${prozent > 0 ? '+' : ''}${prozent} %`,
    klasse: prozent > 0 ? 'text-status-success' : 'text-status-warning',
  }
}

function absolutDelta(jetzt: number, vorher: number, steigendIstSchlecht: boolean): { text: string; klasse: string } {
  const diff = jetzt - vorher
  if (diff === 0) return { text: '±0', klasse: 'text-on-surface-variant' }
  const schlecht = steigendIstSchlecht ? diff > 0 : diff < 0
  return {
    text: `${diff > 0 ? '+' : ''}${diff}`,
    klasse: schlecht ? 'text-status-destructive' : 'text-status-success',
  }
}

function csvFeld(wert: unknown): string {
  return `"${String(wert ?? '').replace(/"/g, '""')}"`
}

function dateiname(art: 'csv' | 'json'): string {
  const heute = new Date().toISOString().slice(0, 10)
  return `audit-protokoll-${heute}.${art}`
}

export function AdminAudit() {
  const { t, i18n } = useTranslation()
  const locale = i18n.language?.startsWith('de') ? 'de-DE' : 'en-US'
  const breit = useMedienabfrage('(min-width: 1280px)')

  const [seite, setSeite] = useState<AuditSeite>({ items: [], total: 0 })
  const [uebersicht, setUebersicht] = useState<AuditUebersicht | null>(null)
  const [laden, setLaden] = useState(true)
  const [statistikLaden, setStatistikLaden] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)

  const [suche, setSuche] = useState('')
  const [gesuchteSuche, setGesuchteSuche] = useState('')
  const [bereich, setBereich] = useState<Bereich>('7')
  const [kategorie, setKategorie] = useState<'all' | AuditKategorie>('all')
  const [ergebnis, setErgebnis] = useState<'all' | 'success' | 'failed'>('all')
  const [herkunft, setHerkunft] = useState<'all' | 'direct' | 'ai' | 'external' | 'system'>('all')
  const [seitenzahl, setSeitenzahl] = useState(1)
  const [filterOffen, setFilterOffen] = useState(false)

  const [ausgewaehlt, setAusgewaehlt] = useState<number | null>(null)
  const [detailOffen, setDetailOffen] = useState(false)
  const [exportLaeuft, setExportLaeuft] = useState(false)
  const [ladeZaehler, setLadeZaehler] = useState(0)
  const autoGewaehlt = useRef(0)

  useEffect(() => {
    const timer = window.setTimeout(() => setGesuchteSuche(suche.trim()), 300)
    return () => window.clearTimeout(timer)
  }, [suche])

  useEffect(() => {
    setSeitenzahl(1)
    setAusgewaehlt(null)
  }, [gesuchteSuche, bereich, kategorie, ergebnis, herkunft])

  const abfrage = useCallback(
    (seiteNummer: number, groesse = SEITENGROESSE, versatz?: number) => {
      const params = new URLSearchParams()
      params.set('limit', String(groesse))
      params.set('offset', String(versatz ?? (seiteNummer - 1) * groesse))
      params.set('days', bereich)
      if (gesuchteSuche) params.set('search', gesuchteSuche)
      if (kategorie !== 'all') params.set('category', kategorie)
      if (ergebnis !== 'all') params.set('result', ergebnis)
      if (herkunft !== 'all') params.set('origin', herkunft)
      return params.toString()
    },
    [bereich, ergebnis, gesuchteSuche, herkunft, kategorie],
  )

  const ladenListe = useCallback(async () => {
    setLaden(true)
    try {
      const antwort = await api<unknown>(`/admin/audit-logs?${abfrage(seitenzahl)}`)
      setSeite(mapAuditSeite(antwort))
      setFehler(null)
      setLadeZaehler((zaehler) => zaehler + 1)
    } catch (err: unknown) {
      const meldung = err instanceof Error ? err.message : t('audit.loadFailed')
      setFehler(meldung)
      setSeite({ items: [], total: 0 })
    } finally {
      setLaden(false)
    }
  }, [abfrage, seitenzahl, t])

  useEffect(() => {
    void ladenListe()
  }, [ladenListe])

  useEffect(() => {
    let abgebrochen = false
    setStatistikLaden(true)
    api<AuditUebersicht>(`/admin/audit-logs/summary?days=${bereich}`)
      .then((antwort) => {
        if (!abgebrochen) setUebersicht(antwort)
      })
      .catch(() => {
        if (!abgebrochen) setUebersicht(null)
      })
      .finally(() => {
        if (!abgebrochen) setStatistikLaden(false)
      })
    return () => {
      abgebrochen = true
    }
  }, [bereich])

  const auswahl = useMemo(
    () => seite.items.find((eintrag) => eintrag.id === ausgewaehlt) ?? null,
    [seite.items, ausgewaehlt],
  )

  useEffect(() => {
    // Nur nach einem abgeschlossenen Ladevorgang auswaehlen: Wer die
    // Detailspalte schliesst, soll sie nicht sofort wieder aufgehen sehen.
    if (!breit || ladeZaehler === autoGewaehlt.current) return
    autoGewaehlt.current = ladeZaehler
    if (seite.items.length === 0) return
    if (ausgewaehlt != null && seite.items.some((eintrag) => eintrag.id === ausgewaehlt)) return
    setAusgewaehlt(seite.items[0].id)
  }, [ausgewaehlt, breit, ladeZaehler, seite.items])

  useEffect(() => {
    if (breit) setDetailOffen(false)
  }, [breit])

  const zeigeEintrag = (eintrag: AuditLogRow) => {
    setAusgewaehlt(eintrag.id)
    if (!breit) setDetailOffen(true)
  }

  const aktiveFilter = [kategorie !== 'all', ergebnis !== 'all', herkunft !== 'all'].filter(Boolean).length

  const filterZuruecksetzen = () => {
    setKategorie('all')
    setErgebnis('all')
    setHerkunft('all')
  }

  const bereichOptionen: DropdownOption[] = (['1', '7', '30', '90'] as Bereich[]).map((wert) => ({
    value: wert,
    label: t(`audit.range.${wert}`),
  }))

  const kategorieOptionen: DropdownOption[] = [
    { value: 'all', label: t('audit.filter.allCategories') },
    ...AUDIT_KATEGORIEN.map((wert) => ({ value: wert, label: t(`audit.categories.${wert}`) })),
  ]

  const ergebnisOptionen: DropdownOption[] = [
    { value: 'all', label: t('audit.filter.allResults') },
    { value: 'success', label: t('audit.result.success') },
    { value: 'failed', label: t('audit.result.failed') },
  ]

  const herkunftOptionen: DropdownOption[] = [
    { value: 'all', label: t('audit.filter.allOrigins') },
    ...(['direct', 'ai', 'external', 'system'] as const).map((wert) => ({
      value: wert,
      label: t(`audit.origins.${wert}`),
    })),
  ]

  const zeilenText = (eintrag: AuditLogRow) =>
    eintrag.target_type
      ? eintrag.target_label
        ? t('audit.targetWithName', {
            type: t(`audit.targetTypes.${eintrag.target_type}`, { defaultValue: eintrag.target_type }),
            id: eintrag.target_id ?? '—',
            name: eintrag.target_label,
          })
        : formatAuditTarget(eintrag)
      : formatAuditTarget(eintrag)

  const exportieren = async (format: 'csv' | 'json') => {
    setExportLaeuft(true)
    try {
      const alle: AuditLogRow[] = []
      let versatz = 0
      let gesamt = seite.total
      while (alle.length < EXPORT_MAX) {
        const antwort = await api<unknown>(`/admin/audit-logs?${abfrage(1, 200, versatz)}`)
        const teil = mapAuditSeite(antwort)
        gesamt = teil.total
        alle.push(...teil.items)
        if (teil.items.length === 0 || alle.length >= gesamt) break
        versatz += teil.items.length
      }
      if (alle.length === 0) {
        toast.info(t('audit.export.empty'))
        return
      }

      let inhalt = ''
      let mime = 'application/json;charset=utf-8'
      if (format === 'csv') {
        const kopf = [
          t('audit.colTime'),
          t('audit.colAction'),
          t('audit.colCategory'),
          t('audit.colResult'),
          t('audit.colUser'),
          t('audit.colTarget'),
          t('audit.colOrigin'),
          t('audit.colCorrelation'),
          t('audit.colDetails'),
        ]
        const zeilen = alle.map((eintrag) => [
          formatAuditTime(eintrag.created_at, locale),
          auditAktionText(t, eintrag.action, eintrag.details),
          t(`audit.categories.${eintrag.category ?? auditKategorie(eintrag.action)}`),
          t(eintrag.result === 'failed' ? 'audit.result.failed' : 'audit.result.success'),
          eintrag.username ?? (eintrag.user_id == null ? t('audit.list.systemUser') : `#${eintrag.user_id}`),
          zeilenText(eintrag),
          t(`audit.origins.${eintrag.origin}`, { defaultValue: eintrag.origin }),
          eintrag.correlation_id ?? '',
          eintrag.details ?? '',
        ])
        inhalt = '\uFEFF' + [kopf, ...zeilen].map((zeile) => zeile.map(csvFeld).join(';')).join('\r\n')
        mime = 'text/csv;charset=utf-8'
      } else {
        inhalt = JSON.stringify(alle, null, 2)
      }

      const blob = new Blob([inhalt], { type: mime })
      const adresse = URL.createObjectURL(blob)
      const anker = document.createElement('a')
      anker.href = adresse
      anker.download = dateiname(format)
      document.body.appendChild(anker)
      anker.click()
      anker.remove()
      window.setTimeout(() => URL.revokeObjectURL(adresse), 2000)

      if (alle.length < gesamt) toast.info(t('audit.export.truncated', { count: EXPORT_MAX }))
      else toast.success(t('audit.export.success', { count: alle.length }))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : t('audit.export.failed'))
    } finally {
      setExportLaeuft(false)
    }
  }

  const zahlen = uebersicht?.current
  const vorher = uebersicht?.previous
  const ohneVergleich = { text: '—', klasse: 'text-on-surface-variant' }
  const totalDelta = zahlen && vorher ? prozentDelta(zahlen.total, vorher.total, t('audit.stats.new')) : ohneVergleich
  const userDelta = zahlen && vorher ? prozentDelta(zahlen.users, vorher.users, t('audit.stats.new')) : ohneVergleich
  const securityDelta = zahlen && vorher ? absolutDelta(zahlen.security, vorher.security, true) : ohneVergleich
  const failedDelta = zahlen && vorher ? absolutDelta(zahlen.failed, vorher.failed, true) : ohneVergleich

  return (
    <div className="msm-page">
      <header className="flex flex-col gap-4 border-b border-outline-variant/55 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-primary/25 bg-primary/10 text-primary" aria-hidden="true">
            <Shield className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-label-sm font-semibold uppercase tracking-[0.12em] text-primary/75">
              {t('pageContext.administration')}
            </p>
            <h1 className="mt-1 font-headline text-headline-sm font-semibold text-on-surface md:text-headline-lg">
              {t('audit.title')}
            </h1>
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-on-surface-variant">{t('audit.subtitle')}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0">
          <Dropdown
            value={bereich}
            onChange={(wert) => setBereich(wert as Bereich)}
            options={bereichOptionen}
            aria-label={t('audit.range.label')}
            className="w-40"
            data-testid="audit-bereich"
          />
          <Kurzinfo text={t('audit.refresh')} seite="ende">
            <button
              type="button"
              onClick={() => void ladenListe()}
              disabled={laden}
              aria-label={t('audit.refresh')}
              className="grid h-10 w-10 place-items-center rounded-control border border-outline-variant/70 bg-surface-container-high/60 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface disabled:opacity-50 max-sm:min-h-11 max-sm:min-w-11"
            >
              <RefreshCw className={`h-4 w-4 ${laden ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </Kurzinfo>
          <ActionMenu
            label={t('audit.export.label')}
            icon={<Download className="h-4 w-4" aria-hidden="true" />}
            align="end"
            disabled={exportLaeuft}
            surface="dna"
            items={[
              {
                key: 'csv',
                label: t('audit.export.csv'),
                onSelect: () => void exportieren('csv'),
              },
              {
                key: 'json',
                label: t('audit.export.json'),
                onSelect: () => void exportieren('json'),
              },
            ]}
          />
        </div>
      </header>

      <section aria-label={t('audit.stats.label')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kennzahl
          label={t('audit.stats.total')}
          wert={zahlen?.total ?? null}
          delta={totalDelta.text}
          deltaKlasse={totalDelta.klasse}
          stil={KENNZAHL_STIL.total}
          laden={statistikLaden}
          locale={locale}
        />
        <Kennzahl
          label={t('audit.stats.users')}
          wert={zahlen?.users ?? null}
          delta={userDelta.text}
          deltaKlasse={userDelta.klasse}
          stil={KENNZAHL_STIL.users}
          laden={statistikLaden}
          locale={locale}
        />
        <Kennzahl
          label={t('audit.stats.security')}
          wert={zahlen?.security ?? null}
          delta={securityDelta.text}
          deltaKlasse={securityDelta.klasse}
          stil={KENNZAHL_STIL.security}
          laden={statistikLaden}
          locale={locale}
        />
        <Kennzahl
          label={t('audit.stats.failed')}
          wert={zahlen?.failed ?? null}
          delta={failedDelta.text}
          deltaKlasse={failedDelta.klasse}
          stil={KENNZAHL_STIL.failed}
          laden={statistikLaden}
          locale={locale}
        />
      </section>

      <div className="msm-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:p-4">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" aria-hidden="true" />
          <Input
            value={suche}
            onChange={(event) => setSuche(event.target.value)}
            placeholder={t('audit.searchPlaceholder')}
            aria-label={t('audit.searchLabel')}
            autoComplete="off"
            maxLength={200}
            className="pl-9"
          />
        </div>
        <Button
          type="button"
          variant={filterOffen || aktiveFilter > 0 ? 'primary' : 'secondary'}
          onClick={() => setFilterOffen((offen) => !offen)}
          className="inline-flex min-h-11 items-center justify-center gap-2 sm:min-h-10"
          aria-expanded={filterOffen}
        >
          <Filter className="h-4 w-4" aria-hidden="true" />
          {t('audit.filter.button')}
          {aktiveFilter > 0 && (
            <span className="rounded-full bg-on-primary/20 px-1.5 text-label-sm font-semibold">
              {aktiveFilter}
            </span>
          )}
        </Button>
      </div>

      {filterOffen && (
        <div className="msm-card grid gap-3 p-4 sm:grid-cols-3">
          <div>
            <span className="mb-1.5 block text-xs font-medium text-on-surface-variant">{t('audit.filter.category')}</span>
            <Dropdown
              value={kategorie}
              onChange={(wert) => setKategorie(wert as 'all' | AuditKategorie)}
              options={kategorieOptionen}
              aria-label={t('audit.filter.category')}
              data-testid="audit-kategorie"
            />
          </div>
          <div>
            <span className="mb-1.5 block text-xs font-medium text-on-surface-variant">{t('audit.filter.result')}</span>
            <Dropdown
              value={ergebnis}
              onChange={(wert) => setErgebnis(wert as 'all' | 'success' | 'failed')}
              options={ergebnisOptionen}
              aria-label={t('audit.filter.result')}
              data-testid="audit-ergebnis"
            />
          </div>
          <div>
            <span className="mb-1.5 block text-xs font-medium text-on-surface-variant">{t('audit.filter.origin')}</span>
            <Dropdown
              value={herkunft}
              onChange={(wert) => setHerkunft(wert as typeof herkunft)}
              options={herkunftOptionen}
              aria-label={t('audit.filter.origin')}
              data-testid="audit-herkunft"
            />
          </div>
          <div className="sm:col-span-3">
            <Button variant="secondary" type="button" onClick={filterZuruecksetzen} disabled={aktiveFilter === 0}>
              {t('audit.filter.reset')}
            </Button>
          </div>
        </div>
      )}

      {(aktiveFilter > 0 || gesuchteSuche) && (
        <div className="flex flex-wrap items-center gap-2">
          {kategorie !== 'all' && (
            <FilterChip
              label={t('audit.chips.category', { value: t(`audit.categories.${kategorie}`) })}
              entfernenLabel={t('audit.chips.remove', { value: t(`audit.categories.${kategorie}`) })}
              onEntfernen={() => setKategorie('all')}
            />
          )}
          {ergebnis !== 'all' && (
            <FilterChip
              label={t('audit.chips.result', {
                value: t(ergebnis === 'failed' ? 'audit.result.failed' : 'audit.result.success'),
              })}
              entfernenLabel={t('audit.chips.remove', {
                value: t(ergebnis === 'failed' ? 'audit.result.failed' : 'audit.result.success'),
              })}
              onEntfernen={() => setErgebnis('all')}
            />
          )}
          {herkunft !== 'all' && (
            <FilterChip
              label={t('audit.chips.origin', { value: t(`audit.origins.${herkunft}`) })}
              entfernenLabel={t('audit.chips.remove', { value: t(`audit.origins.${herkunft}`) })}
              onEntfernen={() => setHerkunft('all')}
            />
          )}
          {gesuchteSuche && (
            <FilterChip
              label={t('audit.chips.search', { value: gesuchteSuche })}
              entfernenLabel={t('audit.chips.removeSearch', { value: gesuchteSuche })}
              onEntfernen={() => setSuche('')}
            />
          )}
          {aktiveFilter > 0 && (
            <button
              type="button"
              onClick={filterZuruecksetzen}
              className="text-xs font-medium text-on-surface-variant underline-offset-2 hover:text-on-surface hover:underline max-sm:min-h-11"
            >
              {t('audit.filter.reset')}
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start">
        <section className="msm-card overflow-hidden" aria-label={t('audit.list.heading')}>
          <div className="flex items-center justify-between gap-3 border-b border-outline-variant/60 px-4 py-2.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              {t('audit.list.total', { count: seite.total })}
            </p>
            {laden && <Spinner size="sm" className="text-secondary" />}
          </div>

          {fehler && seite.items.length === 0 ? (
            <Zustandsflaeche
              art="fehler"
              titel={t('audit.loadFailed')}
              text={fehler}
              erneutLabel={t('audit.retry')}
              onErneut={() => void ladenListe()}
            />
          ) : !laden && seite.items.length === 0 ? (
            <Zustandsflaeche
              art="leer"
              titel={t('audit.empty')}
              text={t('audit.emptyHint')}
              icon={<Search className="h-10 w-10" />}
              ansagen
            >
              {(aktiveFilter > 0 || gesuchteSuche) && (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => {
                    filterZuruecksetzen()
                    setSuche('')
                  }}
                >
                  {t('audit.filter.reset')}
                </Button>
              )}
            </Zustandsflaeche>
          ) : (
            <ul className="divide-y divide-outline-variant/50">
              {seite.items.map((eintrag) => {
                const erfolg = eintrag.result !== 'failed'
                const kategorieWert = eintrag.category ?? auditKategorie(eintrag.action)
                const istGewaehlt = eintrag.id === ausgewaehlt
                return (
                  <li key={eintrag.id}>
                    <button
                      type="button"
                      onClick={() => zeigeEintrag(eintrag)}
                      aria-current={istGewaehlt ? 'true' : undefined}
                      data-testid="audit-zeile"
                      className={`flex w-full items-start gap-3 px-3 py-3 text-left transition-colors sm:px-4 ${
                        istGewaehlt ? 'bg-primary/10' : 'hover:bg-surface-container-high/50'
                      }`}
                    >
                      <AuditKategorieSymbol kategorie={kategorieWert} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 truncate text-sm font-semibold text-on-surface">
                            {auditAktionText(t, eintrag.action, eintrag.details)}
                          </span>
                          <Badge variant={erfolg ? 'success' : 'destructive'} className="shrink-0">
                            {t(erfolg ? 'audit.result.success' : 'audit.result.failed')}
                          </Badge>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-on-surface-variant">
                          <span>
                            {formatAuditZeitKurz(eintrag.created_at, locale, {
                              heute: t('audit.today'),
                              gestern: t('audit.gestern'),
                            })}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="truncate">
                            {eintrag.username ?? (eintrag.user_id == null ? t('audit.list.systemUser') : `#${eintrag.user_id}`)}
                          </span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-on-surface-variant/85">
                          <span>{t(`audit.categories.${kategorieWert}`)}</span>
                          <span aria-hidden="true">·</span>
                          <span className="min-w-0 truncate">{zeilenText(eintrag)}</span>
                        </span>
                      </span>
                      <ChevronRight className="mt-1.5 hidden h-4 w-4 shrink-0 text-on-surface-variant/50 sm:block" aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}

          <div className="px-4 pb-4 pt-2">
            <Pagination
              page={seitenzahl}
              pageCount={Math.max(1, Math.ceil(seite.total / SEITENGROESSE))}
              label={t('audit.list.total', { count: seite.total })}
              disabled={laden}
              onChange={setSeitenzahl}
            />
          </div>
        </section>

        {breit && (
          <aside className="xl:sticky xl:top-4">
            <AuditDetailPanel
              row={auswahl}
              locale={locale}
              onClose={auswahl ? () => setAusgewaehlt(null) : undefined}
            />
          </aside>
        )}
      </div>

      <Dialog open={detailOffen} onOpenChange={setDetailOffen}>
        <DialogContent
          size="voll"
          aria-label={t('audit.detail.title')}
          className="xl:hidden"
          showCloseButton={false}
        >
          <div className="h-full overflow-y-auto p-3 sm:p-4">
            <AuditDetailPanel
              row={auswahl}
              locale={locale}
              onClose={() => setDetailOffen(false)}
              className="rounded-none border-0 bg-transparent shadow-none"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FilterChip({
  label,
  entfernenLabel,
  onEntfernen,
}: {
  label: string
  entfernenLabel: string
  onEntfernen: () => void
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 py-1 pl-3 pr-1 text-xs text-primary">
      <span className="truncate">{label}</span>
      <Kurzinfo text={entfernenLabel} seite="ende">
        <button
          type="button"
          onClick={onEntfernen}
          aria-label={entfernenLabel}
          className="grid h-6 w-6 place-items-center rounded-full transition-colors hover:bg-primary/15 max-sm:min-h-11 max-sm:min-w-11"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </Kurzinfo>
    </span>
  )
}
