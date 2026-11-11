/**
 * Moderner Glassmorphismus-Dialog für die In-Browser-Übersetzung.
 *
 * Präsentiert Sprachenwahl, Zustimmungsdialog für Modelle, fließende Ladefortschritte
 * und automatische Domain-Übersetzung nach Maunting Design-DNA Richtlinien.
 */
import { useMemo } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  Languages,
  Loader2,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Checkbox, Dropdown, ProgressBar } from '@maunting/ui'
import { formatBytes } from '@/lib/format'

import { useUebersetzung, type Eintrag } from './ablauf'
import { extrahiereDomain, useUebersetzungDomainStore } from './domainStore'
import { quellen, weg, ziele } from './modelle'

export function Leisteninhalt({ tab, e }: { tab: string; e: Eintrag }) {
  const { t, i18n } = useTranslation()
  const { waehlen, starten, original, schliessen } = useUebersetzung.getState()

  const domain = useMemo(() => extrahiereDomain(e.url), [e.url])
  const domainEintrag = useUebersetzungDomainStore((s) => s.domains[domain])
  const istAuto = domainEintrag?.auto ?? false

  const autoSchalten = (auto: boolean) => {
    if (domain) {
      useUebersetzungDomainStore.getState().merkeDomain(e.url, `${e.von}-${e.nach}`, auto)
    }
  }

  const namen = useMemo(() => new Intl.DisplayNames([i18n.language], { type: 'language' }), [i18n.language])
  const name = (s: string) => {
    if (!s) return ''
    try {
      return namen.of(s) ?? s
    } catch {
      return s
    }
  }

  const renderKopf = (untertitel?: string) => (
    <div className="flex items-center justify-between gap-3 border-b border-outline-variant/20 pb-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary border border-primary/20">
          <Languages className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-body-sm font-semibold text-on-surface truncate">
            {t('browser.uebersetzung.name')}
          </h3>
          {domain && (
            <p className="flex items-center gap-1 text-label-sm text-on-surface-variant truncate">
              <Globe className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{untertitel || domain}</span>
            </p>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => schliessen(tab)}
        aria-label={t('browser.uebersetzung.schliessen')}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-container-highest/60 hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface transition-all active:scale-95"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  )

  const huelle = (inhalt: React.ReactNode, untertitel?: string) => (
    <div
      role="region"
      aria-label={t('browser.uebersetzung.name')}
      className="w-[22rem] sm:w-[26rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-outline-variant/30 bg-surface-container-high/95 backdrop-blur-2xl p-4 shadow-2xl text-on-surface flex flex-col gap-3 select-none"
    >
      {renderKopf(untertitel)}
      {inhalt}
    </div>
  )

  switch (e.stand.art) {
    case 'erkennen':
      return huelle(
        <div className="flex items-center gap-3 py-3 text-body-sm text-on-surface-variant">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          <span>{t('browser.uebersetzung.erkennen')}</span>
        </div>,
      )

    case 'laden': {
      const { geladen, gesamt } = e.stand
      const prozent = gesamt ? Math.round((geladen / gesamt) * 100) : 0
      return huelle(
        <div className="flex flex-col gap-2.5 py-1">
          <div className="flex items-center justify-between text-body-sm">
            <span className="font-medium text-on-surface">
              {t('browser.uebersetzung.laden', { geladen: formatBytes(geladen), gesamt: formatBytes(gesamt) })}
            </span>
            <span className="font-semibold text-primary">{prozent}%</span>
          </div>
          <ProgressBar
            value={prozent}
            ariaLabel={t('browser.uebersetzung.ladenName')}
            className="w-full h-2 rounded-full overflow-hidden"
          />
          <div className="flex justify-between text-label-sm text-on-surface-variant">
            <span>{formatBytes(geladen)}</span>
            <span>{formatBytes(gesamt)}</span>
          </div>
        </div>,
      )
    }

    case 'uebersetzen':
      return huelle(
        <div className="flex items-center gap-3 py-3 text-body-sm text-on-surface">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden="true" />
          <span>{t('browser.uebersetzung.laeuft', { count: e.stand.texte })}</span>
        </div>,
      )

    case 'fertig':
      return huelle(
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-primary/10 border border-primary/20 p-2.5 text-body-sm font-medium text-primary">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">
              {t('browser.uebersetzung.fertig', { von: name(e.von), nach: name(e.nach) })}
            </span>
          </div>
          {domain && (
            <label className="flex items-center gap-2.5 cursor-pointer text-body-sm text-on-surface-variant hover:text-on-surface transition-colors">
              <Checkbox checked={istAuto} onCheckedChange={(check: boolean) => autoSchalten(check)} />
              <span className="truncate">
                {t('browser.uebersetzung.immerUebersetzen', { domain })}
              </span>
            </label>
          )}
          <div className="flex items-center justify-end gap-2 pt-1 border-t border-outline-variant/15">
            <Button size="sm" variant="ghost" onClick={() => void waehlen(tab, {})}>
              {t('browser.uebersetzung.andereSprache')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => original(tab)}>
              {t('browser.uebersetzung.original')}
            </Button>
          </div>
        </div>,
      )

    case 'fehler':
      return huelle(
        <div className="flex flex-col gap-3">
          <div className="flex items-start gap-2.5 rounded-xl bg-status-destructive/10 border border-status-destructive/20 p-2.5 text-body-sm text-status-destructive">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span className="leading-relaxed">
              {t(`browser.uebersetzung.fehler.${e.stand.grund}`)}
            </span>
          </div>
          <div className="flex justify-end pt-1">
            <Button size="sm" variant="secondary" onClick={() => void starten(tab)}>
              {t('common.retry')}
            </Button>
          </div>
        </div>,
      )

    case 'wahl': {
      const { fehlt, seitenSprache } = e.stand
      const moeglich = !!weg(e.von, e.nach)
      const text = !moeglich
        ? seitenSprache
          ? t('browser.uebersetzung.spracheNichtVerfuegbar', { sprache: name(seitenSprache) || seitenSprache })
          : e.von
            ? t('browser.uebersetzung.zielGleich')
            : t('browser.uebersetzung.spracheNichtErkannt')
        : fehlt
          ? t('browser.uebersetzung.zustimmung', { groesse: formatBytes(fehlt) })
          : t('browser.uebersetzung.bereit')

      const alleQuellSprachen = quellen(e.nach)
      const alleZielSprachen = ziele(e.von)

      return huelle(
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-on-surface-variant leading-relaxed">{text}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-label-sm text-on-surface-variant font-medium">
                {t('browser.uebersetzung.von')}
              </span>
              <Dropdown
                aria-label={t('browser.uebersetzung.von')}
                placeholder={t('browser.uebersetzung.vonLeer')}
                value={e.von || null}
                onChange={(von) => void waehlen(tab, { von: von || '' })}
                options={alleQuellSprachen.map((s) => ({ value: s, label: name(s) }))}
                searchable
              />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <span className="text-label-sm text-on-surface-variant font-medium">
                {t('browser.uebersetzung.nach')}
              </span>
              <Dropdown
                aria-label={t('browser.uebersetzung.nach')}
                value={e.nach}
                onChange={(nach) => void waehlen(tab, { nach })}
                options={alleZielSprachen.map((s) => ({ value: s, label: name(s) }))}
                searchable
              />
            </div>
          </div>
          {domain && moeglich && (
            <label className="flex items-center gap-2.5 cursor-pointer text-body-sm text-on-surface-variant hover:text-on-surface transition-colors mt-0.5">
              <Checkbox checked={istAuto} onCheckedChange={(check: boolean) => autoSchalten(check)} />
              <span className="truncate">
                {t('browser.uebersetzung.immerUebersetzen', { domain })}
              </span>
            </label>
          )}
          <div className="flex justify-end pt-1 border-t border-outline-variant/15">
            <Button size="sm" disabled={!moeglich} onClick={() => void starten(tab)}>
              {fehlt ? t('browser.uebersetzung.ladenUndUebersetzen') : t('browser.uebersetzung.uebersetzen')}
            </Button>
          </div>
        </div>,
      )
    }
  }
}
