import { blobHerunterladen } from '@/lib/herunterladen'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Box,
  Check,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Download,
  Gamepad2,
  GitBranch,
  Globe,
  HardDrive,
  Info,
  Layers,
  Package,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Kurzinfo,
  NumberStepper,
  Spinner,
  Switch,
  TabBar,
  Textarea,
  type TabDef,
} from '@maunting/ui'
import { api } from '@/api/client'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import type { BlueprintListEntry } from '@/types'
import {
  changeBlueprintSource,
  createBlueprintDraft,
  getBlueprintCollision,
  normalizeBlueprintDraft,
  slugifyBlueprintName,
  validateBlueprintDraft,
  type BlueprintDraft,
  type BlueprintSourceType,
  type BlueprintValidationIssue,
  type GuardianApplicationProbeType,
  type GuardianDiagnosticParser,
} from './contract'
import {
  ConfigPatchEditor,
  EnvironmentEditor,
  Field,
  LinesField,
  ModIdResolversEditor,
  ModListTargetsEditor,
  PostInstallEditor,
  RecoveryPoliciesEditor,
  SeedFileEditor,
  SetupCommandsEditor,
  StartupProfilesEditor,
} from './BlueprintBuilderEditors'

export type BlueprintBuilderMode = 'create' | 'edit' | 'clone'

interface BlueprintBuilderProps {
  mode: BlueprintBuilderMode
  sourceId?: string
  entries: BlueprintListEntry[]
  onClose: () => void
  onSaved: () => Promise<void>
}

const sectionIds = ['basics', 'source', 'runtime', 'mods', 'guardian', 'review'] as const
type SectionId = (typeof sectionIds)[number]

function sectionForIssue(path: string): SectionId {
  if (path.startsWith('meta.')) return 'basics'
  if (path.startsWith('source.')) return 'source'
  if (path.startsWith('runtime.') || path.startsWith('ports') || path === 'paths') return 'runtime'
  if (path.startsWith('mods.') || path.startsWith('backup.')) return 'mods'
  if (
    path.startsWith('health') ||
    path.startsWith('logs') ||
    path.startsWith('diagnostics') ||
    path.startsWith('recovery') ||
    path.startsWith('backups')
  ) {
    return 'guardian'
  }
  return 'review'
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
  ariaLabel,
}: {
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel?: string
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-outline-variant/45 bg-surface-container-low/55 px-3.5 py-3 transition-colors hover:border-outline-variant/75">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-on-surface">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-on-surface-variant">{description}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} aria-label={ariaLabel ?? label} />
    </label>
  )
}

function CollapsibleSection({
  heading,
  hint,
  defaultOpen = false,
  children,
}: {
  heading: string
  hint?: string
  defaultOpen?: boolean
  children: ReactNode
}) {
  return (
    <details open={defaultOpen} className="group min-w-0 rounded-xl border border-outline-variant/45 bg-surface-container-low/40 p-3.5">
      <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-on-surface">
        <span>{heading}</span>
        <span className="text-xs font-normal text-primary group-open:hidden">+</span>
        <span className="hidden text-xs font-normal text-primary group-open:inline">−</span>
      </summary>
      {hint && <p className="msm-field-help mt-1">{hint}</p>}
      <div className="mt-4 space-y-4 border-t border-outline-variant/35 pt-4">{children}</div>
    </details>
  )
}

export function BlueprintBuilder({ mode, sourceId, entries, onClose, onSaved }: BlueprintBuilderProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<BlueprintDraft>(() => createBlueprintDraft())
  const [section, setSection] = useState<SectionId>('basics')
  const [environmentIssues, setEnvironmentIssues] = useState<BlueprintValidationIssue[]>([])
  const [loading, setLoading] = useState(mode !== 'create')
  const [saving, setSaving] = useState(false)
  const [idManuallyEdited, setIdManuallyEdited] = useState(mode !== 'create')
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const [copiedJson, setCopiedJson] = useState(false)
  const scrollAreaRef = useRef<HTMLDivElement>(null)

  const markTouched = (path: string) => {
    setTouched(prev => {
      if (prev.has(path)) return prev
      const next = new Set(prev)
      next.add(path)
      return next
    })
  }

  useEffect(() => {
    if (mode === 'create' || !sourceId) return
    let active = true
    setLoading(true)
    api<BlueprintDraft>(`/blueprints/${encodeURIComponent(sourceId)}`)
      .then(value => {
        if (!active) return
        const next = structuredClone(value)
        next.runtime.seedFiles = next.runtime.seedFiles ?? []
        next.runtime.configPatches = next.runtime.configPatches ?? []
        next.runtime.ensureDirs = next.runtime.ensureDirs ?? []
        next.runtime.requiredFiles = next.runtime.requiredFiles ?? []
        next.runtime.startupProfiles = next.runtime.startupProfiles ?? []
        next.runtime.env = next.runtime.env ?? {}
        if (mode === 'clone') {
          next.meta.id = ''
          next.meta.name = t('blueprintBuilder.cloneName', { name: next.meta.name })
          setIdManuallyEdited(false)
        } else {
          setIdManuallyEdited(true)
        }
        setDraft(next)
      })
      .catch(() => toast.error(t('blueprintBuilder.loadFailed')))
      .finally(() => active && setLoading(false))

    return () => {
      active = false
    }
  }, [mode, sourceId, t])

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTop = 0
    }
  }, [section])

  const normalized = useMemo(() => normalizeBlueprintDraft(draft), [draft])
  const issues = useMemo(
    () => [...validateBlueprintDraft(normalized), ...environmentIssues],
    [environmentIssues, normalized],
  )

  const showErrors = submitAttempted || section === 'review'
  const issueFor = (path: string) => {
    if (!showErrors && !touched.has(path)) return undefined
    const issue = issues.find(current => current.path === path)
    return issue ? t(issue.key, issue.values) : undefined
  }

  const currentIndex = sectionIds.indexOf(section)
  const title = t(`blueprintBuilder.title.${mode}`)
  const dialogDescription = t(`blueprintBuilder.description.${mode}`)

  const sectionTabs: TabDef<SectionId>[] = [
    { id: 'basics', label: t('blueprintBuilder.sections.basics'), icon: Info },
    { id: 'source', label: t('blueprintBuilder.sections.source'), icon: Package },
    { id: 'runtime', label: t('blueprintBuilder.sections.runtime'), icon: Play },
    { id: 'mods', label: t('blueprintBuilder.sections.mods'), icon: Layers },
    { id: 'guardian', label: t('blueprintBuilder.sections.guardian'), icon: ShieldCheck },
    {
      id: 'review',
      label: t('blueprintBuilder.sections.review'),
      icon: Check,
      badge: showErrors && issues.length > 0 ? issues.length : undefined,
    },
  ]

  const updateSourceType = (type: BlueprintSourceType) => setDraft(current => changeBlueprintSource(current, type))

  const downloadDraft = () => {
    const blob = new Blob([`${JSON.stringify(normalized, null, 2)}\n`], { type: 'application/json' })
    blobHerunterladen(blob, `${draft.meta.id || 'msm-blueprint'}.blueprint.json`)
  }

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(normalized, null, 2))
      setCopiedJson(true)
      window.setTimeout(() => setCopiedJson(false), 1500)
    } catch {
      // Clipboard optional
    }
  }

  const appendStartupToken = (token: string) => {
    setDraft(current => {
      const prefix = current.runtime.startup.trimEnd()
      const nextStartup = prefix ? `${prefix} ${token}` : token
      return { ...current, runtime: { ...current.runtime, startup: nextStartup } }
    })
  }

  const saveDraft = async () => {
    setSubmitAttempted(true)
    if (issues.length) {
      setSection('review')
      return
    }
    const collision = getBlueprintCollision(entries, normalized.meta.id, mode === 'edit')
    if (collision === 'native-blocked') {
      toast.error(t('blueprintBuilder.collision.native'))
      setSection('basics')
      return
    }
    if (collision === 'community-confirm') {
      const approved = await confirm({
        title: t('blueprintBuilder.collision.title'),
        message: t('blueprintBuilder.collision.message', { id: normalized.meta.id }),
        confirmText: t('blueprintBuilder.collision.confirm'),
        danger: true,
      })
      if (!approved) return
    }
    setSaving(true)
    try {
      await api<{ id: string }>('/blueprints/import', {
        method: 'POST',
        body: JSON.stringify(normalized),
      })
      toast.success(t(mode === 'edit' ? 'blueprintBuilder.saved' : 'blueprintBuilder.added'))
      await onSaved()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('blueprintBuilder.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const categoryOptions = [
    { value: 'steam_game', label: t('blueprintBuilder.options.category.steamGame') },
    { value: 'non_steam_game', label: t('blueprintBuilder.options.category.nonSteamGame') },
    { value: 'voice_server', label: t('blueprintBuilder.options.category.voiceServer') },
    { value: 'bot', label: t('blueprintBuilder.options.category.bot') },
    { value: 'web_app', label: t('blueprintBuilder.options.category.webApp') },
    { value: 'frontend', label: t('blueprintBuilder.options.category.frontend') },
    { value: 'backend', label: t('blueprintBuilder.options.category.backend') },
    { value: 'database', label: t('blueprintBuilder.options.category.database') },
  ]

  const sourceOptions: Array<{
    type: BlueprintSourceType
    icon: typeof Gamepad2
    title: string
    hint: string
  }> = [
    { type: 'steam', icon: Gamepad2, title: 'Steam', hint: t('blueprintBuilder.sourceCards.steam') },
    { type: 'http', icon: Globe, title: t('blueprintBuilder.options.source.http'), hint: t('blueprintBuilder.sourceCards.http') },
    { type: 'github', icon: GitBranch, title: 'GitHub', hint: t('blueprintBuilder.sourceCards.github') },
    { type: 'dockerOnly', icon: Box, title: t('blueprintBuilder.options.source.dockerOnly'), hint: t('blueprintBuilder.sourceCards.dockerOnly') },
    { type: 'manualUpload', icon: Upload, title: t('blueprintBuilder.options.source.manualUpload'), hint: t('blueprintBuilder.sourceCards.manualUpload') },
    { type: 'custom', icon: Wrench, title: t('blueprintBuilder.options.source.custom'), hint: t('blueprintBuilder.sourceCards.custom') },
  ]

  const renderBasics = () => (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bp-name" label={t('blueprintBuilder.fields.name.label')} help={t('blueprintBuilder.fields.name.help')} error={issueFor('meta.name')}>
          <Input
            autoFocus
            placeholder={t('blueprintBuilder.fields.name.placeholder')}
            className="text-base sm:text-sm"
            value={draft.meta.name}
            onBlur={() => markTouched('meta.name')}
            onChange={event => {
              const name = event.target.value
              setDraft(current => ({
                ...current,
                meta: {
                  ...current.meta,
                  name,
                  id: !idManuallyEdited && mode !== 'edit' ? slugifyBlueprintName(name) : current.meta.id,
                },
              }))
            }}
          />
        </Field>
        <Field id="bp-category" label={t('blueprintBuilder.fields.category.label')} help={t('blueprintBuilder.fields.category.help')}>
          <Dropdown
            aria-label={t('blueprintBuilder.fields.category.label')}
            value={draft.meta.category}
            onChange={value => setDraft({ ...draft, meta: { ...draft.meta, category: value as BlueprintDraft['meta']['category'] } })}
            options={categoryOptions}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bp-id" label={t('blueprintBuilder.fields.id.label')} help={t('blueprintBuilder.fields.id.help')} error={issueFor('meta.id')}>
          <Input
            disabled={mode === 'edit'}
            placeholder="mein_server"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="font-mono text-base sm:text-xs"
            value={draft.meta.id}
            onBlur={() => markTouched('meta.id')}
            onChange={event => {
              setIdManuallyEdited(true)
              setDraft({ ...draft, meta: { ...draft.meta, id: event.target.value } })
            }}
          />
        </Field>
        <Field id="bp-author" label={t('blueprintBuilder.fields.author.label')} help={t('blueprintBuilder.fields.author.help')}>
          <Input
            maxLength={128}
            placeholder={t('blueprintBuilder.fields.author.placeholder')}
            className="text-base sm:text-sm"
            value={draft.meta.author ?? ''}
            onChange={event => setDraft({ ...draft, meta: { ...draft.meta, author: event.target.value } })}
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="bp-game" label={t('blueprintBuilder.fields.game.label')} help={t('blueprintBuilder.fields.game.help')}>
          <Input
            maxLength={128}
            placeholder={t('blueprintBuilder.fields.game.placeholder')}
            className="text-base sm:text-sm"
            value={draft.meta.game ?? ''}
            onChange={event => setDraft({ ...draft, meta: { ...draft.meta, game: event.target.value } })}
          />
        </Field>
        <Field id="bp-edition" label={t('blueprintBuilder.fields.edition.label')} help={t('blueprintBuilder.fields.edition.help')}>
          <Input
            maxLength={128}
            placeholder={t('blueprintBuilder.fields.edition.placeholder')}
            className="text-base sm:text-sm"
            value={draft.meta.edition ?? ''}
            onChange={event => setDraft({ ...draft, meta: { ...draft.meta, edition: event.target.value } })}
          />
        </Field>
      </div>

      <Field id="bp-description" label={t('blueprintBuilder.fields.description.label')} help={t('blueprintBuilder.fields.description.help')}>
        <Textarea
          rows={3}
          maxLength={1024}
          placeholder={t('blueprintBuilder.fields.description.placeholder')}
          className="text-base sm:text-sm"
          value={draft.meta.description ?? ''}
          onChange={event => setDraft({ ...draft, meta: { ...draft.meta, description: event.target.value } })}
        />
      </Field>
    </div>
  )

  const renderSource = () => (
    <div className="space-y-5">
      <div className="space-y-2">
        <span className="block text-sm font-medium text-on-surface">{t('blueprintBuilder.fields.source.label')}</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('blueprintBuilder.fields.source.label')}>
          {sourceOptions.map(option => {
            const Icon = option.icon
            const selected = draft.source.type === option.type
            return (
              <button
                key={option.type}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => updateSourceType(option.type)}
                className={`flex min-h-16 flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all ${
                  selected
                    ? 'border-primary bg-primary/10 text-on-surface ring-1 ring-primary/30'
                    : 'border-outline-variant/50 bg-surface-container-low/50 text-on-surface-variant hover:border-outline-variant hover:bg-surface-container-high/40'
                }`}
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold text-on-surface">
                  <Icon className={`h-4 w-4 shrink-0 ${selected ? 'text-primary' : 'text-on-surface-variant'}`} aria-hidden="true" />
                  {option.title}
                </span>
                <span className="text-xs leading-snug text-on-surface-variant">{option.hint}</span>
              </button>
            )
          })}
        </div>
      </div>

      <Field id="bp-update" label={t('blueprintBuilder.fields.update.label')} help={t('blueprintBuilder.fields.update.help')}>
        <Dropdown
          aria-label={t('blueprintBuilder.fields.update.label')}
          value={draft.source.updateStrategy}
          onChange={value => setDraft({ ...draft, source: { ...draft.source, updateStrategy: value as BlueprintDraft['source']['updateStrategy'] } })}
          options={[
            { value: 'checkBased', label: t('blueprintBuilder.options.update.checkBased') },
            { value: 'alwaysValidate', label: t('blueprintBuilder.options.update.alwaysValidate') },
            { value: 'none', label: t('blueprintBuilder.options.update.none') },
          ]}
        />
      </Field>

      {draft.source.steam && (
        <div className="space-y-4 rounded-xl border border-outline-variant/45 bg-surface-container-low/45 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="bp-appid" label={t('blueprintBuilder.fields.appId.label')} help={t('blueprintBuilder.fields.appId.help')} error={issueFor('source.steam.appId')}>
              <Input
                inputMode="numeric"
                placeholder="223350"
                className="font-mono text-base sm:text-xs"
                value={draft.source.steam.appId}
                onBlur={() => markTouched('source.steam.appId')}
                onChange={event => setDraft({ ...draft, source: { ...draft.source, steam: { ...draft.source.steam!, appId: event.target.value } } })}
              />
            </Field>
            <Field id="bp-artworkappid" label={t('blueprintBuilder.fields.artworkAppId.label')} help={t('blueprintBuilder.fields.artworkAppId.help')} error={issueFor('source.steam.artworkAppId')}>
              <Input
                inputMode="numeric"
                placeholder="108600"
                className="font-mono text-base sm:text-xs"
                value={draft.source.steam.artworkAppId ?? ''}
                onBlur={() => markTouched('source.steam.artworkAppId')}
                onChange={event => setDraft({ ...draft, source: { ...draft.source, steam: { ...draft.source.steam!, artworkAppId: event.target.value } } })}
              />
            </Field>
            <Field id="bp-platform" label={t('blueprintBuilder.fields.platform.label')} help={t('blueprintBuilder.fields.platform.help')}>
              <Dropdown
                aria-label={t('blueprintBuilder.fields.platform.label')}
                value={draft.source.steam.platform}
                onChange={value => setDraft({ ...draft, source: { ...draft.source, steam: { ...draft.source.steam!, platform: value as 'linux' | 'windows', compatibility: value === 'windows' ? 'proton' : 'native' } } })}
                options={[
                  { value: 'linux', label: t('blueprintBuilder.options.platform.linux') },
                  { value: 'windows', label: t('blueprintBuilder.options.platform.windows') },
                ]}
              />
            </Field>
            <Field id="bp-compat" label={t('blueprintBuilder.fields.compatibility.label')} help={t('blueprintBuilder.fields.compatibility.help')} error={issueFor('source.steam.compatibility')}>
              <Dropdown
                aria-label={t('blueprintBuilder.fields.compatibility.label')}
                value={draft.source.steam.compatibility ?? ''}
                onChange={value => setDraft({ ...draft, source: { ...draft.source, steam: { ...draft.source.steam!, compatibility: value as 'native' | 'wine' | 'proton' } } })}
                options={[
                  { value: 'native', label: t('blueprintBuilder.options.compatibility.native') },
                  { value: 'wine', label: 'Wine' },
                  { value: 'proton', label: 'Proton' },
                ]}
              />
            </Field>
            <Field id="bp-steam-branch" label={t('blueprintBuilder.fields.steamBranch.label')} help={t('blueprintBuilder.fields.steamBranch.help')}>
              <Input
                placeholder="public"
                className="font-mono text-base sm:text-xs"
                value={draft.source.steam.branch ?? ''}
                onChange={event => setDraft({ ...draft, source: { ...draft.source, steam: { ...draft.source.steam!, branch: event.target.value } } })}
              />
            </Field>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <ToggleRow
              label={t('blueprintBuilder.steam.requiresLogin')}
              checked={draft.source.steam.requiresLogin}
              onCheckedChange={gesetzt => setDraft({ ...draft, source: { ...draft.source, steam: { ...draft.source.steam!, requiresLogin: gesetzt } } })}
            />
            <ToggleRow
              label={t('blueprintBuilder.steam.validate')}
              checked={draft.source.steam.validate}
              onCheckedChange={gesetzt => setDraft({ ...draft, source: { ...draft.source, steam: { ...draft.source.steam!, validate: gesetzt } } })}
            />
          </div>
        </div>
      )}

      {draft.source.http && (
        <div className="space-y-4 rounded-xl border border-outline-variant/45 bg-surface-container-low/45 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="bp-url" label={t('blueprintBuilder.fields.url.label')} help={t('blueprintBuilder.fields.url.help')} error={issueFor('source.http.url')}>
              <Input
                type="url"
                placeholder="https://example.com/server.zip"
                className="text-base sm:text-sm"
                value={draft.source.http.url}
                onBlur={() => markTouched('source.http.url')}
                onChange={event => setDraft({ ...draft, source: { ...draft.source, http: { ...draft.source.http!, url: event.target.value } } })}
              />
            </Field>
            <Field id="bp-archive" label={t('blueprintBuilder.fields.archive.label')} help={t('blueprintBuilder.fields.archive.help')}>
              <Dropdown
                aria-label={t('blueprintBuilder.fields.archive.label')}
                value={draft.source.http.archiveType ?? ''}
                onChange={value => setDraft({ ...draft, source: { ...draft.source, http: { ...draft.source.http!, archiveType: (value || undefined) as NonNullable<BlueprintDraft['source']['http']>['archiveType'] } } })}
                placeholder={t('blueprintBuilder.options.archiveAuto')}
                options={['zip', 'tar.gz', 'tgz', 'tar.xz', 'txz', 'tar.bz2', 'tbz2', '7z'].map(value => ({ value, label: value }))}
              />
            </Field>
          </div>
          <CollapsibleSection heading={t('blueprintBuilder.advancedOptions')} defaultOpen={Boolean(draft.source.http.extractTo || draft.source.http.sha256)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="bp-extract" label={t('blueprintBuilder.fields.extract.label')} help={t('blueprintBuilder.fields.extract.help')}>
                <Input placeholder="." className="font-mono text-base sm:text-xs" value={draft.source.http.extractTo ?? ''} onChange={event => setDraft({ ...draft, source: { ...draft.source, http: { ...draft.source.http!, extractTo: event.target.value } } })} />
              </Field>
              <Field id="bp-sha" label={t('blueprintBuilder.fields.sha.label')} help={t('blueprintBuilder.fields.sha.help')} error={issueFor('source.http.sha256')}>
                <Input maxLength={64} className="font-mono text-base sm:text-xs" value={draft.source.http.sha256 ?? ''} onBlur={() => markTouched('source.http.sha256')} onChange={event => setDraft({ ...draft, source: { ...draft.source, http: { ...draft.source.http!, sha256: event.target.value } } })} />
              </Field>
            </div>
          </CollapsibleSection>
        </div>
      )}

      {draft.source.github && (
        <div className="space-y-4 rounded-xl border border-outline-variant/45 bg-surface-container-low/45 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="bp-repo" label={t('blueprintBuilder.fields.repo.label')} help={t('blueprintBuilder.fields.repo.help')} error={issueFor('source.github.repo')}>
              <Input
                placeholder="owner/repository"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="font-mono text-base sm:text-xs"
                value={draft.source.github.repo}
                onBlur={() => markTouched('source.github.repo')}
                onChange={event => setDraft({ ...draft, source: { ...draft.source, github: { ...draft.source.github!, repo: event.target.value } } })}
              />
            </Field>
            <Field id="bp-branch" label={t('blueprintBuilder.fields.branch.label')} help={t('blueprintBuilder.fields.branch.help')}>
              <Input placeholder="main" className="font-mono text-base sm:text-xs" value={draft.source.github.branch} onChange={event => setDraft({ ...draft, source: { ...draft.source, github: { ...draft.source.github!, branch: event.target.value } } })} />
            </Field>
          </div>
          <CollapsibleSection heading={t('blueprintBuilder.advancedOptions')} defaultOpen={Boolean(draft.source.github.subPath || draft.source.github.setupCommands.length)}>
            <Field id="bp-subpath" label={t('blueprintBuilder.fields.subPath.label')} help={t('blueprintBuilder.fields.subPath.help')} error={issueFor('source.github.subPath')}>
              <Input placeholder="apps/bot" className="font-mono text-base sm:text-xs" value={draft.source.github.subPath ?? ''} onBlur={() => markTouched('source.github.subPath')} onChange={event => setDraft({ ...draft, source: { ...draft.source, github: { ...draft.source.github!, subPath: event.target.value } } })} />
            </Field>
            <SetupCommandsEditor value={draft.source.github.setupCommands} onChange={setupCommands => setDraft({ ...draft, source: { ...draft.source, github: { ...draft.source.github!, setupCommands } } })} />
          </CollapsibleSection>
        </div>
      )}

      {draft.source.manual && (
        <div className="space-y-4 rounded-xl border border-outline-variant/45 bg-surface-container-low/45 p-4">
          <LinesField id="bp-manual-files" label={t('blueprintBuilder.fields.manualFiles.label')} help={t('blueprintBuilder.fields.manualFiles.help')} error={issueFor('source.manual.requiredFiles')} value={draft.source.manual.requiredFiles} onChange={requiredFiles => { markTouched('source.manual.requiredFiles'); setDraft({ ...draft, source: { ...draft.source, manual: { ...draft.source.manual!, requiredFiles } } }) }} />
          <Field id="bp-manual-instructions" label={t('blueprintBuilder.fields.instructions.label')} help={t('blueprintBuilder.fields.instructions.help')} error={issueFor('source.manual.instructions')}>
            <Textarea rows={3} className="text-base sm:text-sm" value={draft.source.manual.instructions} onBlur={() => markTouched('source.manual.instructions')} onChange={event => setDraft({ ...draft, source: { ...draft.source, manual: { ...draft.source.manual!, instructions: event.target.value } } })} />
          </Field>
          <Field id="bp-manual-url" label={t('blueprintBuilder.fields.instructionsUrl.label')} help={t('blueprintBuilder.fields.instructionsUrl.help')}>
            <Input type="url" placeholder="https://..." className="text-base sm:text-sm" value={draft.source.manual.instructionsUrl ?? ''} onChange={event => setDraft({ ...draft, source: { ...draft.source, manual: { ...draft.source.manual!, instructionsUrl: event.target.value } } })} />
          </Field>
        </div>
      )}
    </div>
  )

  const portRoleOptions = ['game', 'query', 'rcon', 'voice', 'web', 'peer', 'database', 'custom'].map(value => ({
    value,
    label: t(`blueprintBuilder.options.port.${value}`),
  }))

  const renderRuntime = () => (
    <div className="space-y-5">
      <Field id="bp-image" label={t('blueprintBuilder.fields.image.label')} help={t('blueprintBuilder.fields.image.help')} error={issueFor('runtime.image')}>
        <Input
          placeholder="ubuntu:24.04"
          className="font-mono text-base sm:text-xs"
          value={draft.runtime.image}
          onBlur={() => markTouched('runtime.image')}
          onChange={event => setDraft({ ...draft, runtime: { ...draft.runtime, image: event.target.value } })}
        />
      </Field>

      <div className="space-y-2">
        <Field id="bp-startup" label={t('blueprintBuilder.fields.startup.label')} help={t('blueprintBuilder.fields.startup.help')} error={issueFor('runtime.startup')}>
          <Textarea
            mono
            rows={2}
            placeholder="./start-server --port {GAME_PORT}"
            className="min-h-20 text-base sm:text-xs"
            value={draft.runtime.startup}
            onBlur={() => markTouched('runtime.startup')}
            onChange={event => setDraft({ ...draft, runtime: { ...draft.runtime, startup: event.target.value } })}
          />
        </Field>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-on-surface-variant">{t('blueprintBuilder.insertToken')}:</span>
          {['{GAME_PORT}', '{WEB_PORT}', '{SERVER_NAME}', '{INSTALL_DIR}', '{MOD_ARG}'].map(token => (
            <button
              key={token}
              type="button"
              onClick={() => appendStartupToken(token)}
              className="rounded-md border border-outline-variant/50 bg-surface-container-high/60 px-2 py-1 font-mono text-xs text-primary transition-colors hover:bg-primary/10"
            >
              {token}
            </button>
          ))}
        </div>
      </div>

      {/* Ports directly inside Start & Ports */}
      <div className="space-y-3 rounded-xl border border-outline-variant/45 bg-surface-container-low/45 p-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.sections.ports')}</h4>
            <p className="msm-field-help mt-0.5">{t('blueprintBuilder.ports.help')}</p>
          </div>
          <Button type="button" variant="secondary" size="sm" className="min-h-10 shrink-0" onClick={() => setDraft({ ...draft, ports: [...draft.ports, { name: 'custom', protocol: 'tcp' }] })}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('blueprintBuilder.ports.add')}
          </Button>
        </div>
        {draft.ports.length > 0 && (
          <div className="space-y-2">
            {draft.ports.map((port, index) => (
              <div key={index} className="grid grid-cols-[1fr_6.5rem_auto] items-center gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-lowest/60 p-2">
                <Dropdown
                  aria-label={t('blueprintBuilder.ports.roleLabel', { index: index + 1 })}
                  value={port.name}
                  onChange={value => setDraft({ ...draft, ports: draft.ports.map((item, itemIndex) => itemIndex === index ? { ...item, name: value as typeof item.name } : item) })}
                  options={portRoleOptions}
                />
                <Dropdown
                  aria-label={t('blueprintBuilder.ports.protocolLabel', { index: index + 1 })}
                  value={port.protocol}
                  onChange={value => setDraft({ ...draft, ports: draft.ports.map((item, itemIndex) => itemIndex === index ? { ...item, protocol: value as typeof item.protocol } : item) })}
                  options={[{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }]}
                />
                <Button type="button" variant="ghost" size="icon" className="min-h-10 min-w-10" aria-label={t('blueprintBuilder.ports.removeLabel', { index: index + 1 })} onClick={() => setDraft({ ...draft, ports: draft.ports.filter((_, itemIndex) => itemIndex !== index) })}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <CollapsibleSection
        heading={t('blueprintBuilder.advancedOptions')}
        hint={t('blueprintBuilder.advancedRuntimeHint')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="bp-workdir" label={t('blueprintBuilder.fields.workdir.label')} help={t('blueprintBuilder.fields.workdir.help')} error={issueFor('runtime.workdir')}>
            <Input placeholder="/data" className="font-mono text-base sm:text-xs" value={draft.runtime.workdir ?? ''} onBlur={() => markTouched('runtime.workdir')} onChange={event => setDraft({ ...draft, runtime: { ...draft.runtime, workdir: event.target.value } })} />
          </Field>
          <Field id="bp-user" label={t('blueprintBuilder.fields.user.label')} help={t('blueprintBuilder.fields.user.help')} error={issueFor('runtime.user')}>
            <Input placeholder="1000:1000" className="font-mono text-base sm:text-xs" value={draft.runtime.user ?? ''} onBlur={() => markTouched('runtime.user')} onChange={event => setDraft({ ...draft, runtime: { ...draft.runtime, user: event.target.value } })} />
          </Field>
          <Field id="bp-stop-grace" label={t('blueprintBuilder.fields.stopGrace.label')} help={t('blueprintBuilder.fields.stopGrace.help')} error={issueFor('runtime.stopGracePeriodSeconds')}>
            <NumberStepper min={5} max={600} value={draft.runtime.stopGracePeriodSeconds} onValueChange={value => setDraft({ ...draft, runtime: { ...draft.runtime, stopGracePeriodSeconds: Number(value) } })} />
          </Field>
          <Field id="bp-start-check" label={t('blueprintBuilder.fields.startCheck.label')} help={t('blueprintBuilder.fields.startCheck.help')} error={issueFor('runtime.startupCheckSeconds')}>
            <NumberStepper min={0} max={300} value={draft.runtime.startupCheckSeconds} onValueChange={value => setDraft({ ...draft, runtime: { ...draft.runtime, startupCheckSeconds: Number(value) } })} />
          </Field>
        </div>

        <div className="space-y-2.5">
          <ToggleRow
            label={t('blueprintBuilder.exec.title')}
            description={t('blueprintBuilder.exec.help')}
            checked={draft.runtime.enableExec}
            onCheckedChange={gesetzt => setDraft({ ...draft, runtime: { ...draft.runtime, enableExec: gesetzt } })}
          />
          {draft.runtime.enableExec && (
            <Field id="bp-exec-timeout" label={t('blueprintBuilder.fields.execTimeout.label')} help={t('blueprintBuilder.fields.execTimeout.help')} error={issueFor('runtime.execTimeoutSeconds')}>
              <NumberStepper min={1} max={600} value={draft.runtime.execTimeoutSeconds} onValueChange={value => setDraft({ ...draft, runtime: { ...draft.runtime, execTimeoutSeconds: Number(value) } })} />
            </Field>
          )}
          <ToggleRow
            label={t('blueprintBuilder.runtimeFlags.allowTmpfsExec')}
            description={t('blueprintBuilder.runtimeFlags.allowTmpfsExecHelp')}
            checked={draft.runtime.allowTmpfsExec ?? true}
            onCheckedChange={gesetzt => setDraft({ ...draft, runtime: { ...draft.runtime, allowTmpfsExec: gesetzt } })}
          />
          <ToggleRow
            label={t('blueprintBuilder.runtimeFlags.allowUserns')}
            description={t('blueprintBuilder.runtimeFlags.allowUsernsHelp')}
            checked={draft.runtime.allowUnprivilegedUserNamespaces ?? false}
            onCheckedChange={gesetzt => setDraft({ ...draft, runtime: { ...draft.runtime, allowUnprivilegedUserNamespaces: gesetzt } })}
          />
        </div>

        <EnvironmentEditor
          key={`${mode}:${sourceId ?? 'new'}:${loading}`}
          value={draft.runtime.env}
          onChange={env => setDraft(current => ({ ...current, runtime: { ...current.runtime, env } }))}
          onIssuesChange={setEnvironmentIssues}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <LinesField id="bp-dirs" label={t('blueprintBuilder.fields.dirs.label')} help={t('blueprintBuilder.fields.dirs.help')} error={issueFor('runtime.ensureDirs')} value={draft.runtime.ensureDirs} onChange={ensureDirs => setDraft({ ...draft, runtime: { ...draft.runtime, ensureDirs } })} />
          <LinesField id="bp-files" label={t('blueprintBuilder.fields.files.label')} help={t('blueprintBuilder.fields.files.help')} error={issueFor('runtime.requiredFiles')} value={draft.runtime.requiredFiles} onChange={requiredFiles => setDraft({ ...draft, runtime: { ...draft.runtime, requiredFiles } })} />
        </div>

        <StartupProfilesEditor value={draft.runtime.startupProfiles} onChange={startupProfiles => setDraft({ ...draft, runtime: { ...draft.runtime, startupProfiles } })} />
        <SeedFileEditor value={draft.runtime.seedFiles ?? []} onChange={seedFiles => setDraft({ ...draft, runtime: { ...draft.runtime, seedFiles } })} />
        <ConfigPatchEditor value={draft.runtime.configPatches} onChange={configPatches => setDraft({ ...draft, runtime: { ...draft.runtime, configPatches } })} />
      </CollapsibleSection>
    </div>
  )

  const renderModsAndBackup = () => {
    const mods = draft.mods ?? createBlueprintDraft().mods!
    const updateMods = (patch: Partial<NonNullable<BlueprintDraft['mods']>>) =>
      setDraft(current => ({ ...current, mods: { ...(current.mods ?? mods), ...patch } }))

    const hasAdvancedMods = Boolean(
      mods.postInstall.length || mods.modIdResolvers?.length || mods.modListTargets?.length || mods.filterTags.length,
    )

    return (
      <div className="space-y-5">
        <ToggleRow
          label={t('blueprintBuilder.mods.supportsMods')}
          description={t('blueprintBuilder.mods.supportsModsHelp')}
          checked={mods.supportsMods}
          onCheckedChange={gesetzt => updateMods({ supportsMods: gesetzt })}
        />

        {(mods.supportsMods || mods.supportsSteamWorkshop || mods.supportsCurseForge) && (
          <div className="space-y-4 rounded-xl border border-outline-variant/45 bg-surface-container-low/45 p-4">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <ToggleRow
                label={t('blueprintBuilder.mods.supportsWorkshop')}
                checked={mods.supportsSteamWorkshop}
                onCheckedChange={gesetzt => updateMods({ supportsSteamWorkshop: gesetzt })}
              />
              <ToggleRow
                label={t('blueprintBuilder.mods.supportsCurseForge')}
                checked={mods.supportsCurseForge ?? false}
                onCheckedChange={gesetzt => updateMods({ supportsCurseForge: gesetzt })}
              />
            </div>

            {mods.supportsSteamWorkshop && (
              <Field id="bp-workshop-id" label={t('blueprintBuilder.fields.workshopId.label')} help={t('blueprintBuilder.fields.workshopId.help')} error={issueFor('mods.workshopAppId')}>
                <Input inputMode="numeric" placeholder="108600" className="font-mono text-base sm:text-xs" value={mods.workshopAppId ?? ''} onBlur={() => markTouched('mods.workshopAppId')} onChange={event => updateMods({ workshopAppId: event.target.value })} />
              </Field>
            )}

            {mods.supportsCurseForge && (
              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="bp-cf-game-id" label={t('blueprintBuilder.fields.curseforgeGameId.label')} help={t('blueprintBuilder.fields.curseforgeGameId.help')} error={issueFor('mods.curseforgeGameId')}>
                  <Input inputMode="numeric" placeholder="432" className="font-mono text-base sm:text-xs" value={mods.curseforgeGameId ?? ''} onBlur={() => markTouched('mods.curseforgeGameId')} onChange={event => updateMods({ curseforgeGameId: event.target.value })} />
                </Field>
                <Field id="bp-cf-class-id" label={t('blueprintBuilder.fields.curseforgeClassId.label')} help={t('blueprintBuilder.fields.curseforgeClassId.help')} error={issueFor('mods.curseforgeClassId')}>
                  <Input inputMode="numeric" placeholder="6" className="font-mono text-base sm:text-xs" value={mods.curseforgeClassId ?? ''} onBlur={() => markTouched('mods.curseforgeClassId')} onChange={event => updateMods({ curseforgeClassId: event.target.value })} />
                </Field>
                <Field id="bp-cf-install-path" label={t('blueprintBuilder.fields.curseforgeInstallPath.label')} help={t('blueprintBuilder.fields.curseforgeInstallPath.help')} error={issueFor('mods.curseforgeInstallPath')}>
                  <Input placeholder="mods" className="font-mono text-base sm:text-xs" value={mods.curseforgeInstallPath ?? ''} onBlur={() => markTouched('mods.curseforgeInstallPath')} onChange={event => updateMods({ curseforgeInstallPath: event.target.value })} />
                </Field>
              </div>
            )}

            <Field id="bp-injection" label={t('blueprintBuilder.fields.injection.label')} help={t('blueprintBuilder.fields.injection.help')}>
              <Dropdown
                aria-label={t('blueprintBuilder.fields.injection.label')}
                value={mods.modInjection}
                options={[
                  { value: 'none', label: t('blueprintBuilder.options.injection.none') },
                  { value: 'startupArg', label: t('blueprintBuilder.options.injection.startupArg') },
                  { value: 'file', label: t('blueprintBuilder.options.injection.file') },
                ]}
                onChange={value => updateMods({ modInjection: value as NonNullable<BlueprintDraft['mods']>['modInjection'] })}
              />
            </Field>

            {mods.modInjection === 'startupArg' && (
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <Field id="bp-mod-format" label={t('blueprintBuilder.fields.modFormat.label')} help={t('blueprintBuilder.fields.modFormat.help')} error={issueFor('mods.modStartupArgumentFormat')}>
                  <Input placeholder="-mods={mods}" className="font-mono text-base sm:text-xs" value={mods.modStartupArgumentFormat ?? ''} onBlur={() => markTouched('mods.modStartupArgumentFormat')} onChange={event => updateMods({ modStartupArgumentFormat: event.target.value })} />
                </Field>
                <Field id="bp-mod-sep" label={t('blueprintBuilder.fields.modSeparator.label')} help={t('blueprintBuilder.fields.modSeparator.help')}>
                  <Input placeholder=";" className="font-mono text-base sm:text-xs" value={mods.modStartupArgumentSeparator ?? ';'} onChange={event => updateMods({ modStartupArgumentSeparator: event.target.value })} />
                </Field>
              </div>
            )}

            {mods.modInjection === 'file' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="bp-mod-file" label={t('blueprintBuilder.fields.modFile.label')} help={t('blueprintBuilder.fields.modFile.help')} error={issueFor('mods.modListFilePath')}>
                  <Input placeholder="Server/modlist.txt" className="font-mono text-base sm:text-xs" value={mods.modListFilePath ?? ''} onBlur={() => markTouched('mods.modListFilePath')} onChange={event => updateMods({ modListFilePath: event.target.value })} />
                </Field>
                <Field id="bp-mod-content" label={t('blueprintBuilder.fields.modContent.label')} help={t('blueprintBuilder.fields.modContent.help')}>
                  <Dropdown
                    aria-label={t('blueprintBuilder.fields.modContent.label')}
                    value={mods.modListContent}
                    options={[
                      { value: 'workshopIds', label: t('blueprintBuilder.options.modContent.workshopIds') },
                      { value: 'postInstallTargetBasenames', label: t('blueprintBuilder.options.modContent.targetNames') },
                      { value: 'iniKey', label: t('blueprintBuilder.options.modContent.iniKey') },
                    ]}
                    onChange={value => updateMods({ modListContent: value as NonNullable<BlueprintDraft['mods']>['modListContent'] })}
                  />
                </Field>
                {mods.modListContent === 'iniKey' && (
                  <>
                    <Field id="bp-mod-key" label={t('blueprintBuilder.fields.modListKey.label')} help={t('blueprintBuilder.fields.modListKey.help')} error={issueFor('mods.modListKey')}>
                      <Input placeholder="WorkshopItems" className="font-mono text-base sm:text-xs" value={mods.modListKey ?? ''} onBlur={() => markTouched('mods.modListKey')} onChange={event => updateMods({ modListKey: event.target.value })} />
                    </Field>
                    <Field id="bp-mod-list-sep" label={t('blueprintBuilder.fields.modListSeparator.label')} help={t('blueprintBuilder.fields.modListSeparator.help')} error={issueFor('mods.modListSeparator')}>
                      <Input placeholder=";" className="font-mono text-base sm:text-xs" value={mods.modListSeparator ?? ';'} onChange={event => updateMods({ modListSeparator: event.target.value })} />
                    </Field>
                  </>
                )}
              </div>
            )}

            <CollapsibleSection heading={t('blueprintBuilder.mods.advancedTitle')} defaultOpen={hasAdvancedMods}>
              <LinesField id="bp-filter-tags" label={t('blueprintBuilder.fields.filterTags.label')} help={t('blueprintBuilder.fields.filterTags.help')} rows={2} value={mods.filterTags} onChange={filterTags => updateMods({ filterTags })} />
              <PostInstallEditor value={mods.postInstall} onChange={postInstall => updateMods({ postInstall })} />
              <ModIdResolversEditor value={mods.modIdResolvers ?? []} onChange={modIdResolvers => updateMods({ modIdResolvers })} />
              <ModListTargetsEditor value={mods.modListTargets ?? []} onChange={modListTargets => updateMods({ modListTargets })} />
            </CollapsibleSection>
          </div>
        )}

        <div className="rounded-xl border border-outline-variant/45 bg-surface-container-low/45 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-on-surface">
            <HardDrive className="h-4 w-4 text-primary" aria-hidden="true" />
            <span>{t('blueprintBuilder.sections.backup')}</span>
          </div>
          <LinesField
            id="bp-backup"
            label={t('blueprintBuilder.fields.backup.label')}
            help={t('blueprintBuilder.fields.backup.help')}
            placeholder="Saved/Config&#10;Saved/SaveGames"
            value={draft.backup?.includePaths ?? []}
            onChange={includePaths => setDraft({ ...draft, backup: { includePaths } })}
          />
        </div>
      </div>
    )
  }

  const renderGuardian = () => {
    const defaults = createBlueprintDraft()
    const health = draft.health ?? defaults.health!
    const logs = draft.logs ?? defaults.logs!
    const diagnostics = draft.diagnostics ?? defaults.diagnostics!
    const recovery = draft.recovery ?? defaults.recovery!
    const backups = draft.backups ?? defaults.backups!
    const guardianEnabled = Boolean(draft.health || draft.logs || draft.diagnostics || draft.recovery || draft.backups)

    const setGuardianEnabled = (enabled: boolean) => {
      setDraft(current => {
        if (enabled) {
          return {
            ...current,
            health: structuredClone(defaults.health!),
            logs: structuredClone(defaults.logs!),
            diagnostics: structuredClone(defaults.diagnostics!),
            recovery: structuredClone(defaults.recovery!),
            backups: structuredClone(defaults.backups!),
          }
        }
        const next = { ...current }
        delete next.health
        delete next.logs
        delete next.diagnostics
        delete next.recovery
        delete next.backups
        return next
      })
    }

    const updateProcess = (next: Partial<NonNullable<BlueprintDraft['health']>['process']>) => {
      setDraft(current => ({
        ...current,
        health: {
          ...current.health,
          process: { ...(current.health?.process ?? defaults.health!.process!), ...next },
        },
      }))
    }
    const updatePortHealth = (next: Partial<NonNullable<BlueprintDraft['health']>['port']>) => {
      setDraft(current => ({
        ...current,
        health: {
          ...current.health,
          port: { ...(current.health?.port ?? defaults.health!.port!), ...next },
        },
      }))
    }
    const updateApplication = (next: Partial<NonNullable<BlueprintDraft['health']>['application']>) => {
      setDraft(current => ({
        ...current,
        health: {
          ...current.health,
          application: { ...(current.health?.application ?? defaults.health!.application!), ...next },
        },
      }))
    }
    const updateApplicationType = (type: GuardianApplicationProbeType | '') => {
      setDraft(current => {
        const application = { ...(current.health?.application ?? defaults.health!.application!), type }
        if (type !== 'http-ping') delete application.path
        return { ...current, health: { ...current.health, application } }
      })
    }
    const updateStartup = (next: Partial<NonNullable<BlueprintDraft['health']>['startup']>) => {
      setDraft(current => ({
        ...current,
        health: {
          ...current.health,
          startup: { ...(current.health?.startup ?? defaults.health!.startup!), ...next },
        },
      }))
    }

    const applyPreset = (presetId: string) => {
      if (presetId === 'minecraft') {
        setDraft(current => ({
          ...current,
          health: {
            process: { ...defaults.health!.process! },
            port: { ...defaults.health!.port!, protocol: 'tcp', port: '{{SERVER_PORT}}' },
            application: { ...defaults.health!.application!, type: 'minecraft-query', port: '{{SERVER_PORT}}' },
            startup: { ...defaults.health!.startup!, success_patterns: ['Done'], failure_patterns: ['Unable to access jarfile', 'Failed to bind to port'] },
          },
          logs: { ...defaults.logs!, sources: ['logs/latest.log'], redact: ['discord_token', 'api_key'] },
          diagnostics: { parsers: ['java-stacktrace', 'linux-oom', 'port-conflict', 'corrupted-config'] },
          recovery: {
            ...defaults.recovery!,
            policies: [{ match: 'port-conflict', action: 'restart' }, { match: 'linux-oom', action: 'graceful_restart' }],
          },
          backups: { before_risky_action: true, protected_paths: ['world/', 'plugins/', 'config/'] },
        }))
      } else if (presetId === 'steamcmd') {
        setDraft(current => ({
          ...current,
          health: {
            process: { ...defaults.health!.process! },
            port: { ...defaults.health!.port!, protocol: 'udp', port: '{{SERVER_PORT}}', timeout: '5s' },
            application: { ...defaults.health!.application!, type: 'source-query', interval: '60s', port: '{{SERVER_PORT}}' },
            startup: { ...defaults.health!.startup!, success_patterns: ['Connection to Steam servers successful', 'GC Connection established'], failure_patterns: ['Error checking out release', 'Failed to initialize network'] },
          },
          logs: { ...defaults.logs!, sources: ['logs/latest.log', 'stdout'], redact: ['api_key'] },
          diagnostics: { parsers: ['linux-oom', 'port-conflict', 'missing-runtime'] },
          recovery: {
            ...defaults.recovery!,
            policies: [{ match: 'port-conflict', action: 'restart' }, { match: 'linux-oom', action: 'graceful_restart' }],
          },
          backups: { before_risky_action: true, protected_paths: ['save/', 'config/'] },
        }))
      } else if (presetId === 'nodejs') {
        setDraft(current => ({
          ...current,
          health: {
            process: { ...defaults.health!.process! },
            port: { ...defaults.health!.port!, protocol: 'tcp', port: '{{SERVER_PORT}}' },
            application: { ...defaults.health!.application!, type: 'http-ping', path: '/api/healthz', port: '{{SERVER_PORT}}' },
            startup: { ...defaults.health!.startup!, success_patterns: ['App listening on port', 'Server started'], failure_patterns: ['npm ERR!', 'UnhandledPromiseRejectionWarning'] },
          },
          logs: { ...defaults.logs!, sources: ['stdout'], redact: ['discord_token', 'api_key', 'database_url'] },
          diagnostics: { parsers: ['linux-oom', 'port-conflict', 'nodejs-stacktrace'] },
          recovery: {
            ...defaults.recovery!,
            policies: [{ match: 'port-conflict', action: 'restart' }, { match: 'linux-oom', action: 'graceful_restart' }],
          },
          backups: { before_risky_action: true, protected_paths: ['data/'] },
        }))
      } else if (presetId === 'generic') {
        setGuardianEnabled(false)
      }
    }

    const appQueryOptions = [
      { value: '', label: t('blueprintBuilder.guardian.appQueryNone') },
      { value: 'tcp', label: 'TCP' },
      { value: 'minecraft-status', label: 'Minecraft Status' },
      { value: 'minecraft-query', label: 'Minecraft Query' },
      { value: 'source-query', label: 'Steam / Source Query' },
      { value: 'http-ping', label: 'HTTP Ping' },
    ]

    const selectedAppQuery = health.application?.type ?? ''

    return (
      <div className="min-w-0 max-w-full space-y-4">
        <ToggleRow
          label={t('blueprintBuilder.guardian.enabled')}
          description={t('blueprintBuilder.guardian.enabledHelp')}
          checked={guardianEnabled}
          onCheckedChange={setGuardianEnabled}
        />

        <div className="rounded-xl border border-primary/25 bg-primary/5 p-3.5 space-y-2.5">
          <div>
            <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.guardian.presetsTitle')}</h4>
            <p className="text-xs text-on-surface-variant">{t('blueprintBuilder.guardian.presetsHelp')}</p>
          </div>
          <Dropdown
            aria-label={t('blueprintBuilder.guardian.presetsSelect')}
            value={null}
            onChange={applyPreset}
            placeholder={t('blueprintBuilder.guardian.presetsSelect')}
            options={[
              { value: 'minecraft', label: 'Minecraft (Paper, Fabric, Forge)' },
              { value: 'steamcmd', label: 'SteamCMD Server (Palworld, Rust, Zomboid)' },
              { value: 'nodejs', label: 'Node.js (Discord Bots, Web Apps)' },
              { value: 'generic', label: t('blueprintBuilder.guardian.presetGeneric') },
            ]}
          />
        </div>

        {guardianEnabled && (
          <div className="space-y-4">
            <div className="space-y-4 rounded-xl border border-outline-variant/45 bg-surface-container-low/45 p-4">
              <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.guardian.healthTitle')}</h4>
              <div className="grid gap-2.5">
                <ToggleRow
                  label={t('blueprintBuilder.guardian.processEnabled')}
                  description={t('blueprintBuilder.guardian.processEnabledHelp')}
                  checked={Boolean(health.process)}
                  onCheckedChange={gesetzt => setDraft(current => {
                    if (gesetzt) {
                      return { ...current, health: { ...current.health, process: structuredClone(defaults.health!.process!) } }
                    }
                    const nextHealth = { ...current.health }
                    delete nextHealth.process
                    return { ...current, health: nextHealth }
                  })}
                />
                <ToggleRow
                  label={t('blueprintBuilder.guardian.processRequired')}
                  description={t('blueprintBuilder.guardian.processRequiredHelp')}
                  checked={health.process?.required ?? true}
                  disabled={!health.process}
                  onCheckedChange={gesetzt => updateProcess({ required: gesetzt })}
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field id="bp-health-port-proto" label={t('blueprintBuilder.fields.healthPortProto.label')} help={t('blueprintBuilder.fields.healthPortProto.help')}>
                  <Dropdown
                    aria-label={t('blueprintBuilder.fields.healthPortProto.label')}
                    value={health.port?.protocol ?? 'tcp'}
                    onChange={value => updatePortHealth({ protocol: value as 'tcp' | 'udp' })}
                    options={[{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }]}
                  />
                </Field>
                <Field id="bp-health-port" label={t('blueprintBuilder.fields.healthPort.label')} help={t('blueprintBuilder.fields.healthPort.help')} error={issueFor('health.port.port')}>
                  <Input className="font-mono text-base sm:text-xs" value={health.port?.port ?? ''} onBlur={() => markTouched('health.port.port')} onChange={event => updatePortHealth({ port: event.target.value })} />
                </Field>
                <Field id="bp-health-port-timeout" label={t('blueprintBuilder.fields.healthPortTimeout.label')} help={t('blueprintBuilder.fields.healthPortTimeout.help')} error={issueFor('health.port.timeout')}>
                  <Input className="font-mono text-base sm:text-xs" value={health.port?.timeout ?? ''} onBlur={() => markTouched('health.port.timeout')} onChange={event => updatePortHealth({ timeout: event.target.value })} />
                </Field>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-on-surface">
                    {t('blueprintBuilder.fields.healthAppType.label')}
                  </label>
                  <Dropdown
                    aria-label={t('blueprintBuilder.fields.healthAppType.label')}
                    value={selectedAppQuery}
                    options={appQueryOptions}
                    onChange={next => updateApplicationType(next as GuardianApplicationProbeType | '')}
                  />
                  <p className="msm-field-help">{t('blueprintBuilder.fields.healthAppType.help')}</p>
                </div>
                <Field id="bp-health-app-interval" label={t('blueprintBuilder.fields.healthAppInterval.label')} help={t('blueprintBuilder.fields.healthAppInterval.help')} error={issueFor('health.application.interval')}>
                  <Input className="font-mono text-base sm:text-xs" value={health.application?.interval ?? ''} onChange={event => updateApplication({ interval: event.target.value })} />
                </Field>
                <Field id="bp-health-app-threshold" label={t('blueprintBuilder.fields.healthAppThreshold.label')} help={t('blueprintBuilder.fields.healthAppThreshold.help')} error={issueFor('health.application.failure_threshold')}>
                  <NumberStepper min={1} max={20} value={health.application?.failure_threshold ?? 3} onValueChange={value => updateApplication({ failure_threshold: Number(value) })} />
                </Field>
              </div>

              {health.application?.type === 'http-ping' && (
                <Field id="bp-health-app-path" label={t('blueprintBuilder.fields.healthAppPath.label')} help={t('blueprintBuilder.fields.healthAppPath.help')} error={issueFor('health.application.path')}>
                  <Input placeholder="/healthz" className="font-mono text-base sm:text-xs" value={health.application?.path ?? ''} onBlur={() => markTouched('health.application.path')} onChange={event => updateApplication({ path: event.target.value })} />
                </Field>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <LinesField id="bp-health-success-patterns" label={t('blueprintBuilder.fields.healthSuccessPatterns.label')} help={t('blueprintBuilder.fields.healthSuccessPatterns.help')} rows={2} value={health.startup?.success_patterns ?? []} onChange={success_patterns => updateStartup({ success_patterns })} />
                <LinesField id="bp-health-failure-patterns" label={t('blueprintBuilder.fields.healthFailurePatterns.label')} help={t('blueprintBuilder.fields.healthFailurePatterns.help')} rows={2} value={health.startup?.failure_patterns ?? []} onChange={failure_patterns => updateStartup({ failure_patterns })} />
              </div>

              <CollapsibleSection heading={t('blueprintBuilder.guardian.advancedHealth')} hint={t('blueprintBuilder.guardian.advancedHealthHelp')}>
                <fieldset className="space-y-3">
                  <legend className="text-sm font-semibold">{t('blueprintBuilder.guardian.processProbe')}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="bp-process-id" label={t('blueprintBuilder.fields.guardianId.label')} help={t('blueprintBuilder.fields.guardianId.help')}>
                      <Input className="font-mono text-base sm:text-xs" value={health.process?.id ?? defaults.health!.process!.id} onChange={event => updateProcess({ id: event.target.value })} />
                    </Field>
                    <Field id="bp-process-interval" label={t('blueprintBuilder.fields.guardianInterval.label')} help={t('blueprintBuilder.fields.guardianInterval.help')}>
                      <Input className="font-mono text-base sm:text-xs" value={health.process?.interval ?? defaults.health!.process!.interval} onChange={event => updateProcess({ interval: event.target.value })} />
                    </Field>
                    <Field id="bp-process-failure" label={t('blueprintBuilder.fields.guardianFailureThreshold.label')} help={t('blueprintBuilder.fields.guardianFailureThreshold.help')}>
                      <NumberStepper min={1} max={20} value={health.process?.failure_threshold ?? 1} onValueChange={value => updateProcess({ failure_threshold: Number(value) })} />
                    </Field>
                    <Field id="bp-process-success" label={t('blueprintBuilder.fields.guardianSuccessThreshold.label')} help={t('blueprintBuilder.fields.guardianSuccessThreshold.help')}>
                      <NumberStepper min={1} max={20} value={health.process?.success_threshold ?? 1} onValueChange={value => updateProcess({ success_threshold: Number(value) })} />
                    </Field>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ToggleRow label={t('blueprintBuilder.fields.guardianRequiredStartup.label')} checked={health.process?.required_for_startup ?? true} onCheckedChange={gesetzt => updateProcess({ required_for_startup: gesetzt })} />
                    <ToggleRow label={t('blueprintBuilder.fields.guardianRequiredVerification.label')} checked={health.process?.required_for_verification ?? true} onCheckedChange={gesetzt => updateProcess({ required_for_verification: gesetzt })} />
                  </div>
                </fieldset>

                <fieldset className="space-y-3 border-t border-outline-variant/30 pt-4">
                  <legend className="text-sm font-semibold">{t('blueprintBuilder.guardian.portProbe')}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="bp-port-id" label={t('blueprintBuilder.fields.guardianId.label')}><Input className="font-mono text-base sm:text-xs" value={health.port?.id ?? defaults.health!.port!.id} onChange={event => updatePortHealth({ id: event.target.value })} /></Field>
                    <Field id="bp-port-interval" label={t('blueprintBuilder.fields.guardianInterval.label')}><Input className="font-mono text-base sm:text-xs" value={health.port?.interval ?? defaults.health!.port!.interval} onChange={event => updatePortHealth({ interval: event.target.value })} /></Field>
                    <Field id="bp-port-failure" label={t('blueprintBuilder.fields.guardianFailureThreshold.label')}><NumberStepper min={1} max={20} value={health.port?.failure_threshold ?? 3} onValueChange={value => updatePortHealth({ failure_threshold: Number(value) })} /></Field>
                    <Field id="bp-port-success" label={t('blueprintBuilder.fields.guardianSuccessThreshold.label')}><NumberStepper min={1} max={20} value={health.port?.success_threshold ?? 1} onValueChange={value => updatePortHealth({ success_threshold: Number(value) })} /></Field>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ToggleRow label={t('blueprintBuilder.fields.guardianRequiredStartup.label')} checked={health.port?.required_for_startup ?? false} onCheckedChange={gesetzt => updatePortHealth({ required_for_startup: gesetzt })} />
                    <ToggleRow label={t('blueprintBuilder.fields.guardianRequiredVerification.label')} checked={health.port?.required_for_verification ?? true} onCheckedChange={gesetzt => updatePortHealth({ required_for_verification: gesetzt })} />
                  </div>
                </fieldset>

                <fieldset className="space-y-3 border-t border-outline-variant/30 pt-4">
                  <legend className="text-sm font-semibold">{t('blueprintBuilder.guardian.applicationProbe')}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="bp-app-id" label={t('blueprintBuilder.fields.guardianId.label')}><Input className="font-mono text-base sm:text-xs" value={health.application?.id ?? defaults.health!.application!.id} onChange={event => updateApplication({ id: event.target.value })} /></Field>
                    <Field id="bp-health-app-port" label={t('blueprintBuilder.fields.healthAppPort.label')}><Input className="font-mono text-base sm:text-xs" value={health.application?.port ?? ''} onChange={event => updateApplication({ port: event.target.value })} /></Field>
                    <Field id="bp-app-timeout" label={t('blueprintBuilder.fields.guardianTimeout.label')}><Input className="font-mono text-base sm:text-xs" value={health.application?.timeout ?? defaults.health!.application!.timeout} onChange={event => updateApplication({ timeout: event.target.value })} /></Field>
                    <Field id="bp-app-success" label={t('blueprintBuilder.fields.guardianSuccessThreshold.label')}><NumberStepper min={1} max={20} value={health.application?.success_threshold ?? 1} onValueChange={value => updateApplication({ success_threshold: Number(value) })} /></Field>
                    <Field id="bp-app-statuses" label={t('blueprintBuilder.fields.healthExpectedStatuses.label')}><Input className="font-mono text-base sm:text-xs" value={(health.application?.expected_statuses ?? [200]).join(', ')} onChange={event => updateApplication({ expected_statuses: event.target.value.split(',').map(value => Number(value.trim())).filter(Number.isFinite) })} /></Field>
                    <Field id="bp-app-response-bytes" label={t('blueprintBuilder.fields.healthResponseBytes.label')}><NumberStepper min={1} max={1_048_576} value={health.application?.max_response_bytes ?? 4096} onValueChange={value => updateApplication({ max_response_bytes: Number(value) })} /></Field>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ToggleRow label={t('blueprintBuilder.fields.guardianRequiredStartup.label')} checked={health.application?.required_for_startup ?? false} onCheckedChange={gesetzt => updateApplication({ required_for_startup: gesetzt })} />
                    <ToggleRow label={t('blueprintBuilder.fields.guardianRequiredVerification.label')} checked={health.application?.required_for_verification ?? true} onCheckedChange={gesetzt => updateApplication({ required_for_verification: gesetzt })} />
                  </div>
                </fieldset>

                <fieldset className="space-y-3 border-t border-outline-variant/30 pt-4">
                  <legend className="text-sm font-semibold">{t('blueprintBuilder.guardian.startupWindow')}</legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id="bp-startup-grace" label={t('blueprintBuilder.fields.healthStartupGrace.label')} help={t('blueprintBuilder.fields.healthStartupGrace.help')}><NumberStepper min={0} max={600} value={health.startup?.grace_period_seconds ?? 30} onValueChange={value => updateStartup({ grace_period_seconds: Number(value) })} /></Field>
                    <Field id="bp-startup-timeout" label={t('blueprintBuilder.fields.healthStartupTimeout.label')} help={t('blueprintBuilder.fields.healthStartupTimeout.help')} error={issueFor('health.startup.timeout_seconds')}><NumberStepper min={1} max={3600} value={health.startup?.timeout_seconds ?? 300} onValueChange={value => updateStartup({ timeout_seconds: Number(value) })} /></Field>
                  </div>
                </fieldset>
              </CollapsibleSection>
            </div>

            <CollapsibleSection heading={t('blueprintBuilder.guardian.logsTitle')}>
              <div className="grid gap-4 sm:grid-cols-2">
                <LinesField id="bp-logs-sources" label={t('blueprintBuilder.fields.logsSources.label')} help={t('blueprintBuilder.fields.logsSources.help')} rows={2} value={logs.sources} onChange={sources => setDraft(current => ({ ...current, logs: { ...(current.logs ?? defaults.logs!), sources } }))} />
                <LinesField
                  id="bp-logs-redact"
                  label={t('blueprintBuilder.fields.logsRegexRedact.label')}
                  help={t('blueprintBuilder.fields.logsRegexRedact.help')}
                  rows={2}
                  value={logs.redact.filter(value => value.startsWith('regex:')).map(value => value.slice(6))}
                  onChange={patterns => setDraft(current => ({
                    ...current,
                    logs: {
                      ...(current.logs ?? defaults.logs!),
                      redact: [
                        ...(current.logs ?? defaults.logs!).redact.filter(value => !value.startsWith('regex:')),
                        ...patterns.map(value => `regex:${value}`),
                      ],
                    },
                  }))}
                />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-on-surface">{t('blueprintBuilder.fields.logsRedact.label')}</legend>
                <p className="msm-field-help">{t('blueprintBuilder.fields.logsRedact.help')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['discord_token', 'api_key', 'authorization_header', 'database_url', 'jwt'] as const).map(redactor => (
                    <ToggleRow
                      key={redactor}
                      label={redactor}
                      checked={logs.redact.includes(redactor)}
                      onCheckedChange={gesetzt => setDraft(current => {
                        const currentLogs = current.logs ?? defaults.logs!
                        return {
                          ...current,
                          logs: {
                            ...currentLogs,
                            redact: gesetzt ? [...currentLogs.redact, redactor] : currentLogs.redact.filter(value => value !== redactor),
                          },
                        }
                      })}
                    />
                  ))}
                </div>
              </fieldset>
              <Field id="bp-logs-max-tail" label={t('blueprintBuilder.fields.logsMaxTail.label')} help={t('blueprintBuilder.fields.logsMaxTail.help')} error={issueFor('logs.max_tail_bytes')}>
                <NumberStepper min={1024} max={1_048_576} value={logs.max_tail_bytes} onValueChange={value => setDraft(current => ({ ...current, logs: { ...(current.logs ?? defaults.logs!), max_tail_bytes: Number(value) } }))} />
              </Field>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-on-surface">{t('blueprintBuilder.fields.diagnosticsParsers.label')}</legend>
                <p className="msm-field-help">{t('blueprintBuilder.fields.diagnosticsParsers.help')}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['linux-oom', 'java-stacktrace', 'nodejs-stacktrace', 'port-conflict', 'missing-runtime', 'corrupted-config', 'startup-pattern'] as GuardianDiagnosticParser[]).map(parser => (
                    <ToggleRow
                      key={parser}
                      label={parser}
                      checked={diagnostics.parsers.includes(parser)}
                      onCheckedChange={gesetzt => setDraft(current => {
                        const currentDiagnostics = current.diagnostics ?? defaults.diagnostics!
                        return {
                          ...current,
                          diagnostics: {
                            ...currentDiagnostics,
                            parsers: gesetzt ? [...currentDiagnostics.parsers, parser] : currentDiagnostics.parsers.filter(value => value !== parser),
                          },
                        }
                      })}
                    />
                  ))}
                </div>
              </fieldset>
            </CollapsibleSection>

            <CollapsibleSection heading={t('blueprintBuilder.guardian.recoveryTitle')}>
              <RecoveryPoliciesEditor
                value={recovery.policies}
                onChange={policies => setDraft(current => ({ ...current, recovery: { ...(current.recovery ?? defaults.recovery!), policies } }))}
              />

              <div className="space-y-3 border-t border-outline-variant/35 pt-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h5 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.guardian.safeLockFiles')}</h5>
                    <p className="msm-field-help mt-0.5">{t('blueprintBuilder.guardian.safeLockFilesHelp')}</p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="min-h-10 shrink-0"
                    disabled={(recovery.safe_lock_files?.length ?? 0) >= 32}
                    onClick={() => setDraft(current => {
                      const currentRecovery = current.recovery ?? defaults.recovery!
                      return { ...current, recovery: { ...currentRecovery, safe_lock_files: [...(currentRecovery.safe_lock_files ?? []), { path: '', reason: '' }] } }
                    })}
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    {t('blueprintBuilder.guardian.addSafeLockFile')}
                  </Button>
                </div>
                {(recovery.safe_lock_files ?? []).map((entry, index) => (
                  <div key={index} className="grid gap-2 rounded-lg border border-outline-variant/40 bg-surface-container-lowest/60 p-2.5 sm:grid-cols-[1fr_1.4fr_auto] sm:items-center">
                    <Input aria-label={t('blueprintBuilder.guardian.safeLockPath', { index: index + 1 })} placeholder="runtime/server.lock" className="font-mono text-base sm:text-xs" value={entry.path} onChange={event => setDraft(current => {
                      const currentRecovery = current.recovery ?? defaults.recovery!
                      return { ...current, recovery: { ...currentRecovery, safe_lock_files: (currentRecovery.safe_lock_files ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, path: event.target.value } : item) } }
                    })} />
                    <Input aria-label={t('blueprintBuilder.guardian.safeLockReason', { index: index + 1 })} placeholder={t('blueprintBuilder.guardian.safeLockReasonPlaceholder')} className="text-base sm:text-sm" value={entry.reason} onChange={event => setDraft(current => {
                      const currentRecovery = current.recovery ?? defaults.recovery!
                      return { ...current, recovery: { ...currentRecovery, safe_lock_files: (currentRecovery.safe_lock_files ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, reason: event.target.value } : item) } }
                    })} />
                    <Button type="button" variant="ghost" size="icon" className="min-h-10 min-w-10 justify-self-end" aria-label={t('blueprintBuilder.guardian.removeSafeLockFile', { index: index + 1 })} onClick={() => setDraft(current => {
                      const currentRecovery = current.recovery ?? defaults.recovery!
                      return { ...current, recovery: { ...currentRecovery, safe_lock_files: (currentRecovery.safe_lock_files ?? []).filter((_, itemIndex) => itemIndex !== index) } }
                    })}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="space-y-3 border-t border-outline-variant/35 pt-4">
                <ToggleRow
                  label={t('blueprintBuilder.guardian.beforeRiskyAction')}
                  description={t('blueprintBuilder.guardian.beforeRiskyActionHelp')}
                  checked={backups.before_risky_action}
                  onCheckedChange={gesetzt => setDraft(current => ({ ...current, backups: { ...(current.backups ?? defaults.backups!), before_risky_action: gesetzt } }))}
                />
                <LinesField
                  id="bp-backups-protected"
                  label={t('blueprintBuilder.fields.backupsProtected.label')}
                  help={t('blueprintBuilder.fields.backupsProtected.help')}
                  rows={2}
                  value={backups.protected_paths}
                  onChange={protected_paths => setDraft(current => ({ ...current, backups: { ...(current.backups ?? defaults.backups!), protected_paths } }))}
                />
              </div>

              <div className="grid gap-3 border-t border-outline-variant/35 pt-4 sm:grid-cols-3">
                <Field id="bp-recovery-max-attempts" label={t('blueprintBuilder.fields.recoveryMaxAttempts.label')} help={t('blueprintBuilder.fields.recoveryMaxAttempts.help')}><NumberStepper min={1} max={10} value={recovery.max_attempts ?? 3} onValueChange={value => setDraft(current => ({ ...current, recovery: { ...(current.recovery ?? defaults.recovery!), max_attempts: Number(value) } }))} /></Field>
                <Field id="bp-recovery-attempt-window" label={t('blueprintBuilder.fields.recoveryAttemptWindow.label')} help={t('blueprintBuilder.fields.recoveryAttemptWindow.help')}><NumberStepper min={60} max={86_400} value={recovery.attempt_window_seconds ?? 1800} onValueChange={value => setDraft(current => ({ ...current, recovery: { ...(current.recovery ?? defaults.recovery!), attempt_window_seconds: Number(value) } }))} /></Field>
                <Field id="bp-recovery-cooldown" label={t('blueprintBuilder.fields.recoveryCooldown.label')} help={t('blueprintBuilder.fields.recoveryCooldown.help')}><NumberStepper min={1} max={3600} value={recovery.cooldown_seconds ?? 300} onValueChange={value => setDraft(current => ({ ...current, recovery: { ...(current.recovery ?? defaults.recovery!), cooldown_seconds: Number(value) } }))} /></Field>
                <Field id="bp-verification-duration" label={t('blueprintBuilder.fields.verificationDuration.label')} help={t('blueprintBuilder.fields.verificationDuration.help')}><NumberStepper min={0} max={600} value={recovery.verification?.minimum_healthy_duration_seconds ?? 30} onValueChange={value => setDraft(current => {
                  const currentRecovery = current.recovery ?? defaults.recovery!
                  return { ...current, recovery: { ...currentRecovery, verification: { ...(currentRecovery.verification ?? defaults.recovery!.verification!), minimum_healthy_duration_seconds: Number(value) } } }
                })} /></Field>
                <Field id="bp-verification-successes" label={t('blueprintBuilder.fields.verificationSuccesses.label')} help={t('blueprintBuilder.fields.verificationSuccesses.help')}><NumberStepper min={1} max={20} value={recovery.verification?.required_consecutive_successes ?? 3} onValueChange={value => setDraft(current => {
                  const currentRecovery = current.recovery ?? defaults.recovery!
                  return { ...current, recovery: { ...currentRecovery, verification: { ...(currentRecovery.verification ?? defaults.recovery!.verification!), required_consecutive_successes: Number(value) } } }
                })} /></Field>
                <Field id="bp-verification-timeout" label={t('blueprintBuilder.fields.verificationTimeout.label')} help={t('blueprintBuilder.fields.verificationTimeout.help')}><NumberStepper min={5} max={3600} value={recovery.verification?.verification_timeout_seconds ?? 180} onValueChange={value => setDraft(current => {
                  const currentRecovery = current.recovery ?? defaults.recovery!
                  return { ...current, recovery: { ...currentRecovery, verification: { ...(currentRecovery.verification ?? defaults.recovery!.verification!), verification_timeout_seconds: Number(value) } } }
                })} /></Field>
              </div>
            </CollapsibleSection>
          </div>
        )}
      </div>
    )
  }

  const renderReview = () => (
    <div className="space-y-4">
      {issues.length ? (
        <div className="msm-alert-warning" role="alert">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('blueprintBuilder.review.issueCount', { count: issues.length })}</span>
          </div>
          <ul className="mt-2.5 space-y-1.5">
            {issues.map((issue, index) => (
              <li key={`${issue.path}-${issue.key}-${index}`}>
                <button
                  type="button"
                  className="text-left text-xs underline underline-offset-2 hover:opacity-80"
                  onClick={() => setSection(sectionForIssue(issue.path))}
                >
                  <code className="font-mono">{issue.path}</code>: {t(issue.key, issue.values)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="msm-alert-success flex items-center gap-2" role="status">
          <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t('blueprintBuilder.review.ready')}</span>
        </div>
      )}

      {/* Human-friendly summary */}
      <div className="grid gap-2.5 rounded-xl border border-outline-variant/45 bg-surface-container-low/50 p-4 text-sm sm:grid-cols-2">
        <div>
          <span className="text-xs text-on-surface-variant">{t('blueprintBuilder.fields.name.label')}</span>
          <p className="font-semibold text-on-surface">{normalized.meta.name || '—'}</p>
        </div>
        <div>
          <span className="text-xs text-on-surface-variant">{t('blueprintBuilder.fields.id.label')}</span>
          <p className="font-mono text-xs text-on-surface">{normalized.meta.id || '—'}</p>
        </div>
        <div>
          <span className="text-xs text-on-surface-variant">{t('blueprintBuilder.fields.source.label')}</span>
          <p className="font-medium text-on-surface">{normalized.source.type}</p>
        </div>
        <div>
          <span className="text-xs text-on-surface-variant">{t('blueprintBuilder.sections.ports')}</span>
          <p className="font-medium text-on-surface">
            {normalized.ports.length > 0 ? normalized.ports.map(p => `${p.name}/${p.protocol}`).join(', ') : '—'}
          </p>
        </div>
        <div>
          <span className="text-xs text-on-surface-variant">{t('blueprintBuilder.sections.mods')}</span>
          <p className="font-medium text-on-surface">{normalized.mods?.supportsMods ? t('blueprintBuilder.review.on') : t('blueprintBuilder.review.off')}</p>
        </div>
        <div>
          <span className="text-xs text-on-surface-variant">{t('blueprintBuilder.sections.guardian')}</span>
          <p className="font-medium text-on-surface">
            {normalized.health || normalized.logs || normalized.recovery ? t('blueprintBuilder.review.on') : t('blueprintBuilder.review.off')}
          </p>
        </div>
      </div>

      <p className="text-xs leading-5 text-on-surface-variant">{t('blueprintBuilder.review.backend')}</p>

      <details className="overflow-hidden rounded-xl border border-outline-variant/55 bg-surface-container-lowest">
        <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 py-2 text-xs font-medium text-on-surface-variant">
          <span className="inline-flex items-center gap-2">
            <Code2 className="h-4 w-4" aria-hidden="true" />
            {t('blueprintBuilder.review.json')}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={(e) => { e.preventDefault(); void copyJson() }}>
            {copiedJson ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
            {copiedJson ? t('common.copied') : t('docs.copyExample')}
          </Button>
        </summary>
        <pre className="max-h-72 overflow-auto border-t border-outline-variant/40 p-4 text-xs leading-5 text-on-surface-variant">
          <code>{JSON.stringify(normalized, null, 2)}</code>
        </pre>
      </details>
    </div>
  )

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent
        overlayClassName="items-end p-0 sm:items-center sm:p-4"
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl rounded-b-none pb-[var(--msm-unten-sicher)] sm:max-h-[86dvh] sm:rounded-panel sm:pb-0"
        aria-labelledby="blueprint-builder-title"
        aria-describedby="blueprint-builder-description"
        data-testid="blueprint-builder-panel"
      >
        <div className="flex shrink-0 justify-center pt-2.5 pb-1 sm:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-on-surface-variant/30" />
        </div>

        <DialogHeader className="shrink-0 px-4 py-3.5 pr-12 sm:px-6 sm:py-4 sm:pr-14">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle id="blueprint-builder-title" className="text-lg sm:text-xl">
              {title}
            </DialogTitle>
            <span className="rounded-full border border-outline-variant/60 bg-surface-container-high/60 px-2 py-0.5 font-mono text-xs text-on-surface-variant">
              {mode === 'edit' ? draft.meta.id : t('blueprintBuilder.draft')}
            </span>
          </div>
          <DialogDescription id="blueprint-builder-description">
            {dialogDescription}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex min-h-48 flex-1 items-center justify-center gap-2 p-6 text-sm text-on-surface-variant" role="status">
            <Spinner />
            <span>{t('blueprintBuilder.loading')}</span>
          </div>
        ) : (
          <>
            <div className="shrink-0 border-b border-outline-variant/45 bg-surface-container-low/40 px-2 sm:px-5">
              <TabBar
                tabs={sectionTabs}
                active={section}
                onChange={setSection}
                ariaLabel={t('blueprintBuilder.sectionNavigation')}
                einzeilig
                variante="underline"
              />
            </div>

            <div
              ref={scrollAreaRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5"
              aria-label={t('blueprintBuilder.fieldsArea')}
            >
              <form className="space-y-4" onSubmit={event => event.preventDefault()}>
                {section === 'basics' && renderBasics()}
                {section === 'source' && renderSource()}
                {section === 'runtime' && renderRuntime()}
                {section === 'mods' && renderModsAndBackup()}
                {section === 'guardian' && renderGuardian()}
                {section === 'review' && renderReview()}
              </form>
            </div>
          </>
        )}

        <DialogFooter
          className="shrink-0 flex-nowrap justify-between gap-2 px-3 py-2.5 sm:px-6 sm:py-3"
          data-testid="blueprint-builder-actions"
        >
          <div className="flex items-center gap-1.5">
            <Kurzinfo text={t('common.back')} seite="anfang" lage="oben" className="sm:!hidden">
              <Button
                type="button"
                variant="secondary"
                className="min-h-11 px-3"
                aria-label={t('common.back')}
                disabled={currentIndex === 0}
                onClick={() => setSection(sectionIds[currentIndex - 1])}
              >
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">{t('common.back')}</span>
              </Button>
            </Kurzinfo>
            <Kurzinfo text={t('blueprintBuilder.downloadJson')} lage="oben" className="sm:!hidden">
              <Button
                type="button"
                variant="ghost"
                className="min-h-11 px-3"
                aria-label={t('blueprintBuilder.downloadJson')}
                onClick={downloadDraft}
              >
                <Download className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">{t('blueprintBuilder.downloadJson')}</span>
              </Button>
            </Kurzinfo>
          </div>

          <div className="flex items-center gap-2">
            {currentIndex < sectionIds.length - 1 ? (
              <Button
                type="button"
                className="min-h-11"
                onClick={() => setSection(sectionIds[currentIndex + 1])}
              >
                <span>{t('common.next')}</span>
                <ChevronRight className="h-4 w-4 shrink-0" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="button"
                className="min-h-11"
                disabled={saving}
                onClick={saveDraft}
              >
                {saving ? <Spinner /> : <Save className="h-4 w-4 shrink-0" aria-hidden="true" />}
                <span>
                  {saving
                    ? t('blueprintBuilder.saving')
                    : mode === 'edit'
                      ? t('blueprintBuilder.saveChanges')
                      : t('blueprintBuilder.addDirectly')}
                </span>
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
