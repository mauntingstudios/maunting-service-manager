import {
  Activity,
  AlertTriangle,
  Blocks,
  BookOpen,
  Bot,
  CalendarClock,
  ChevronDown,
  Database,
  Eye,
  FilePenLine,
  FileX,
  Globe,
  HardDriveDownload,
  HardDriveUpload,
  Mail,
  Network,
  Newspaper,
  Package,
  Plug,
  Power,
  ServerCog,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Users,
  Wrench,
} from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

import { aiApi, type AiActionProposal } from '@/api/ai'
import { SanitizedApiError } from '@/api/client'
import { Button } from '@maunting/ui'
import { SecretOnce } from '@/components/app/SecretOnce'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'

function previewText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Felder der Vorschau, die als Backend-gepruefte Tatsachen gerendert werden.
 *
 * Bewusst eine feste Auswahl statt Ausgabe des gesamten `preview`-Objekts,
 * damit im Bestaetigungsmoment nur relevante Server-/Rechte-/Diff-Fakten
 * erscheinen.
 */
const TATSACHEN: readonly string[] = [
  'name',
  'slug',
  'service_user',
  'webhook_url',
  'terminate_grace_days',
  'integration',
  'external_product_key',
  'game_type',
  'ram_limit_mb',
  'cpu_limit_percent',
  'disk_limit_gb',
  'node_id',
  'backup_interval_hours',
  'role',
  'role_permissions',
  'permissions',
  'ai_limits',
  'enabled',
  'blueprint_id',
  'blueprint_name',
  'startup_before',
  'startup_after',
  'image_after',
  'env_after',
  'source_id',
  'new_id',
  'overwrites_blueprint',
  'source_before',
  'source_after',
  'server_name',
  'collection_title',
  'mod_count',
  'mods',
  'queued_count',
  'skipped_count',
  'zugriff',
  'pfad',
  'zeilen_angefragt',
  'titel',
  'beschreibung',
  'aktion',
  'target_id',
  'quarantine_id',
  'snapshot_id',
  'publisher_hash',
  'recipient',
  'subject',
  'start_time',
  'end_time',
  'location',
  'calendar_id',
  'event_id',
  'memory_scope',
  'memory_keys',
  'skill_key',
  'scope_label',
  'mode_label',
  'source_url',
  'disable_always_active_key',
  'body_preview',
  'target_user',
  'team_name',
  'role_name',
  'server_grants_summary',
  'servers_updated',
  'permissions_after',
  'permissions_added',
  'permissions_removed',
  'role_users',
  'roles_after',
  'roles_added',
  'roles_removed',
  'vault_storage_gb_before',
  'vault_storage_gb_after',
  'database',
  'table',
  'destructive',
  'category',
  'summary',
  'related_game_type',
  'sources_count',
  'is_published',
]

function tatsachenZeilen(preview: Record<string, unknown>): [string, string][] {
  const zeilen: [string, string][] = []
  for (const key of TATSACHEN) {
    const wert = preview[key]
    if (wert === undefined || wert === null || wert === '') continue
    if (Array.isArray(wert)) {
      zeilen.push([key, wert.length ? wert.join(', ') : '—'])
    } else if (typeof wert === 'object') {
      const paare = Object.entries(wert as Record<string, unknown>).filter(
        ([, v]) => v !== null && v !== undefined,
      )
      if (paare.length) {
        zeilen.push([key, paare.map(([k, v]) => `${k}: ${String(v)}`).join(', ')])
      }
    } else {
      zeilen.push([key, String(wert)])
    }
  }
  return zeilen
}

/** Werkzeuge, die vor Ausführung eine explizite Sicherheitsrückfrage verlangen. */
const UNUMKEHRBAR: readonly string[] = [
  'propose_server_delete',
  'propose_backup_restore',
  'propose_server_blueprint_switch',
  'propose_server_lifecycle',
  'propose_file_delete',
  'propose_blueprint_delete',
  'propose_team_role_delete',
  'propose_team_member_remove',
]

const TOOL_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  propose_config_update: FilePenLine,
  propose_config_patch: FilePenLine,
  propose_config_set: FilePenLine,
  propose_backup: HardDriveDownload,
  propose_mod_install: Package,
  propose_mod_batch_install: Package,
  propose_mod_toggle: Package,
  propose_mod_delete: Trash2,
  propose_server_create: ServerCog,
  propose_server_lifecycle: Power,
  propose_server_delete: Trash2,
  propose_backup_restore: HardDriveUpload,
  propose_bind_ip_update: Network,
  propose_blueprint_change: Blocks,
  propose_blueprint_delete: Trash2,
  propose_server_blueprint_switch: Blocks,
  propose_hoster_integration: Plug,
  propose_hoster_product: Plug,
  propose_ai_tarif_role: ShieldCheck,
  propose_server_repair: Wrench,
  propose_guardian_tuning: SlidersHorizontal,
  propose_file_delete: FileX,
  propose_database_change: Database,
  read_database: Database,
  propose_task_set: CalendarClock,
  propose_task_delete: CalendarClock,
  propose_news_upsert: Newspaper,
  propose_skill_import: BookOpen,
  propose_restart_schedule_set: CalendarClock,
  propose_backup_schedule_set: CalendarClock,
  worker_start: Bot,
  worker_cancel: Bot,
  web_search: Globe,
  read_server_status: Activity,
  read_server_logs: Eye,
  read_config: FilePenLine,
  list_my_servers: ServerCog,
  desktop_artifact: Package,
  propose_email_send: Mail,
  propose_calendar_event_create: CalendarClock,
  propose_calendar_event_delete: Trash2,
  propose_user_server_permission: ShieldCheck,
  propose_role_set: ShieldCheck,
  propose_user_roles: ShieldCheck,
  propose_role_delete: Trash2,
  propose_team_create: Users,
  propose_team_role_set: ShieldCheck,
  propose_team_role_delete: Trash2,
  propose_team_member_roles: Users,
  propose_team_member_invite: Users,
  propose_team_member_remove: Trash2,
  propose_team_server_grants: ShieldCheck,
}

function stripTone(
  proposal: AiActionProposal,
  unumkehrbar: boolean,
): { container: string; icon: string } {
  if (proposal.status === 'failed' || proposal.error_code) {
    return {
      container: 'border-l-status-destructive bg-status-destructive/5',
      icon: 'text-status-destructive',
    }
  }
  if (proposal.autonomous) {
    return {
      container: 'border-l-primary/60 bg-surface-container/50',
      icon: 'text-primary',
    }
  }
  if (proposal.status === 'succeeded') {
    return {
      container: 'border-l-status-success bg-surface-container/45',
      icon: 'text-status-success',
    }
  }
  if (proposal.status === 'expired') {
    return {
      container: 'border-l-outline-variant bg-surface-container/35',
      icon: 'text-on-surface-variant',
    }
  }
  if (unumkehrbar) {
    return {
      container: 'border-l-status-destructive bg-status-destructive/5',
      icon: 'text-status-destructive',
    }
  }
  return {
    container: 'border-l-status-warning bg-status-warning/5',
    icon: 'text-status-warning',
  }
}

export function AiActionProposalCard({
  proposal,
  onChange,
}: {
  proposal: AiActionProposal
  onChange: (proposal: AiActionProposal) => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [geheimnisse, setGeheimnisse] = useState<{ label: string; value: string }[]>([])
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [diffOpen, setDiffOpen] = useState(false)

  const operation = previewText(proposal.preview.operation ?? proposal.preview.aktion)
  const path = previewText(proposal.preview.path)
  const diff = previewText(proposal.preview.diff)
  const tatsachen = tatsachenZeilen(proposal.preview as Record<string, unknown>)
  const unumkehrbar =
    UNUMKEHRBAR.includes(proposal.tool_name) || proposal.preview.destructive === true
  const Icon = TOOL_ICONS[proposal.tool_name] ?? Power
  const tone = stripTone(proposal, unumkehrbar)

  const reject = async () => {
    setBusy(true)
    try {
      const rejected = await aiApi.rejectAction(proposal.id)
      onChange(rejected)
      toast.success(t('ai.actions.rejectedToast'))
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('ai.actions.error'))
      void aiApi.getAction(proposal.id).then(onChange).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  const execute = async () => {
    if (unumkehrbar) {
      const message = [
        t(`ai.actions.tools.${proposal.tool_name}`),
        t(`ai.actions.confirm.${proposal.tool_name}`, { operation, path }),
        diff ? t('ai.actions.confirmDiffLines', { count: diff.split('\n').length }) : '',
        t('ai.actions.confirmProvenance'),
      ]
        .filter(Boolean)
        .join('\n\n')

      const accepted = await confirm({
        title: t(`ai.actions.tools.${proposal.tool_name}`, proposal.tool_name),
        message,
        confirmText: t('ai.actions.execute'),
        danger: true,
      })
      if (!accepted) return
    }
    setBusy(true)
    try {
      const confirmation = await aiApi.confirmAction(proposal.id)
      const executed = await aiApi.executeAction(proposal.id, confirmation.confirmation_token)
      onChange(executed.proposal)
      const frisch = (executed.result as { secrets?: { label: string; value: string }[] } | null)
        ?.secrets
      if (Array.isArray(frisch) && frisch.length) setGeheimnisse(frisch)
      toast.success(
        executed.proposal.status === 'executing'
          ? t('ai.actions.queued')
          : t('ai.actions.executed'),
      )
    } catch (error: unknown) {
      toast.error(error instanceof SanitizedApiError ? error.message : t('ai.actions.error'))
      void aiApi.getAction(proposal.id).then(onChange).catch(() => undefined)
    } finally {
      setBusy(false)
    }
  }

  const isProposed = proposal.status === 'proposed'
  const showBody = isProposed || detailsOpen
  const hasCollapsibleDetails =
    tatsachen.length > 0 ||
    Boolean(operation) ||
    Boolean(proposal.reason) ||
    Boolean(proposal.expected_effect) ||
    Boolean(diff)
  const showDiff = Boolean(diff) && (isProposed ? diffOpen : detailsOpen)

  return (
    <article
      className={`border-l-2 border-y border-r border-outline-variant/25 rounded-r-xl pl-3 pr-2.5 py-2 transition-colors ${tone.container}`}
      aria-label={t('ai.actions.title')}
    >
      {/* Kompakte Kopfzeile: Symbol, Titel, Zielpfad, Zustand & Aktionen */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <Icon className={`h-3.5 w-3.5 shrink-0 ${tone.icon}`} aria-hidden="true" />
          <h3 className="text-xs sm:text-sm font-semibold text-on-surface">
            {t(`ai.actions.tools.${proposal.tool_name}`, proposal.tool_name)}
          </h3>
          {path && (
            <span className="truncate max-w-xs font-mono text-xs text-on-surface-variant">
              {path}
            </span>
          )}
          {!isProposed && (
            <span className="rounded-full bg-surface-container-high/80 px-2 py-0.5 text-xs text-on-surface-variant">
              {t(`ai.actions.status.${proposal.status}`)}
            </span>
          )}
          {proposal.proposal_type === 'read' && (
            <span className="rounded-full bg-secondary/15 px-2 py-0.5 text-xs text-secondary">
              {t('ai.actions.type.read')}
            </span>
          )}
          {proposal.proposal_type === 'worker' && (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs text-primary">
              {t('ai.actions.type.worker')}
            </span>
          )}
          {proposal.autonomous && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              <Bot className="h-3 w-3" aria-hidden="true" />
              {t('ai.actions.autonomousBadge')}
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          {isProposed && diff && (
            <button
              type="button"
              onClick={() => setDiffOpen((prev) => !prev)}
              aria-expanded={diffOpen}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50 transition-colors"
            >
              <span>{diffOpen ? t('ai.actions.hideDiff') : t('ai.actions.showDiff')}</span>
              <ChevronDown
                className={`h-3 w-3 transition-transform ${diffOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          )}
          {!isProposed && hasCollapsibleDetails && (
            <button
              type="button"
              onClick={() => setDetailsOpen((prev) => !prev)}
              aria-expanded={detailsOpen}
              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50 transition-colors"
            >
              <span>{detailsOpen ? t('ai.actions.lessDetails') : t('ai.actions.details')}</span>
              <ChevronDown
                className={`h-3 w-3 transition-transform ${detailsOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>
          )}
          {isProposed && !proposal.autonomous && (
            <>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs"
                disabled={busy}
                onClick={() => void reject()}
              >
                {t('ai.actions.reject')}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 rounded-full px-2.5 text-xs"
                variant={unumkehrbar ? 'destructive' : 'primary'}
                disabled={busy}
                onClick={() => void execute()}
              >
                {busy ? t('ai.actions.executing') : t('ai.actions.execute')}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Fakten, Begründung & optionales Diff */}
      {showBody && (
        <div className="mt-1.5 space-y-1 pl-5">
          {operation && (
            <p className="text-xs text-on-surface-variant">
              {t('ai.actions.operation', { operation })}
            </p>
          )}
          {tatsachen.length > 0 && (
            <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xs">
              {tatsachen.map(([key, wert]) => (
                <div key={key} className="inline-flex items-baseline gap-1 min-w-0 max-w-full">
                  <dt className="text-on-surface-variant shrink-0">
                    {t(`ai.actions.fields.${key}`, key)}
                  </dt>
                  <dd className="break-words font-medium text-on-surface">{wert}</dd>
                </div>
              ))}
            </dl>
          )}
          {(proposal.reason || proposal.expected_effect) && (
            <div className="space-y-0.5 text-xs text-on-surface-variant leading-snug">
              {proposal.reason && (
                <p>
                  <span className="font-medium text-on-surface">{t('ai.actions.reasonLabel')}</span>{' '}
                  {proposal.reason}
                </p>
              )}
              {proposal.expected_effect && (
                <p>
                  <span className="font-medium text-on-surface">{t('ai.actions.effectLabel')}</span>{' '}
                  {proposal.expected_effect}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {showDiff && (
        <pre className="mt-1.5 ml-5 max-h-56 overflow-auto rounded-lg border border-outline-variant/35 bg-surface-container-lowest p-2 text-xs text-on-surface-variant font-mono leading-snug">
          {diff}
        </pre>
      )}

      {proposal.autonomous && (
        <p className="mt-1 pl-5 text-label-sm text-on-surface-variant">
          {t('ai.actions.autonomousHint')}
        </p>
      )}
      {proposal.error_code && (
        <p className="mt-1 pl-5 flex items-center gap-1 text-xs text-status-destructive">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
          {t('ai.actions.failed')}
        </p>
      )}

      {geheimnisse.map((geheimnis) => (
        <div key={geheimnis.label} className="mt-2 pl-5">
          <SecretOnce
            label={geheimnis.label}
            value={geheimnis.value}
            onDismiss={() =>
              setGeheimnisse((rest) =>
                rest.filter((eintrag) => eintrag.label !== geheimnis.label),
              )
            }
          />
        </div>
      ))}
    </article>
  )
}
