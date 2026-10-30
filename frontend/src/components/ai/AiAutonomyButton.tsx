import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ShieldAlert, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { aiApi, type AiAutonomyGrant } from '@/api/ai'
import { SanitizedApiError } from '@/api/client'
import { Ankerfenster, Button, Dropdown, NumberStepper, Switch } from '@/Singra/UI'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'

const DEFAULT_BUDGET = 10
const PANEL_SCOPE = 'panel'

/**
 * Autonomer Modus als Schalter **im** Chat statt als Kasten daneben.
 *
 * Im Dokument bedeutet er: Aus = jede KI-Aenderung wird zuerst als Vorschau
 * angelegt und muss bestaetigt werden; An = sie wird direkt uebernommen.
 * Ausserhalb eines Dokuments entfernt er die Rueckfrage vor Aktionen, die
 * Dateien aendern, Server anlegen und Mods installieren koennen. Was er nicht
 * entfernt, steht im Hinweistext: Berechtigungen gelten unveraendert weiter,
 * und destruktive Aktionen bleiben immer bestaetigungspflichtig.
 */
export interface ServerOption {
  id: number
  name: string
}

export function AiAutonomyButton({
  servers,
  disabled = false,
  bereich = 'panel',
}: {
  servers: ServerOption[]
  disabled?: boolean
  /** `docs` blendet die Serverauswahl aus; die Freigabe gilt panelweit. */
  bereich?: 'panel' | 'docs'
}) {
  const { t } = useTranslation()
  const nurPanel = bereich === 'docs'
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<string>(PANEL_SCOPE)
  const [grants, setGrants] = useState<AiAutonomyGrant[]>([])
  const [budget, setBudget] = useState(DEFAULT_BUDGET)
  const [busy, setBusy] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  // Unser `Dropdown` und der `NumberStepper` sind Knopfgruppen, keine
  // `<select>`/`<input>`-Elemente. Ein umschliessendes `<label>` beschriftet
  // sie deshalb nicht, sondern leitet den Klick an das erste bedienbare Element
  // darin weiter — beim Stepper ist das der **Minus**-Knopf.
  const scopeId = useId()
  const budgetId = useId()

  const serverId = nurPanel || scope === PANEL_SCOPE ? null : Number(scope)
  const grant = grants.find((row) => row.server_id === serverId) ?? null
  const enabled = Boolean(grant?.enabled)
  // Fuer die Anzeige am Knopf zaehlt jede aktive Freigabe, nicht nur die
  // gerade im Panel ausgewaehlte. Im Dokument gilt nur die panelweite Zeile.
  const anyEnabled = nurPanel
    ? grants.some((row) => row.server_id === null && row.enabled)
    : grants.some((row) => row.enabled)

  const load = useCallback(async () => {
    try {
      setGrants(await aiApi.listAutonomyGrants())
    } catch {
      // Fehlende Freigaben sind der Normalfall; ein Ladefehler darf den Chat
      // nicht mit einer Fehlermeldung ueberziehen.
      setGrants([])
    }
  }, [])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    setBudget(grant?.max_actions_per_hour ?? DEFAULT_BUDGET)
  }, [grant])

  const save = async (nextEnabled: boolean, nextBudget: number) => {
    if (nextEnabled && !enabled) {
      const accepted = await confirm({
        title: t(nurPanel ? 'ai.autonomy.docsConfirmTitle' : 'ai.autonomy.confirmTitle'),
        message: t(
          nurPanel
            ? 'ai.autonomy.docsConfirmPanel'
            : serverId === null
              ? 'ai.autonomy.confirmPanel'
              : 'ai.autonomy.confirmServer',
        ),
        confirmText: t('ai.autonomy.enable'),
        danger: true,
      })
      if (!accepted) return
    }
    // Auch das **Aus**schalten fragt nach, seit die Freigabe mehr entscheidet
    // als „ohne Rueckfrage ausfuehren“: sie ist der Schalter, der die
    // Guardian-Engine die KI wecken laesst. Wer sie abschaltet, hat danach
    // Server, die nachts stehen bleiben, bis jemand hinsieht — das gehoert
    // gesagt, bevor es passiert, und nicht erst in der Stoerungsmeldung.
    if (!nextEnabled && enabled) {
      const accepted = await confirm({
        title: t(nurPanel ? 'ai.autonomy.docsDisableTitle' : 'ai.autonomy.disableTitle'),
        message: t(
          nurPanel
            ? 'ai.autonomy.docsDisablePanel'
            : serverId === null
              ? 'ai.autonomy.disablePanel'
              : 'ai.autonomy.disableServer',
        ),
        confirmText: t('ai.autonomy.disable'),
      })
      if (!accepted) return
    }
    setBusy(true)
    try {
      const saved = await aiApi.saveAutonomyGrant({
        server_id: serverId,
        enabled: nextEnabled,
        // Der Stunden-Deckel begrenzt Server-Vorschlaege. Fuer Dokumente
        // zaehlt nur der Schalter; ein alter Wert 0 darf das Einschalten
        // deshalb nicht ins Leere laufen lassen.
        max_actions_per_hour: nurPanel ? Math.max(nextBudget, 1) : nextBudget,
      })
      setGrants((current) => [
        ...current.filter((row) => row.server_id !== serverId),
        saved,
      ])
      toast.success(t('ai.autonomy.saved'))
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('ai.autonomy.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label={t('ai.autonomy.title')}
        className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          anyEnabled
            ? 'border-status-warning/50 bg-status-warning/10 text-status-warning'
            : 'border-outline-variant/40 text-on-surface-variant hover:text-on-surface'
        }`}
      >
        <Zap className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="hidden sm:inline">{t('ai.autonomy.short')}</span>
      </button>

      <Ankerfenster
        offen={open}
        onSchliessen={() => setOpen(false)}
        anker={triggerRef}
        label={t('ai.autonomy.title')}
        ausrichtung="ende"
        className="w-[min(20rem,calc(100vw-2rem))]"
      >
        <h3 className="text-sm font-semibold text-on-surface">{t('ai.autonomy.title')}</h3>
        <p className="mt-1 text-xs leading-5 text-on-surface-variant">
          {t(
            nurPanel
              ? 'ai.autonomy.docsDescription'
              : serverId === null
                ? 'ai.autonomy.descriptionPanel'
                : 'ai.autonomy.descriptionServer',
          )}
        </p>

        {!nurPanel && (
          <div className="mt-3 space-y-1.5">
            <label htmlFor={scopeId} className="block text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
              {t('ai.autonomy.scope')}
            </label>
            <Dropdown
              id={scopeId}
              value={scope}
              onChange={setScope}
              options={[
                { value: PANEL_SCOPE, label: t('ai.autonomy.scopePanel') },
                ...servers.map((server) => ({ value: String(server.id), label: server.name })),
              ]}
              disabled={busy}
              aria-label={t('ai.autonomy.scope')}
            />
          </div>
        )}

        <div className="mt-3 flex items-center justify-between gap-3">
          <span className="text-sm text-on-surface">{t('ai.autonomy.toggle')}</span>
          <Switch
            checked={enabled}
            disabled={busy}
            onCheckedChange={(next) => void save(next, budget)}
            aria-label={t('ai.autonomy.toggle')}
          />
        </div>

        {enabled && !nurPanel && (
          <div className="mt-3 space-y-2">
            <div>
              <label htmlFor={budgetId} className="mb-1 block text-xs text-on-surface-variant">
                {t('ai.autonomy.budget')}
              </label>
              <NumberStepper
                id={budgetId}
                value={budget}
                min={0}
                max={1000}
                step={1}
                disabled={busy}
                onValueChange={(next) => setBudget(Number(next) || 0)}
                aria-label={t('ai.autonomy.budget')}
              />
            </div>
            <p className="text-xs text-on-surface-variant">
              {t('ai.autonomy.budgetHint', { used: grant?.used_last_hour ?? 0 })}
            </p>
            <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={() => void save(true, budget)}>
              {t('ai.autonomy.save')}
            </Button>
          </div>
        )}

        {enabled && nurPanel && (
          <p className="mt-2 text-xs text-on-surface-variant">
            {t('ai.autonomy.docsBudgetHint')}
          </p>
        )}

        <p className="mt-3 flex gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 p-2.5 text-xs leading-5 text-status-warning">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {t(nurPanel ? 'ai.autonomy.docsBoundary' : 'ai.autonomy.boundary')}
        </p>
      </Ankerfenster>
    </>
  )
}
