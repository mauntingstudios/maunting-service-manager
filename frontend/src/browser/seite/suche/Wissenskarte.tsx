import {
  Building2,
  Calendar,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Gamepad2,
  Globe,
  Info,
  Layers,
  MapPin,
  Monitor,
  Tag,
  User,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { WissensPanelDaten } from '../MsmSuche'
import { SuchBild } from '../SuchBild'
import { FormatierterText } from './FormatierterText'
import { istLogoOderGrafik } from './helfer'

interface Props {
  daten: WissensPanelDaten
  kompaktMobil?: boolean
  mobilOffen?: boolean
  onMobilToggle?: () => void
  onOeffnen: (url: string, neuerTab?: boolean) => void
  onThema?: (begriff: string) => void
}

function steckbriefIcon(label: string) {
  const k = label.toLowerCase()
  if (/genre|spielart/.test(k)) return Gamepad2
  if (/kategorie|typ|art\b|type/.test(k)) return Tag
  if (/entwickler|developer|studio|urheber|erfinder|autor/.test(k)) return Layers
  if (/plattform|platform|system|betriebssystem/.test(k)) return Monitor
  if (/herausgeber|publisher|verlag|unternehmen|hersteller|rechtsform/.test(k)) return Building2
  if (/sitz|ort|stadt|land|herkunft|hauptstadt|standort/.test(k)) return MapPin
  if (/veröffentlichung|veroeffentlichung|release|datum|gr(?:ü|ue)ndung|geboren|gestorben|erschienen/.test(k)) {
    return Calendar
  }
  if (/ceo|person|gr(?:ü|ue)nder|direktor|präsident|praesident|leitung/.test(k)) return User
  if (/web|url|sprache|language/.test(k)) return Globe
  return Info
}

/** Die Wissenskarte der rechten Spalte: Bild, Kurzbeschreibung, Eckdaten, Quelle, Verwandte Themen. */
export function Wissenskarte({
  daten,
  kompaktMobil = false,
  mobilOffen = false,
  onMobilToggle,
  onOeffnen,
  onThema,
}: Props) {
  const { t } = useTranslation()
  const artikel = daten.urls?.[0]
  const verwandte = (daten.verwandte ?? []).slice(0, 4)
  const istLogo = istLogoOderGrafik(daten.bild, `${daten.titel} ${daten.untertitel ?? ''}`)

  return (
    <div className="overflow-hidden rounded-2xl border border-outline-variant/40 bg-surface-container/75 backdrop-blur-xl shadow-[inset_0_1px_0_hsl(0_0%_100%/0.06),var(--mui-shadow-panel)]">
      {daten.bild && (
        <div className="relative overflow-hidden border-b border-outline-variant/25 bg-surface-container-high/30">
          {istLogo ? (
            <div className="flex h-36 w-full items-center justify-center p-4">
              <div className="flex h-full max-h-28 max-w-[220px] items-center justify-center rounded-xl border border-outline-variant/25 bg-surface-container-lowest/80 p-3 shadow-sm backdrop-blur-sm">
                <SuchBild
                  url={daten.bild}
                  alt={daten.titel}
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
          ) : (
            <div className="relative flex h-48 w-full items-center justify-center overflow-hidden bg-surface-container-high/60">
              <SuchBild
                url={daten.bild}
                alt=""
                priority="low"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-25 blur-lg scale-110"
              />
              <SuchBild
                url={daten.bild}
                alt={daten.titel}
                priority="high"
                className="relative z-10 max-h-48 w-auto max-w-full object-contain mx-auto"
              />
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface-container/90 to-transparent"
                aria-hidden="true"
              />
            </div>
          )}
        </div>
      )}

      <div className="p-4 sm:p-5">
        <h2 className="text-title-lg font-semibold tracking-tight text-on-surface">
          <FormatierterText text={daten.titel} />
        </h2>
        {daten.untertitel && (
          <p className="mt-0.5 text-label-md font-medium text-primary">
            <FormatierterText text={daten.untertitel} />
          </p>
        )}

        {kompaktMobil && (
          <button
            type="button"
            onClick={onMobilToggle}
            aria-expanded={mobilOffen}
            className="mt-3 flex w-full items-center justify-between rounded-lg py-1 text-label-sm font-medium text-primary"
          >
            <span>
              {t(mobilOffen ? 'browser.msmSuche.zusammenfassungEinklappen' : 'browser.msmSuche.steckbriefZeigen')}
            </span>
            {mobilOffen ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </button>
        )}

        <div className={`space-y-3.5 ${kompaktMobil && !mobilOffen ? 'hidden lg:block' : ''}`}>
          <p className="mt-2.5 text-body-sm leading-relaxed text-on-surface-variant">
            <FormatierterText text={daten.inhalt} />
          </p>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label-sm text-on-surface-variant">
            <span>{t('browser.msmSuche.wissenQuelle')}</span>
            {artikel && (
              <button
                type="button"
                onClick={(ev) => onOeffnen(artikel.url, ev.ctrlKey || ev.metaKey)}
                className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
              >
                <span>{t('browser.msmSuche.zurQuelle')}</span>
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </button>
            )}
          </div>

          {daten.attribute && daten.attribute.length > 0 && (
            <div className="space-y-1 border-t border-outline-variant/25 pt-3">
              <div className="pb-1 text-label-sm font-semibold uppercase tracking-wider text-on-surface-variant">
                {t('browser.msmSuche.steckbriefTitel')}
              </div>
              {daten.attribute.slice(0, 5).map((attr, idx) => {
                const Icon = steckbriefIcon(attr.label)
                return (
                  <div
                    key={`${attr.label}-${idx}`}
                    className="grid grid-cols-[7.75rem_1fr] items-start gap-2.5 border-b border-outline-variant/20 py-1.5 text-label-sm last:border-0"
                  >
                    <span className="flex items-center gap-1.5 font-medium text-on-surface-variant">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-primary/80" aria-hidden="true" />
                      <span className="truncate">{attr.label}</span>
                    </span>
                    <span className="font-medium text-on-surface">
                      <FormatierterText text={attr.value} />
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {verwandte.length > 0 && onThema && (
            <div className="border-t border-outline-variant/25 pt-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-label-md font-semibold text-on-surface">
                <Layers className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span>{t('browser.msmSuche.verwandteThemen')}</span>
              </div>
              <div className="flex flex-col divide-y divide-outline-variant/20">
                {verwandte.map((thema) => (
                  <button
                    key={thema}
                    type="button"
                    onClick={() => onThema(thema)}
                    className="group -mx-2 flex items-center justify-between gap-2 rounded-lg px-2 py-2 text-left text-body-sm font-medium text-on-surface transition-colors hover:bg-surface-container-high/55 hover:text-primary"
                  >
                    <span className="truncate">{thema}</span>
                    <ChevronRight
                      className="h-3.5 w-3.5 shrink-0 text-on-surface-variant transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
