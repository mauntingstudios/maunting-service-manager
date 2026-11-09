import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Copy, X } from 'lucide-react'
import { Badge, Kurzinfo } from '@maunting/ui'
import {
  type AuditLogRow,
  auditAktionText,
  auditKategorie,
  formatAuditTarget,
  formatAuditTime,
  parseAuditDetails,
} from '@/services/auditPresentation'
import { toast } from '@/stores/toastStore'
import { AuditKategorieSymbol } from './AuditKategorieSymbol'

interface Props {
  row: AuditLogRow | null
  locale: string
  onClose?: () => void
  className?: string
}

const DETAILS_SCHLUESSEL = ['before', 'after', 'vorher', 'nachher']

function istObjekt(wert: unknown): wert is Record<string, unknown> {
  return !!wert && typeof wert === 'object' && !Array.isArray(wert)
}

function wertText(wert: unknown): string {
  if (wert == null) return '—'
  if (typeof wert === 'string') return wert
  if (typeof wert === 'number') return String(wert)
  if (typeof wert === 'boolean') return wert ? 'true' : 'false'
  if (Array.isArray(wert)) {
    return wert
      .map((eintrag) => (typeof eintrag === 'object' ? JSON.stringify(eintrag) : String(eintrag)))
      .join(', ')
  }
  return JSON.stringify(wert)
}

function zielText(row: AuditLogRow, uebersetzen: (key: string, options?: Record<string, unknown>) => string): string {
  if (!row.target_type) return formatAuditTarget(row)
  const typ = uebersetzen(`audit.targetTypes.${row.target_type}`, { defaultValue: row.target_type })
  if (row.target_id == null) return typ
  return row.target_label
    ? uebersetzen('audit.targetWithName', { type: typ, id: row.target_id, name: row.target_label })
    : uebersetzen('audit.target', { type: typ, id: row.target_id })
}

export function AuditDetailPanel({ row, locale, onClose, className = '' }: Props) {
  const { t } = useTranslation()
  const [kopiert, setKopiert] = useState(false)

  useEffect(() => {
    setKopiert(false)
  }, [row?.id])

  const details = useMemo(() => parseAuditDetails(row?.details), [row?.details])
  const diff = useMemo(() => {
    if (!details) return null
    // Zwei Formen kommen vor: die englischen Schluessel aus spaeteren
    // Schreibwegen und `vorher`/`nachher` aus dem Tresor-Kontingent.
    const vorher = details.before ?? details.vorher
    const nachher = details.after ?? details.nachher
    if (!istObjekt(vorher) && !istObjekt(nachher)) {
      if (vorher === undefined || nachher === undefined) return null
      return [{ key: 'value', vorher, nachher }]
    }
    const a = istObjekt(vorher) ? vorher : {}
    const b = istObjekt(nachher) ? nachher : {}
    const schluessel = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort()
    return schluessel
      .filter((key) => JSON.stringify(a[key]) !== JSON.stringify(b[key]))
      .map((key) => ({ key, vorher: a[key], nachher: b[key] }))
  }, [details])

  const paare = useMemo(() => {
    if (!details) return []
    // Sind `vorher`/`nachher` schon als Diff gezeigt, stehen sie nicht noch
    // einmal als zwei Zeilen darunter. Fehlt die Haelfte, bleibt sie sichtbar.
    const verbraucht = diff ? DETAILS_SCHLUESSEL : []
    return Object.entries(details)
      .filter(([key]) => !verbraucht.includes(key))
      .sort(([a], [b]) => a.localeCompare(b))
  }, [details, diff])

  if (!row) {
    return (
      <div className={`msm-card flex flex-col items-center justify-center gap-2 px-6 py-12 text-center ${className}`}>
        <AuditKategorieSymbol kategorie="system" groesse="md" />
        <p className="text-sm font-semibold text-on-surface">{t('audit.detail.empty')}</p>
        <p className="max-w-xs text-xs text-on-surface-variant">{t('audit.detail.emptyHint')}</p>
      </div>
    )
  }

  const kategorie = row.category ?? auditKategorie(row.action)
  const label = auditAktionText(t, row.action, row.details)
  const erfolg = (row.result ?? 'success') === 'success'

  const detailsKopieren = async () => {
    const inhalt = row.details ?? JSON.stringify(row, null, 2)
    try {
      await navigator.clipboard.writeText(inhalt)
      setKopiert(true)
      toast.success(t('audit.detail.copied'))
      window.setTimeout(() => setKopiert(false), 2000)
    } catch {
      toast.error(t('audit.detail.copyFailed'))
    }
  }

  const detailWert = (key: string, wert: unknown): string => {
    if (typeof wert === 'boolean') return wert ? t('audit.detail.yes') : t('audit.detail.no')
    if (key === 'operation' && typeof wert === 'string') {
      return t(`audit.operations.${wert}`, { defaultValue: wert })
    }
    if (key === 'error_code' && typeof wert === 'string') {
      return t(`audit.errorCodes.${wert}`, { defaultValue: wert })
    }
    return wertText(wert)
  }

  return (
    <div className={`msm-card overflow-hidden ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-outline-variant/60 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <AuditKategorieSymbol kategorie={kategorie} groesse="md" />
          <div className="min-w-0">
            <p className="font-mono text-label-sm uppercase tracking-wide text-on-surface-variant">
              #{row.id} · {t(`audit.categories.${kategorie}`)}
            </p>
            <h2 className="mt-1 font-headline text-base font-semibold leading-snug text-on-surface">
              {label}
            </h2>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge variant={erfolg ? 'success' : 'destructive'}>
                {t(erfolg ? 'audit.result.success' : 'audit.result.failed')}
              </Badge>
              <span className="text-label-sm text-on-surface-variant">
                {t(`audit.origins.${row.origin}`, { defaultValue: row.origin })}
              </span>
            </div>
          </div>
        </div>
        {onClose && (
          <Kurzinfo text={t('audit.detail.close')} seite="ende">
            <button
              type="button"
              onClick={onClose}
              aria-label={t('audit.detail.close')}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface max-sm:min-h-11 max-sm:min-w-11"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </Kurzinfo>
        )}
      </div>

      <div className="space-y-5 p-4">
        <dl className="space-y-2.5 text-sm">
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-on-surface-variant">{t('audit.detail.time')}</dt>
            <dd className="text-right font-mono text-xs text-on-surface">{formatAuditTime(row.created_at, locale)}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-on-surface-variant">{t('audit.detail.user')}</dt>
            <dd className="min-w-0 text-right text-on-surface">
              {row.username ?? (row.user_id == null ? t('audit.list.systemUser') : `#${row.user_id}`)}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-on-surface-variant">{t('audit.detail.target')}</dt>
            <dd className="min-w-0 break-words text-right text-on-surface">{zielText(row, t)}</dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-on-surface-variant">{t('audit.detail.correlation')}</dt>
            <dd className="min-w-0 break-all text-right font-mono text-label-sm text-on-surface-variant">
              {row.correlation_id ?? '—'}
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4">
            <dt className="shrink-0 text-on-surface-variant">{t('audit.detail.action')}</dt>
            <dd className="min-w-0 break-all text-right font-mono text-label-sm text-on-surface-variant">{row.action}</dd>
          </div>
        </dl>

        {diff && (
          <section aria-label={t('audit.detail.diff')}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              {t('audit.detail.diff')}
            </h3>
            {diff.length === 0 ? (
              <p className="text-sm text-on-surface-variant">{t('audit.detail.noChanges')}</p>
            ) : (
              <ul className="space-y-1.5 rounded-lg border border-outline-variant/60 bg-surface-container-low/60 p-2.5">
                {diff.map((eintrag) => (
                  <li key={eintrag.key} className="text-xs">
                    <code className="font-mono text-on-surface-variant">
                      {t(`audit.detailKeys.${eintrag.key}`, { defaultValue: eintrag.key })}
                    </code>
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-status-destructive/90 line-through">
                        − {detailWert(eintrag.key, eintrag.vorher)}
                      </span>
                      <span className="font-mono text-status-success">
                        + {detailWert(eintrag.key, eintrag.nachher)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section aria-label={t('audit.detail.details')}>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
              {t('audit.detail.details')}
            </h3>
            <Kurzinfo text={t('audit.detail.copy')} seite="ende">
              <button
                type="button"
                onClick={() => void detailsKopieren()}
                aria-label={t('audit.detail.copy')}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface max-sm:min-h-11"
              >
                {kopiert ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                <span className="max-sm:sr-only">{t(kopiert ? 'audit.detail.copied' : 'audit.detail.copy')}</span>
              </button>
            </Kurzinfo>
          </div>
          {!row.details ? (
            <p className="text-sm text-on-surface-variant">{t('audit.detail.noDetails')}</p>
          ) : paare.length > 0 ? (
            <ul className="space-y-1.5">
              {paare.map(([key, wert]) => (
                <li key={key} className="flex items-start justify-between gap-3 rounded-lg border border-outline-variant/50 bg-surface-container-low/50 px-2.5 py-1.5 text-xs">
                  <span className="shrink-0 text-on-surface-variant">
                    {t(`audit.detailKeys.${key}`, { defaultValue: key })}
                  </span>
                  <span className="min-w-0 break-words text-right font-mono text-on-surface">
                    {detailWert(key, wert)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-outline-variant/50 bg-surface-container-low/50 p-2.5 font-mono text-xs text-on-surface-variant">
              {row.details}
            </pre>
          )}
        </section>
      </div>
    </div>
  )
}
