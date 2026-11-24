import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Layers,
  Lock,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { api, SanitizedApiError } from '@/api/client'
import { toast } from '@/stores/toastStore'
import type {
  GameInfo,
  MinecraftVersionItem,
  MinecraftVersionsResponse,
  Server,
  SteamBranchOption,
} from '@/types'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Spinner,
  Switch,
} from '@maunting/ui'

interface ServerVersionBranchDialogProps {
  open: boolean
  onClose: () => void
  server: Server
  gameInfo?: GameInfo
  isMinecraft: boolean
  isSteam: boolean
  onUpdated: () => void
}

type MinecraftTab = 'version' | 'edition'

export function ServerVersionBranchDialog({
  open,
  onClose,
  server,
  gameInfo,
  isMinecraft,
  isSteam,
  onUpdated,
}: ServerVersionBranchDialogProps) {
  const { t } = useTranslation()

  const [mcTab, setMcTab] = useState<MinecraftTab>('version')
  const [mcData, setMcData] = useState<MinecraftVersionsResponse | null>(null)
  const [mcLoading, setMcLoading] = useState(false)
  const [includeSnapshots, setIncludeSnapshots] = useState(false)
  const [mcSearch, setMcSearch] = useState('')
  const [selectedVersion, setSelectedVersion] = useState('')
  const [resetWorldOnDowngrade, setResetWorldOnDowngrade] = useState(false)
  const [confirmKeepWorld, setConfirmKeepWorld] = useState(false)
  const [selectedEditionId, setSelectedEditionId] = useState('')

  const [selectedBranch, setSelectedBranch] = useState('public')
  const [customBranch, setCustomBranch] = useState('')
  const [branchPassword, setBranchPassword] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [saving, setSaving] = useState(false)

  const isShopCustomer = Boolean(mcData?.is_shop_customer ?? server.is_hoster_managed)
  const serverStopped = server.status === 'stopped'

  useEffect(() => {
    if (!open) return
    setSaving(false)
    setMcTab('version')
    setMcSearch('')
    setResetWorldOnDowngrade(false)
    setConfirmKeepWorld(false)
    const activeBranch = (server.steam_branch || 'public').trim() || 'public'
    setSelectedBranch(activeBranch)
    setCustomBranch(activeBranch)
    setBranchPassword('')
    setClearPassword(false)
  }, [open, server.id, server.steam_branch])

  useEffect(() => {
    if (!open || !isMinecraft) return
    let active = true
    setMcLoading(true)
    api<MinecraftVersionsResponse>(
      `/servers/${server.id}/minecraft/versions?include_snapshots=${includeSnapshots ? 'true' : 'false'}`,
    )
      .then((res) => {
        if (!active) return
        setMcData(res)
        setSelectedVersion((prev) => prev || res.current_version || 'LATEST')
        const otherEdition = res.editions.find((ed) => !ed.is_current && ed.selectable)
        setSelectedEditionId(otherEdition?.id ?? res.current_version ?? '')
      })
      .catch((err) => {
        if (!active) return
        setMcData(null)
        toast.error(
          err instanceof SanitizedApiError && err.message
            ? err.message
            : t('servers.versionBranch.loadError'),
        )
      })
      .finally(() => {
        if (active) setMcLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, isMinecraft, includeSnapshots, server.id, t])

  const filteredVersions = useMemo(() => {
    const rows = mcData?.versions ?? []
    const q = mcSearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (v) =>
        v.version.toLowerCase().includes(q) ||
        v.release_type.toLowerCase().includes(q),
    )
  }, [mcData?.versions, mcSearch])

  const selectedVersionObj: MinecraftVersionItem | null = useMemo(() => {
    if (!mcData) return null
    return mcData.versions.find((v) => v.version === selectedVersion) ?? null
  }, [mcData, selectedVersion])

  const isDowngrade = Boolean(
    mcData?.supports_downgrade_warning &&
      selectedVersionObj?.relation === 'downgrade',
  )

  const canSubmitMinecraftVersion = Boolean(
    serverStopped &&
      !mcLoading &&
      !saving &&
      selectedVersion &&
      selectedVersion !== mcData?.current_version &&
      (!isDowngrade || resetWorldOnDowngrade || confirmKeepWorld),
  )

  const canSubmitMinecraftEdition = Boolean(
    serverStopped &&
      !mcLoading &&
      !saving &&
      selectedEditionId &&
      mcData?.editions.some(
        (ed) => ed.id === selectedEditionId && !ed.is_current && ed.selectable,
      ),
  )

  const steamBranches: SteamBranchOption[] = useMemo(() => {
    const base = gameInfo?.steam_branches ?? []
    if (base.length > 0) return base
    return [
      {
        id: 'public',
        label: 'Public (Standard)',
        description: null,
        requires_password: false,
      },
    ]
  }, [gameInfo?.steam_branches])

  const effectiveBranch = !isShopCustomer && customBranch.trim()
    ? customBranch.trim()
    : selectedBranch

  const canSubmitSteamBranch = Boolean(
    serverStopped && !saving && effectiveBranch.length > 0,
  )

  const handleSubmitMinecraftVersion = async () => {
    if (!canSubmitMinecraftVersion) return
    setSaving(true)
    try {
      await api(`/servers/${server.id}/minecraft/switch-version`, {
        method: 'POST',
        body: JSON.stringify({
          target_version: selectedVersion,
          reset_world: isDowngrade ? resetWorldOnDowngrade : false,
          confirm_downgrade_keep_world:
            isDowngrade && !resetWorldOnDowngrade && confirmKeepWorld,
        }),
      })
      toast.success(
        t('servers.versionBranch.versionSuccess', { version: selectedVersion }),
      )
      onUpdated()
      onClose()
    } catch (err) {
      toast.error(
        err instanceof SanitizedApiError && err.message
          ? err.message
          : t('servers.versionBranch.switchError'),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSubmitMinecraftEdition = async () => {
    if (!canSubmitMinecraftEdition) return
    setSaving(true)
    try {
      await api(`/servers/${server.id}/switch-blueprint`, {
        method: 'POST',
        body: JSON.stringify({ new_blueprint_id: selectedEditionId }),
      })
      toast.success(t('servers.switchSuccess'))
      onUpdated()
      onClose()
    } catch (err) {
      toast.error(
        err instanceof SanitizedApiError && err.message
          ? err.message
          : t('servers.switchFailed'),
      )
    } finally {
      setSaving(false)
    }
  }

  const handleSubmitSteamBranch = async () => {
    if (!canSubmitSteamBranch) return
    setSaving(true)
    try {
      await api(`/servers/${server.id}/switch-branch`, {
        method: 'POST',
        body: JSON.stringify({
          branch: effectiveBranch,
          branch_password:
            !isShopCustomer && branchPassword.trim() ? branchPassword.trim() : null,
          clear_password: !isShopCustomer && clearPassword,
        }),
      })
      toast.success(
        t('servers.versionBranch.branchSuccess', { branch: effectiveBranch }),
      )
      onUpdated()
      onClose()
    } catch (err) {
      toast.error(
        err instanceof SanitizedApiError && err.message
          ? err.message
          : t('servers.versionBranch.switchError'),
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog
      open={open}
      escapeSchliesst={!saving}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !saving) onClose()
      }}
    >
      <DialogContent
        showCloseButton={!saving}
        className="flex max-h-[88vh] max-w-2xl flex-col p-0"
        aria-labelledby="version-branch-title"
      >
        <DialogHeader className="border-b border-outline-variant/25 px-6 py-5">
          <DialogTitle
            id="version-branch-title"
            className="flex items-center gap-2 font-headline text-headline-sm text-on-surface"
          >
            <GitBranch className="h-5 w-5 text-primary" aria-hidden="true" />
            {isSteam
              ? t('servers.versionBranch.steamTitle')
              : t('servers.versionBranch.minecraftTitle')}
          </DialogTitle>
          <DialogDescription className="text-body-sm text-on-surface-variant">
            {isSteam
              ? t('servers.versionBranch.steamSubtitle')
              : t('servers.versionBranch.minecraftSubtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!serverStopped && (
            <div className="flex items-start gap-2.5 rounded-xl border border-status-warning/40 bg-status-warning/10 p-3.5 text-sm text-status-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('servers.versionBranch.stopRequired')}</span>
            </div>
          )}

          {isMinecraft ? (
            <>
              <div
                role="tablist"
                aria-label={t('servers.versionBranch.minecraftTitle')}
                className="inline-flex rounded-xl border border-outline-variant/30 bg-surface-container-low p-1"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={mcTab === 'version'}
                  onClick={() => setMcTab('version')}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                    mcTab === 'version'
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {t('servers.versionBranch.tabVersion')}
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={mcTab === 'edition'}
                  onClick={() => setMcTab('edition')}
                  className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
                    mcTab === 'edition'
                      ? 'bg-primary text-on-primary shadow-sm'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {t('servers.versionBranch.tabEdition')}
                </button>
              </div>

              {mcLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Spinner size="md" />
                </div>
              ) : mcTab === 'version' ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="text-on-surface-variant">
                        {t('servers.versionBranch.activeVersion')}:
                      </span>
                      <Badge variant="info">{mcData?.current_version ?? 'LATEST'}</Badge>
                    </div>
                    <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                      <Switch
                        checked={includeSnapshots}
                        onCheckedChange={setIncludeSnapshots}
                        aria-label={t('servers.versionBranch.includeSnapshots')}
                      />
                      <span>{t('servers.versionBranch.includeSnapshots')}</span>
                    </label>
                  </div>

                  <div className="relative">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
                      aria-hidden="true"
                    />
                    <Input
                      value={mcSearch}
                      onChange={(e) => setMcSearch(e.target.value)}
                      placeholder={t('servers.versionBranch.searchVersionPlaceholder')}
                      className="pl-9"
                      aria-label={t('servers.versionBranch.searchVersionPlaceholder')}
                    />
                  </div>

                  <div className="grid max-h-[32vh] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                    {filteredVersions.map((ver) => {
                      const isCurrent = ver.version === mcData?.current_version
                      const isSelected = selectedVersion === ver.version
                      return (
                        <button
                          key={ver.version}
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            setSelectedVersion(ver.version)
                            setResetWorldOnDowngrade(false)
                            setConfirmKeepWorld(false)
                          }}
                          data-testid={`mc-version-item-${ver.version}`}
                          className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition ${
                            isSelected
                              ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                              : 'border-outline-variant/30 bg-surface-container-low hover:border-primary/50'
                          }`}
                        >
                          <div className="min-w-0">
                            <span className="block truncate font-mono text-sm font-semibold text-on-surface">
                              {ver.version}
                            </span>
                            <span className="block text-xs text-on-surface-variant">
                              {ver.release_type}
                            </span>
                          </div>
                          {isCurrent ? (
                            <Badge variant="info">
                              {t('servers.versionBranch.currentBadge')}
                            </Badge>
                          ) : ver.relation === 'downgrade' ? (
                            <Badge variant="warning">
                              {t('servers.versionBranch.downgradeBadge')}
                            </Badge>
                          ) : ver.relation === 'upgrade' ? (
                            <Badge variant="success">
                              {t('servers.versionBranch.upgradeBadge')}
                            </Badge>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>

                  {isDowngrade && (
                    <div
                      role="alert"
                      className="space-y-3 rounded-xl border border-status-destructive/40 bg-status-destructive/10 p-4 text-sm"
                    >
                      <div className="flex items-start gap-2.5 text-status-destructive">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <div>
                          <p className="font-semibold">
                            {t('servers.versionBranch.downgradeWarningTitle')}
                          </p>
                          <p className="mt-0.5 text-xs text-on-surface">
                            {t('servers.versionBranch.downgradeWarningBody')}
                          </p>
                        </div>
                      </div>
                      <label className="flex items-start gap-2.5 text-xs text-on-surface">
                        <input
                          type="checkbox"
                          checked={resetWorldOnDowngrade}
                          onChange={(e) => {
                            setResetWorldOnDowngrade(e.target.checked)
                            if (e.target.checked) setConfirmKeepWorld(false)
                          }}
                          className="mt-0.5 h-4 w-4 rounded border-outline"
                        />
                        <span>{t('servers.versionBranch.resetWorldLabel')}</span>
                      </label>
                      {!resetWorldOnDowngrade && (
                        <label className="flex items-start gap-2.5 text-xs text-on-surface">
                          <input
                            type="checkbox"
                            checked={confirmKeepWorld}
                            onChange={(e) => setConfirmKeepWorld(e.target.checked)}
                            className="mt-0.5 h-4 w-4 rounded border-outline"
                          />
                          <span>{t('servers.versionBranch.confirmKeepWorldLabel')}</span>
                        </label>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid max-h-[36vh] gap-2.5 overflow-y-auto pr-1 sm:grid-cols-2">
                    {(mcData?.editions ?? []).map((ed) => {
                      const isSelected = selectedEditionId === ed.id
                      return (
                        <button
                          key={ed.id}
                          type="button"
                          disabled={!ed.selectable || saving}
                          onClick={() => setSelectedEditionId(ed.id)}
                          data-testid={`mc-edition-item-${ed.id}`}
                          className={`flex flex-col gap-1.5 rounded-xl border p-3.5 text-left transition ${
                            isSelected
                              ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                              : ed.selectable
                                ? 'border-outline-variant/30 bg-surface-container-low hover:border-primary/50'
                                : 'cursor-not-allowed border-outline-variant/20 bg-surface-container-low/50 opacity-65'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="flex items-center gap-1.5 font-semibold text-on-surface">
                              <Layers className="h-4 w-4 text-primary" aria-hidden="true" />
                              {ed.name}
                            </span>
                            {ed.is_current && (
                              <Badge variant="info">
                                {t('servers.versionBranch.currentBadge')}
                              </Badge>
                            )}
                          </div>
                          <span className="text-xs text-on-surface-variant">{ed.provider}</span>
                          {!ed.selectable && ed.blocked_reason && !ed.is_current && (
                            <span className="flex items-center gap-1 text-xs text-status-warning">
                              <Lock className="h-3 w-3" aria-hidden="true" />
                              {t(`servers.switchDialog.blockedReasons.${ed.blocked_reason}`, {
                                defaultValue: ed.blocked_reason,
                              })}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          ) : isSteam ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-sm">
                <span className="text-on-surface-variant">
                  {t('servers.versionBranch.activeBranch')}:
                </span>
                <div className="flex items-center gap-2">
                  <Badge variant="info">{server.steam_branch || 'public'}</Badge>
                  {server.has_branch_password && (
                    <Badge variant="default">
                      <Lock className="mr-1 h-3 w-3" aria-hidden="true" />
                      {t('servers.versionBranch.passwordProtectedBadge')}
                    </Badge>
                  )}
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2">
                {steamBranches.map((br) => {
                  const lockedForCustomer = isShopCustomer && br.requires_password
                  const isSelected = effectiveBranch === br.id
                  const isActive = (server.steam_branch || 'public') === br.id
                  return (
                    <button
                      key={br.id}
                      type="button"
                      disabled={lockedForCustomer || saving}
                      onClick={() => {
                        setSelectedBranch(br.id)
                        setCustomBranch(br.id)
                      }}
                      data-testid={`steam-branch-card-${br.id}`}
                      className={`flex flex-col gap-1.5 rounded-xl border p-3.5 text-left transition ${
                        isSelected
                          ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                          : lockedForCustomer
                            ? 'cursor-not-allowed border-outline-variant/20 bg-surface-container-low/50 opacity-60'
                            : 'border-outline-variant/30 bg-surface-container-low hover:border-primary/50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-on-surface">{br.label}</span>
                        {isActive && (
                          <Badge variant="info">
                            <CheckCircle2 className="mr-1 h-3 w-3" aria-hidden="true" />
                            {t('servers.versionBranch.currentBadge')}
                          </Badge>
                        )}
                      </div>
                      <span className="font-mono text-xs text-on-surface-variant">{br.id}</span>
                      {br.description && (
                        <p className="text-xs text-on-surface-variant">{br.description}</p>
                      )}
                      {lockedForCustomer && (
                        <span className="text-xs text-status-warning">
                          {t('servers.versionBranch.customerBranchLocked')}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>

              {!isShopCustomer && (
                <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-4">
                  <div>
                    <Input
                      label={t('servers.versionBranch.customBranchLabel')}
                      value={customBranch}
                      onChange={(e) => {
                        setCustomBranch(e.target.value)
                        setSelectedBranch(e.target.value)
                      }}
                      placeholder="public"
                      disabled={saving}
                    />
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {t('servers.versionBranch.customBranchHint')}
                    </p>
                  </div>
                  <div>
                    <Input
                      type="password"
                      label={t('servers.versionBranch.branchPasswordLabel')}
                      value={branchPassword}
                      onChange={(e) => setBranchPassword(e.target.value)}
                      disabled={saving || clearPassword}
                    />
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {t('servers.versionBranch.branchPasswordHint')}
                    </p>
                  </div>
                  {server.has_branch_password && (
                    <label className="flex items-center gap-2 text-xs text-on-surface-variant">
                      <input
                        type="checkbox"
                        checked={clearPassword}
                        onChange={(e) => setClearPassword(e.target.checked)}
                        className="h-4 w-4 rounded border-outline"
                      />
                      <span>{t('servers.versionBranch.clearPasswordLabel')}</span>
                    </label>
                  )}
                </div>
              )}
            </div>
          ) : null}

          <div className="flex items-start gap-2.5 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3.5 text-sm text-on-surface">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            <span>{t('servers.versionBranch.backupGuarantee')}</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-outline-variant/25 px-6 py-4">
          <Button variant="secondary" type="button" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          {isMinecraft && mcTab === 'version' ? (
            <Button
              data-testid="version-branch-submit-btn"
              variant="primary"
              type="button"
              onClick={() => void handleSubmitMinecraftVersion()}
              disabled={!canSubmitMinecraftVersion}
            >
              {saving ? t('common.loading') : t('servers.versionBranch.applyVersion')}
            </Button>
          ) : isMinecraft && mcTab === 'edition' ? (
            <Button
              data-testid="version-branch-submit-btn"
              variant="destructive"
              type="button"
              onClick={() => void handleSubmitMinecraftEdition()}
              disabled={!canSubmitMinecraftEdition}
            >
              {saving ? t('common.loading') : t('servers.versionBranch.applyEdition')}
            </Button>
          ) : (
            <Button
              data-testid="version-branch-submit-btn"
              variant="primary"
              type="button"
              onClick={() => void handleSubmitSteamBranch()}
              disabled={!canSubmitSteamBranch}
            >
              {saving ? t('common.loading') : t('servers.versionBranch.applyBranch')}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
