import { cloneElement, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { Button, Dropdown, Input, NumberStepper, Switch, Textarea } from '@maunting/ui'
import {
  FORBIDDEN_ENV_KEYS,
  type BlueprintDraft,
  type BlueprintModIdResolver,
  type BlueprintModListTarget,
  type BlueprintValidationIssue,
  type GuardianRecoveryAction,
} from './contract'

interface AccessibleControlProps {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

export function Field({
  id,
  label,
  help,
  error,
  children,
}: {
  id: string
  label: string
  help?: string
  error?: string
  children: ReactElement<AccessibleControlProps>
}) {
  const helpId = `${id}-help`
  const errorId = `${id}-error`
  const describedBy = [help ? helpId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined

  return (
    <div className="min-w-0 max-w-full space-y-1.5">
      <label htmlFor={id} className="block break-words text-sm font-medium text-on-surface">
        {label}
      </label>
      {cloneElement(children, {
        id,
        'aria-describedby': describedBy,
        'aria-invalid': Boolean(error),
      })}
      {error ? (
        <p id={errorId} className="msm-field-error mt-1 break-words" role="alert">
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className="msm-field-help mt-1 break-words">
          {help}
        </p>
      ) : null}
    </div>
  )
}

export function LinesField({
  id,
  label,
  help,
  value,
  onChange,
  error,
  placeholder,
  rows = 3,
}: {
  id: string
  label: string
  help?: string
  value: string[]
  onChange: (value: string[]) => void
  error?: string
  placeholder?: string
  rows?: number
}) {
  const normalize = () => onChange(value.map(line => line.trim()).filter(Boolean))
  return (
    <Field id={id} label={label} help={help} error={error}>
      <Textarea
        mono
        rows={rows}
        placeholder={placeholder}
        className="min-h-20 text-base sm:text-xs"
        value={value.join('\n')}
        onChange={event => onChange(event.target.value.split('\n'))}
        onBlur={normalize}
      />
    </Field>
  )
}

interface EnvironmentRow {
  id: number
  key: string
  value: string
}

function environmentRowIssues(rows: EnvironmentRow[]): Map<number, string> {
  const counts = new Map<string, number>()
  rows.forEach(row => {
    const key = row.key.trim()
    if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  const issues = new Map<number, string>()
  rows.forEach(row => {
    const key = row.key.trim()
    if (!key) issues.set(row.id, 'blueprintBuilder.validation.envEmpty')
    else if ((counts.get(key) ?? 0) > 1) issues.set(row.id, 'blueprintBuilder.validation.envDuplicate')
    else if (!/^[A-Z][A-Z0-9_]*$/.test(key)) issues.set(row.id, 'blueprintBuilder.validation.envName')
    else if (FORBIDDEN_ENV_KEYS.has(key)) issues.set(row.id, 'blueprintBuilder.validation.envForbidden')
  })
  return issues
}

export function EnvironmentEditor({
  value,
  onChange,
  onIssuesChange,
}: {
  value: Record<string, string>
  onChange: (value: Record<string, string>) => void
  onIssuesChange: (issues: BlueprintValidationIssue[]) => void
}) {
  const { t } = useTranslation()
  const nextId = useRef(1)
  const [rows, setRows] = useState<EnvironmentRow[]>(() =>
    Object.entries(value).map(([key, current]) => ({ id: nextId.current++, key, value: current })),
  )
  const rowIssues = useMemo(() => environmentRowIssues(rows), [rows])

  const commitRows = (next: EnvironmentRow[]) => {
    setRows(next)
    const nextIssues = environmentRowIssues(next)
    onIssuesChange(
      [...nextIssues.entries()].map(([id, key]) => ({
        path: 'runtime.env',
        key,
        values: { row: next.findIndex(item => item.id === id) + 1, name: next.find(item => item.id === id)?.key.trim() ?? '' },
      })),
    )
    if (nextIssues.size === 0) {
      onChange(Object.fromEntries(next.map(row => [row.key.trim(), row.value])))
    }
  }

  const addRow = () => commitRows([...rows, { id: nextId.current++, key: '', value: '' }])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.environment.title')}</h4>
          <p className="msm-field-help mt-0.5">{t('blueprintBuilder.environment.help')}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" className="min-h-10 shrink-0" onClick={addRow}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('blueprintBuilder.environment.add')}
        </Button>
      </div>
      {rows.map((row, index) => {
        const issueKey = rowIssues.get(row.id)
        const helpId = `bp-env-${row.id}-help`
        return (
          <div key={row.id} className="grid gap-2 rounded-xl border border-outline-variant/45 bg-surface-container-lowest/60 p-2.5 sm:grid-cols-[1fr_1.4fr_auto] sm:items-center">
            <Input
              aria-label={t('blueprintBuilder.environment.nameLabel', { index: index + 1 })}
              aria-describedby={issueKey ? helpId : undefined}
              aria-invalid={Boolean(issueKey)}
              placeholder="SERVER_PORT"
              className="font-mono text-base sm:text-xs"
              value={row.key}
              onChange={event => commitRows(rows.map(item => item.id === row.id ? { ...item, key: event.target.value } : item))}
            />
            <Input
              aria-label={t('blueprintBuilder.environment.valueLabel', { index: index + 1 })}
              placeholder="{GAME_PORT}"
              className="font-mono text-base sm:text-xs"
              value={row.value}
              onChange={event => commitRows(rows.map(item => item.id === row.id ? { ...item, value: event.target.value } : item))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="min-h-10 min-w-10 justify-self-end"
              aria-label={t('blueprintBuilder.environment.removeLabel', { index: index + 1 })}
              onClick={() => commitRows(rows.filter(item => item.id !== row.id))}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
            {issueKey && (
              <p id={helpId} className="msm-field-error sm:col-span-3" role="alert">
                {t(issueKey, { row: index + 1, name: row.key })}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SetupCommandsEditor({
  value,
  onChange,
}: {
  value: string[][]
  onChange: (value: string[][]) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3 sm:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.setup.title')}</h4>
          <p className="msm-field-help mt-0.5">{t('blueprintBuilder.setup.help')}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-10 shrink-0"
          disabled={value.length >= 8}
          onClick={() => onChange([...value, ['']])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('blueprintBuilder.setup.addCommand')}
        </Button>
      </div>
      {value.map((command, commandIndex) => (
        <fieldset key={commandIndex} className="space-y-2 rounded-xl border border-outline-variant/45 bg-surface-container-lowest/60 p-3">
          <legend className="px-1 text-xs font-semibold text-on-surface-variant">
            {t('blueprintBuilder.setup.command', { index: commandIndex + 1 })}
          </legend>
          {command.map((argument, argumentIndex) => (
            <div key={argumentIndex} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
              <Input
                aria-label={t('blueprintBuilder.setup.argumentLabel', {
                  command: commandIndex + 1,
                  argument: argumentIndex + 1,
                })}
                className="font-mono text-base sm:text-xs"
                value={argument}
                onChange={event => onChange(value.map((item, index) => index === commandIndex
                  ? item.map((current, argIndex) => argIndex === argumentIndex ? event.target.value : current)
                  : item))}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="min-h-10 min-w-10"
                aria-label={t('blueprintBuilder.setup.removeArgument', { index: argumentIndex + 1 })}
                onClick={() => onChange(value.map((item, index) => index === commandIndex
                  ? item.filter((_, argIndex) => argIndex !== argumentIndex)
                  : item))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="min-h-9"
              disabled={command.length >= 32}
              onClick={() => onChange(value.map((item, index) => index === commandIndex ? [...item, ''] : item))}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              {t('blueprintBuilder.setup.addArgument')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="min-h-9"
              onClick={() => onChange(value.filter((_, index) => index !== commandIndex))}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              {t('blueprintBuilder.setup.removeCommand')}
            </Button>
          </div>
        </fieldset>
      ))}
      <p className="msm-alert-info text-xs">{t('blueprintBuilder.setup.notice')}</p>
    </div>
  )
}

export function StartupProfilesEditor({
  value,
  onChange,
}: {
  value: BlueprintDraft['runtime']['startupProfiles']
  onChange: (value: BlueprintDraft['runtime']['startupProfiles']) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.profiles.title')}</h4>
          <p className="msm-field-help mt-0.5">{t('blueprintBuilder.profiles.help')}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" className="min-h-10 shrink-0" disabled={value.length >= 8} onClick={() => onChange([...value, { whenFile: '', startup: '' }])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('blueprintBuilder.profiles.add')}
        </Button>
      </div>
      {value.map((row, index) => (
        <div key={index} className="grid gap-2 rounded-xl border border-outline-variant/45 bg-surface-container-lowest/60 p-2.5 sm:grid-cols-[1fr_1.4fr_auto] sm:items-center">
          <Input aria-label={t('blueprintBuilder.profiles.markerLabel', { index: index + 1 })} placeholder="package.json" className="font-mono text-base sm:text-xs" value={row.whenFile} onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, whenFile: event.target.value } : item))} />
          <Input aria-label={t('blueprintBuilder.profiles.startupLabel', { index: index + 1 })} placeholder="npm start" className="font-mono text-base sm:text-xs" value={row.startup} onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, startup: event.target.value } : item))} />
          <Button type="button" variant="ghost" size="icon" className="min-h-10 min-w-10 justify-self-end" aria-label={t('blueprintBuilder.profiles.removeLabel', { index: index + 1 })} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
    </div>
  )
}

export function SeedFileEditor({
  value,
  onChange,
}: {
  value: BlueprintDraft['runtime']['seedFiles']
  onChange: (value: BlueprintDraft['runtime']['seedFiles']) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.seedFiles.title')}</h4>
          <p className="msm-field-help mt-0.5">{t('blueprintBuilder.seedFiles.help')}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" className="min-h-10 shrink-0" disabled={value.length >= 16} onClick={() => onChange([...value, { file: '', content: '' }])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('blueprintBuilder.seedFiles.add')}
        </Button>
      </div>
      {value.map((row, index) => (
        <div key={index} className="grid gap-2.5 rounded-xl border border-outline-variant/45 bg-surface-container-lowest/60 p-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <Input
              aria-label={t('blueprintBuilder.seedFiles.fileLabel', { index: index + 1 })}
              placeholder="server.json"
              className="font-mono text-base sm:text-xs"
              value={row.file}
              onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, file: event.target.value } : item))}
            />
            <Button type="button" variant="ghost" size="icon" className="min-h-10 min-w-10" aria-label={t('common.remove')} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <Textarea
            mono
            aria-label={t('blueprintBuilder.seedFiles.contentLabel', { index: index + 1 })}
            placeholder={'{\n  "queryPort": {QUERY_PORT}\n}\n'}
            className="min-h-24 text-base sm:text-xs"
            value={row.content}
            onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, content: event.target.value } : item))}
          />
        </div>
      ))}
    </div>
  )
}

export function ConfigPatchEditor({
  value,
  onChange,
}: {
  value: BlueprintDraft['runtime']['configPatches']
  onChange: (value: BlueprintDraft['runtime']['configPatches']) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.patches.title')}</h4>
          <p className="msm-field-help mt-0.5">{t('blueprintBuilder.patches.help')}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" className="min-h-10 shrink-0" disabled={value.length >= 32} onClick={() => onChange([...value, { type: 'ini', file: '', section: '', key: '', value: '' }])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('blueprintBuilder.patches.add')}
        </Button>
      </div>
      {value.map((row, index) => (
        <div key={index} className="grid gap-2.5 rounded-xl border border-outline-variant/45 bg-surface-container-lowest/60 p-3 sm:grid-cols-2">
          <Dropdown aria-label={t('blueprintBuilder.patches.typeLabel', { index: index + 1 })} value={row.type} options={[{ value: 'ini', label: 'INI' }, { value: 'regex', label: 'Textmuster (Regex)' }]} onChange={next => onChange(value.map((item, itemIndex) => itemIndex === index ? next === 'ini' ? { type: 'ini', file: item.file, section: '', key: '', value: item.value } : { type: 'regex', file: item.file, regex: '', value: item.value } : item))} />
          <Input aria-label={t('blueprintBuilder.patches.fileLabel', { index: index + 1 })} placeholder="config/server.ini" className="font-mono text-base sm:text-xs" value={row.file} onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, file: event.target.value } : item))} />
          {row.type === 'ini' ? (
            <>
              <Input aria-label={t('blueprintBuilder.patches.sectionLabel', { index: index + 1 })} placeholder="Server" className="text-base sm:text-sm" value={row.section ?? ''} onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, section: event.target.value } : item))} />
              <Input aria-label={t('blueprintBuilder.patches.keyLabel', { index: index + 1 })} placeholder="Port" className="text-base sm:text-sm" value={row.key ?? ''} onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item))} />
            </>
          ) : (
            <Input aria-label={t('blueprintBuilder.patches.regexLabel', { index: index + 1 })} placeholder="(port=)\d+" className="font-mono text-base sm:col-span-2 sm:text-xs" value={row.regex ?? ''} onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, regex: event.target.value } : item))} />
          )}
          <Input aria-label={t('blueprintBuilder.patches.valueLabel', { index: index + 1 })} placeholder="{GAME_PORT}" className="font-mono text-base sm:text-xs" value={row.value} onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, value: event.target.value } : item))} />
          <Button type="button" variant="destructive" size="sm" className="min-h-10 justify-self-start sm:justify-self-end" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            {t('common.remove')}
          </Button>
        </div>
      ))}
    </div>
  )
}

export function PostInstallEditor({
  value,
  onChange,
}: {
  value: NonNullable<BlueprintDraft['mods']>['postInstall']
  onChange: (value: NonNullable<BlueprintDraft['mods']>['postInstall']) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.postInstall.title')}</h4>
          <p className="msm-field-help mt-0.5">{t('blueprintBuilder.postInstall.help')}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" className="min-h-10 shrink-0" disabled={value.length >= 32} onClick={() => onChange([...value, { operation: 'copy', source: '', target: '', required: false }])}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('blueprintBuilder.postInstall.add')}
        </Button>
      </div>
      {value.map((row, index) => (
        <div key={index} className="grid gap-2.5 rounded-xl border border-outline-variant/45 bg-surface-container-lowest/60 p-3">
          <div className="grid gap-2 sm:grid-cols-[9rem_1fr_1fr_auto] sm:items-center">
            <Dropdown aria-label={t('blueprintBuilder.postInstall.operationLabel', { index: index + 1 })} value={row.operation} options={[{ value: 'copy', label: t('common.copy') }, { value: 'symlink', label: t('blueprintBuilder.postInstall.symlink') }]} onChange={next => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, operation: next as 'copy' | 'symlink' } : item))} />
            <Input aria-label={t('blueprintBuilder.postInstall.sourceLabel', { index: index + 1 })} placeholder="workshop/{MOD_ID}/*" className="font-mono text-base sm:text-xs" value={row.source} onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, source: event.target.value } : item))} />
            <Input aria-label={t('blueprintBuilder.postInstall.targetLabel', { index: index + 1 })} placeholder="mods/{BASENAME}" className="font-mono text-base sm:text-xs" value={row.target} onChange={event => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, target: event.target.value } : item))} />
            <Button type="button" variant="ghost" size="icon" className="min-h-10 min-w-10 justify-self-end" aria-label={t('blueprintBuilder.postInstall.removeLabel', { index: index + 1 })} onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm text-on-surface-variant">
            <span>{t('blueprintBuilder.postInstall.required')}</span>
            <Switch checked={row.required} onCheckedChange={gesetzt => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, required: gesetzt } : item))} />
          </label>
          <details className="rounded-lg border border-outline-variant/35 bg-surface-container-low/40 px-3 py-2">
            <summary className="cursor-pointer text-xs font-medium text-on-surface-variant">
              {t('blueprintBuilder.postInstall.purgeBeforeTitle')}
            </summary>
            <div className="mt-2">
              <LinesField
                id={`bp-postinstall-purge-${index}`}
                label={t('blueprintBuilder.postInstall.purgeBeforeLabel', { index: index + 1 })}
                help={t('blueprintBuilder.postInstall.purgeBeforeHelp')}
                rows={2}
                placeholder="Saved/ExtractedMods/{STEM}-LinuxServer.pak"
                value={row.purgeBefore ?? []}
                onChange={purgeBefore => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, purgeBefore } : item))}
              />
            </div>
          </details>
        </div>
      ))}
    </div>
  )
}

export function ModIdResolversEditor({
  value,
  onChange,
}: {
  value: BlueprintModIdResolver[]
  onChange: (value: BlueprintModIdResolver[]) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.resolvers.title')}</h4>
          <p className="msm-field-help mt-0.5">{t('blueprintBuilder.resolvers.help')}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-10 shrink-0"
          disabled={value.length >= 8}
          onClick={() => onChange([...value, { name: '', fileGlob: '', format: 'iniKey', key: 'id', maxMatches: 16, fallback: 'skip' }])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('blueprintBuilder.resolvers.add')}
        </Button>
      </div>
      {value.map((row, index) => (
        <div key={index} className="grid gap-2.5 rounded-xl border border-outline-variant/45 bg-surface-container-lowest/60 p-3 sm:grid-cols-2">
          <Input aria-label={t('blueprintBuilder.resolvers.nameLabel', { index: index + 1 })} placeholder="zomboid_mod_info" className="font-mono text-base sm:text-xs" value={row.name} onChange={e => onChange(value.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} />
          <Input aria-label={t('blueprintBuilder.resolvers.globLabel', { index: index + 1 })} placeholder="steamapps/workshop/content/{WORKSHOP_APP_ID}/{WORKSHOP_ID}/**/mod.info" className="font-mono text-base sm:text-xs" value={row.fileGlob} onChange={e => onChange(value.map((item, i) => i === index ? { ...item, fileGlob: e.target.value } : item))} />
          <Dropdown aria-label={t('blueprintBuilder.resolvers.formatLabel', { index: index + 1 })} value={row.format} options={[{ value: 'iniKey', label: t('blueprintBuilder.resolvers.formatIni') }, { value: 'regex', label: t('blueprintBuilder.resolvers.formatRegex') }]} onChange={next => onChange(value.map((item, i) => i === index ? { ...item, format: next as 'iniKey' | 'regex' } : item))} />
          {row.format === 'iniKey' ? (
            <Input aria-label={t('blueprintBuilder.resolvers.keyLabel', { index: index + 1 })} placeholder="id" className="font-mono text-base sm:text-xs" value={row.key ?? ''} onChange={e => onChange(value.map((item, i) => i === index ? { ...item, key: e.target.value } : item))} />
          ) : (
            <Input aria-label={t('blueprintBuilder.resolvers.regexLabel', { index: index + 1 })} placeholder="id=([^\n]+)" className="font-mono text-base sm:text-xs" value={row.regex ?? ''} onChange={e => onChange(value.map((item, i) => i === index ? { ...item, regex: e.target.value } : item))} />
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-on-surface-variant">{t('blueprintBuilder.resolvers.maxMatches')}</span>
            <NumberStepper min={1} max={64} value={row.maxMatches} onValueChange={v => onChange(value.map((item, i) => i === index ? { ...item, maxMatches: Number(v) } : item))} />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Dropdown aria-label={t('blueprintBuilder.resolvers.fallbackLabel', { index: index + 1 })} value={row.fallback} options={[{ value: 'skip', label: t('blueprintBuilder.resolvers.fallbackSkip') }, { value: 'workshopId', label: t('blueprintBuilder.resolvers.fallbackWorkshop') }]} onChange={next => onChange(value.map((item, i) => i === index ? { ...item, fallback: next as 'skip' | 'workshopId' } : item))} />
            <Button type="button" variant="ghost" size="icon" className="min-h-10 min-w-10 shrink-0" aria-label={t('blueprintBuilder.resolvers.removeLabel', { index: index + 1 })} onClick={() => onChange(value.filter((_, i) => i !== index))}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function ModListTargetsEditor({
  value,
  onChange,
}: {
  value: BlueprintModListTarget[]
  onChange: (value: BlueprintModListTarget[]) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-on-surface">{t('blueprintBuilder.targets.title')}</h4>
          <p className="msm-field-help mt-0.5">{t('blueprintBuilder.targets.help')}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-10 shrink-0"
          disabled={value.length >= 16}
          onClick={() => onChange([...value, { file: '', valueSource: 'workshopIds', separator: ';' }])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('blueprintBuilder.targets.add')}
        </Button>
      </div>
      {value.map((row, index) => (
        <div key={index} className="grid gap-2.5 rounded-xl border border-outline-variant/45 bg-surface-container-lowest/60 p-3 sm:grid-cols-2">
          <Input aria-label={t('blueprintBuilder.targets.fileLabel', { index: index + 1 })} placeholder="Server/{SERVER_NAME}.ini" className="font-mono text-base sm:text-xs" value={row.file} onChange={e => onChange(value.map((item, i) => i === index ? { ...item, file: e.target.value } : item))} />
          <Input aria-label={t('blueprintBuilder.targets.keyLabel', { index: index + 1 })} placeholder="WorkshopItems (optional)" className="font-mono text-base sm:text-xs" value={row.key ?? ''} onChange={e => onChange(value.map((item, i) => i === index ? { ...item, key: e.target.value } : item))} />
          <Input aria-label={t('blueprintBuilder.targets.sourceLabel', { index: index + 1 })} placeholder="workshopIds / resolvedIds:name" className="font-mono text-base sm:text-xs" value={row.valueSource} onChange={e => onChange(value.map((item, i) => i === index ? { ...item, valueSource: e.target.value } : item))} />
          <div className="grid grid-cols-[5.5rem_1fr_auto] gap-2 items-center">
            <Input aria-label={t('blueprintBuilder.targets.separatorLabel', { index: index + 1 })} placeholder=";" className="font-mono text-base sm:text-xs" value={row.separator} onChange={e => onChange(value.map((item, i) => i === index ? { ...item, separator: e.target.value } : item))} />
            <Input aria-label={t('blueprintBuilder.targets.templateLabel', { index: index + 1 })} placeholder="*{VALUE}" className="font-mono text-base sm:text-xs" value={row.entryTemplate ?? ''} onChange={e => onChange(value.map((item, i) => i === index ? { ...item, entryTemplate: e.target.value } : item))} />
            <Button type="button" variant="ghost" size="icon" className="min-h-10 min-w-10" aria-label={t('blueprintBuilder.targets.removeLabel', { index: index + 1 })} onClick={() => onChange(value.filter((_, i) => i !== index))}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

export function RecoveryPoliciesEditor({
  value,
  onChange,
}: {
  value: Array<{ match: string; action: GuardianRecoveryAction | '' }>
  onChange: (value: Array<{ match: string; action: GuardianRecoveryAction | '' }>) => void
}) {
  const { t } = useTranslation()

  const commonMatches = [
    { value: 'process_not_running', label: t('blueprintBuilder.recovery.matches.process_not_running') },
    { value: 'tcp_connect_failed', label: t('blueprintBuilder.recovery.matches.tcp_connect_failed') },
    { value: 'udp_mapping_missing', label: t('blueprintBuilder.recovery.matches.udp_mapping_missing') },
    { value: 'http_redirect_rejected', label: t('blueprintBuilder.recovery.matches.http_redirect_rejected') },
    { value: 'http_response_too_large', label: t('blueprintBuilder.recovery.matches.http_response_too_large') },
    { value: 'http_unexpected_status', label: t('blueprintBuilder.recovery.matches.http_unexpected_status') },
    { value: 'http_request_failed', label: t('blueprintBuilder.recovery.matches.http_request_failed') },
    { value: 'minecraft_query_failed', label: t('blueprintBuilder.recovery.matches.minecraft_query_failed') },
    { value: 'minecraft_status_failed', label: t('blueprintBuilder.recovery.matches.minecraft_status_failed') },
    { value: 'source_query_failed', label: t('blueprintBuilder.recovery.matches.source_query_failed') },
    { value: 'port-conflict', label: t('blueprintBuilder.recovery.matches.port-conflict') },
    { value: 'linux-oom', label: t('blueprintBuilder.recovery.matches.linux-oom') },
    { value: 'java-stacktrace', label: t('blueprintBuilder.recovery.matches.java-stacktrace') },
    { value: 'nodejs-stacktrace', label: t('blueprintBuilder.recovery.matches.nodejs-stacktrace') },
    { value: 'missing-runtime', label: t('blueprintBuilder.recovery.matches.missing-runtime') },
    { value: 'corrupted-config', label: t('blueprintBuilder.recovery.matches.corrupted-config') },
    { value: 'startup-pattern', label: t('blueprintBuilder.recovery.matches.startup-pattern') },
    { value: 'probe_failed', label: t('blueprintBuilder.recovery.matches.probe_failed') },
  ]

  const commonActions = [
    { value: 'restart', label: t('blueprintBuilder.recovery.actions.restart') },
    { value: 'graceful_restart', label: t('blueprintBuilder.recovery.actions.graceful_restart') },
    { value: 'clear_declared_lock_files', label: t('blueprintBuilder.recovery.actions.clear_declared_lock_files') },
    { value: 'quarantine', label: t('blueprintBuilder.recovery.actions.quarantine') },
  ]

  return (
    <div className="min-w-0 max-w-full space-y-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h4 className="min-w-0 break-words text-sm font-semibold text-on-surface">{t('blueprintBuilder.recovery.policiesTitle')}</h4>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="min-h-10 shrink-0"
          disabled={value.length >= 16}
          onClick={() => onChange([...value, { match: 'port-conflict', action: 'restart' }])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('blueprintBuilder.recovery.addPolicy')}
        </Button>
      </div>
      {value.map((row, index) => (
        <div key={index} className="grid min-w-0 max-w-full gap-2.5 rounded-xl border border-outline-variant/45 bg-surface-container-lowest/60 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <div className="min-w-0 space-y-1">
            <label className="text-xs font-medium text-on-surface-variant">{t('blueprintBuilder.recovery.matchSelect')}</label>
            <Dropdown
              aria-label={t('blueprintBuilder.recovery.matchLabel', { index: index + 1 })}
              value={row.match}
              options={commonMatches}
              onChange={next => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, match: next } : item))}
            />
          </div>
          <div className="min-w-0 space-y-1">
            <label className="text-xs font-medium text-on-surface-variant">{t('blueprintBuilder.recovery.actionSelect')}</label>
            <Dropdown
              aria-label={t('blueprintBuilder.recovery.actionLabel', { index: index + 1 })}
              value={row.action}
              options={commonActions}
              onChange={next => onChange(value.map((item, itemIndex) => itemIndex === index
                ? { ...item, action: next as GuardianRecoveryAction }
                : item))}
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('blueprintBuilder.recovery.removeLabel', { index: index + 1 })}
            onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
            className="min-h-10 min-w-10 justify-self-end"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      ))}
    </div>
  )
}
