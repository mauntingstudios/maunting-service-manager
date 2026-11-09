import { Brain, Check, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AiProviderAvailable, AiProviderModelOption } from '@/api/ai'
import { Blattmenue, Button } from '@maunting/ui'

/** Aus oder eine der Stufen; `{an: true, stufe: null}` heisst „denk nach“. */
export interface Denkwahl {
  an: boolean
  stufe: string | null
}

interface Props {
  offen: boolean
  onSchliessen: () => void
  anbieter: AiProviderAvailable[]
  anbieterId: number | null
  waehleAnbieter: (id: string) => void
  modelle: AiProviderModelOption[]
  gefilterteModelle: AiProviderModelOption[]
  suchbegriff: string
  onSuchbegriff: (wert: string) => void
  gewaehltesModell: string | null
  aktiverAnbieter?: AiProviderAvailable | null
  waehleModell: (modelId: string) => void
  aktiverMitModell?: { reasoning: boolean; efforts: string[]; can_disable: boolean } | null
  denken: Denkwahl
  waehleDenken: (wahl: Denkwahl) => void
}

/**
 * Schnellwahl von Provider, Modell und Denkstufe.
 *
 * Aus `AiChat` herausgezogen: der Block hing an vierzehn Zustandswerten und
 * machte die Datei unlesbar, ohne selbst Fachlogik zu tragen.
 */
export function AiModellBlatt({
  offen,
  onSchliessen,
  anbieter,
  anbieterId,
  waehleAnbieter,
  modelle,
  gefilterteModelle,
  suchbegriff,
  onSuchbegriff,
  gewaehltesModell,
  aktiverAnbieter,
  waehleModell,
  aktiverMitModell,
  denken,
  waehleDenken,
}: Props) {
  const { t } = useTranslation()

  return (
    <Blattmenue
      offen={offen}
      onSchliessen={onSchliessen}
      titel="KI-Provider & Modell wählen"
      className="bg-surface-container-high/95 backdrop-blur-2xl border border-outline-variant/30 text-on-surface shadow-2xl max-w-2xl mx-auto max-h-[90vh] overflow-y-auto"
    >
      <div className="p-4 sm:p-5 space-y-4">
        {anbieter.length > 1 && (
          <div className="space-y-1.5">
            <span className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Provider wählen
            </span>
            <div className="flex flex-wrap gap-1.5">
              {anbieter.map((p) => {
                const isActive = p.id === anbieterId
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      waehleAnbieter(String(p.id))
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all ${
                      isActive
                        ? 'border-primary/60 bg-primary/15 text-primary shadow-sm font-semibold'
                        : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                    }`}
                  >
                    <span>{p.name}</span>
                    {isActive && <Check className="w-3.5 h-3.5 text-primary" />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              Modelle ({aktiverAnbieter?.name || 'Ausgewählt'})
            </span>
            <span className="text-xs text-on-surface-variant">
              {modelle.length} {modelle.length === 1 ? 'Modell' : 'Modelle'}
            </span>
          </div>

          {modelle.length > 5 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-on-surface-variant" />
              <input
                type="text"
                value={suchbegriff}
                onChange={(e) => onSuchbegriff(e.target.value)}
                placeholder="Modell suchen..."
                className="w-full h-8 pl-8 pr-3 text-xs rounded-xl border border-outline-variant/30 bg-surface-container-low text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[min(56vh,480px)] overflow-y-auto pr-1">
            {gefilterteModelle.length === 0 ? (
              <div className="col-span-full p-4 text-center text-xs text-on-surface-variant rounded-xl border border-outline-variant/20 bg-surface-container-low/50">
                Kein passendes Modell gefunden.
              </div>
            ) : (
              gefilterteModelle.map((m) => {
                const isSelected = (gewaehltesModell || aktiverAnbieter?.default_model) === m.model_id
                const isDefault = aktiverAnbieter?.default_model === m.model_id
                return (
                  <button
                    key={m.model_id}
                    type="button"
                    onClick={() => {
                      waehleModell(m.model_id)
                    }}
                    className={`group relative flex flex-col justify-between gap-1.5 p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? 'border-primary/60 bg-primary/12 text-on-surface shadow-sm ring-1 ring-primary/30'
                        : 'border-outline-variant/25 bg-surface-container-low/60 hover:bg-surface-container hover:border-outline-variant/60 text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <span className="text-xs font-semibold text-on-surface truncate">
                        {m.name && m.name !== m.model_id ? m.name : m.model_id}
                      </span>
                      {isSelected ? (
                        <Check className="w-4 h-4 text-primary shrink-0" />
                      ) : isDefault ? (
                        <span className="text-label-sm font-medium px-1.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/25 shrink-0">
                          Standard
                        </span>
                      ) : null}
                    </div>
                    {m.name && m.name !== m.model_id && (
                      <p className="text-label-sm font-mono text-on-surface-variant/70 truncate">
                        {m.model_id}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                      {isDefault && isSelected && (
                        <span className="text-label-sm font-medium px-1.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/25">
                          Standard
                        </span>
                      )}
                      {m.reasoning && (
                        <span className="inline-flex items-center gap-1 text-label-sm text-primary font-medium">
                          <Brain className="w-3 h-3" />
                          <span>Denkmodell</span>
                        </span>
                      )}
                      {m.vision && (
                        <span className="inline-flex items-center gap-1 text-label-sm text-on-surface-variant">
                          <span>Sehen</span>
                        </span>
                      )}
                    </div>
                  </button>
                )
              })
            )}
          </div>

          {modelle.length <= 1 && (
            <p className="text-xs text-on-surface-variant/80 pt-1">
              Tipp: In den Server-Einstellungen unter <em>KI-Provider</em> können weitere Modelle für diesen Provider freigegeben oder „Alle Modelle erlauben“ aktiviert werden.
            </p>
          )}
        </div>

        {/* Denkstufe für das ausgewählte Modell */}
        {aktiverMitModell?.reasoning && (
          <div className="pt-3 border-t border-outline-variant/20 space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                <Brain className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                Denkstufe
              </span>
              <span className="text-label-sm text-on-surface-variant/75 truncate max-w-[170px]">
                {gewaehltesModell || aktiverAnbieter?.default_model}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {aktiverMitModell.can_disable && (
                <button
                  type="button"
                  onClick={() => waehleDenken({ an: false, stufe: null })}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
                    !denken.an
                      ? 'border-primary/60 bg-primary/15 text-primary font-semibold shadow-sm'
                      : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  Aus
                </button>
              )}
              {aktiverMitModell.efforts.length === 0 ? (
                <button
                  type="button"
                  onClick={() => waehleDenken({ an: true, stufe: null })}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
                    denken.an
                      ? 'border-primary/60 bg-primary/15 text-primary font-semibold shadow-sm'
                      : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                  }`}
                >
                  Aktiv
                </button>
              ) : (
                aktiverMitModell.efforts.map((stufe) => {
                  const isActive = denken.an && denken.stufe === stufe
                  return (
                    <button
                      key={stufe}
                      type="button"
                      onClick={() => waehleDenken({ an: true, stufe })}
                      className={`px-3 py-1.5 rounded-xl border text-xs font-medium transition-all ${
                        isActive
                          ? 'border-primary/60 bg-primary/15 text-primary font-semibold shadow-sm'
                          : 'border-outline-variant/30 bg-surface-container-low text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
                      }`}
                    >
                      {t(`ai.reasoning.levels.${stufe}`, { defaultValue: stufe })}
                    </button>
                  )
                })
              )}
            </div>
            <p className="text-label-sm text-on-surface-variant/65">
              Wird für dieses Modell gespeichert.
            </p>
          </div>
        )}

        <div className="pt-2 flex justify-end">
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={onSchliessen}
            className="w-full sm:w-auto text-xs"
          >
            Fertig
          </Button>
        </div>
      </div>
    </Blattmenue>
  )
}
