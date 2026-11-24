import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Clock,
  Cpu,
  Gamepad2,
  HardDrive,
  Lock,
  MemoryStick,
  RefreshCw,
  Search,
  ShieldCheck,
} from 'lucide-react'
import { api, SanitizedApiError } from '@/api/client'
import { toast } from '@/stores/toastStore'
import type { Server, SwitchOptionItem, SwitchOptionsResponse } from '@/types'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Spinner,
} from '@maunting/ui'

interface SwitchBlueprintDialogProps {
  open: boolean
  onClose: () => void
  server: Server
  onSwitched: () => void
}

function formatCooldownRemaining(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const mins = Math.max(1, Math.ceil((safe % 3600) / 60))
  if (hours > 0) return `${hours} h ${mins} min`
  return `${mins} min`
}

function formatOptionLabel(opt: SwitchOptionItem): string {
  return opt.category ? `${opt.name} (${opt.category})` : opt.name
}

export function SwitchBlueprintDialog({
  open,
  onClose,
  server,
  onSwitched,
}: SwitchBlueprintDialogProps) {
  const { t } = useTranslation()
  const [data, setData] = useState<SwitchOptionsResponse | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [switching, setSwitching] = useState(false)

  const abbrechenRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    setSearch('')
    api<SwitchOptionsResponse>(`/servers/${server.id}/switch-options`)
      .then((res) => {
        setData(res)
        const list = Array.isArray(res?.options) ? res.options : []
        const firstSelectable = list.find((o) => !o.is_current && o.selectable)
        const firstAny = list.find((o) => !o.is_current) ?? list[0]
        setSelectedId(firstSelectable?.id ?? firstAny?.id ?? '')
      })
      .catch(() => {
        setData(null)
        toast.error(t('servers.switchLoadError'))
      })
      .finally(() => setLoading(false))
  }, [open, server.id, t])

  useEffect(() => {
    if (!open) return
    const rahmen = requestAnimationFrame(() => {
      abbrechenRef.current?.focus()
    })
    return () => cancelAnimationFrame(rahmen)
  }, [open])

  const options = data?.options ?? []
  const isShopCustomer = data?.mode === 'shop_customer'

  const filteredOptions = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (opt) =>
        opt.name.toLowerCase().includes(q) ||
        opt.category.toLowerCase().includes(q) ||
        (opt.tagline ?? '').toLowerCase().includes(q) ||
        opt.platforms.some((p) => p.toLowerCase().includes(q)),
    )
  }, [options, search])

  const selectedOption = useMemo(
    () => options.find((o) => o.id === selectedId) ?? null,
    [options, selectedId],
  )

  const blockedReasonLabel = (reason?: string | null): string => {
    if (!reason) return ''
    return t(`servers.switchDialog.blockedReasons.${reason}`, {
      defaultValue: reason,
    })
  }

  const canSwitch = Boolean(
    server.status === 'stopped' &&
      !loading &&
      !switching &&
      data?.switch_allowed !== false &&
      selectedOption &&
      !selectedOption.is_current &&
      selectedOption.selectable,
  )

  const handleSwitch = async () => {
    if (!canSwitch || !selectedOption) return
    setSwitching(true)
    try {
      await api<{ message: string }>(`/servers/${server.id}/switch-blueprint`, {
        method: 'POST',
        body: JSON.stringify({ new_blueprint_id: selectedOption.id }),
      })
      toast.success(t('servers.switchSuccess'))
      onSwitched()
      onClose()
    } catch (err) {
      if (err instanceof SanitizedApiError && err.message) {
        toast.error(err.message)
      } else {
        toast.error(t('servers.switchFailed'))
      }
    } finally {
      setSwitching(false)
    }
  }

  const cooldownActive = (data?.cooldown_remaining_seconds ?? 0) > 0
  const monthlyLimitReached =
    (data?.max_per_30d ?? 0) > 0 &&
    (data?.switches_last_30d ?? 0) >= (data?.max_per_30d ?? 0)

  return (
    <Dialog
      open={open}
      escapeSchliesst={!switching}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !switching) onClose()
      }}
    >
      <DialogContent
        showCloseButton={!switching}
        className={`flex max-h-[88vh] flex-col p-0 ${
          isShopCustomer ? 'max-w-3xl' : 'max-w-lg'
        }`}
        aria-labelledby="switch-blueprint-title"
      >
        <DialogHeader className="border-b border-outline-variant/25 px-6 py-5">
          <DialogTitle
            id="switch-blueprint-title"
            className="flex items-center gap-2 font-headline text-headline-sm text-on-surface"
          >
            <RefreshCw className="h-5 w-5 text-primary" aria-hidden="true" />
            {t('servers.switchBlueprintTitle')}
          </DialogTitle>
          <DialogDescription className="text-body-sm text-on-surface-variant">
            {t('servers.switchBlueprintSubtitle')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {isShopCustomer && data && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-low px-4 py-3 text-xs">
              <div className="flex items-center gap-2 text-on-surface-variant">
                <Clock className="h-4 w-4 text-primary" aria-hidden="true" />
                <span>
                  {data.max_per_30d > 0
                    ? t('servers.switchDialog.quotaStatus', {
                        used: data.switches_last_30d,
                        max: data.max_per_30d,
                      })
                    : t('servers.switchDialog.quotaUnlimited')}
                </span>
              </div>
              {data.cooldown_hours > 0 && (
                <Badge variant={cooldownActive ? 'warning' : 'default'}>
                  {cooldownActive
                    ? t('servers.switchDialog.cooldownRemaining', {
                        time: formatCooldownRemaining(data.cooldown_remaining_seconds),
                      })
                    : t('servers.switchDialog.cooldownWindow', {
                        hours: data.cooldown_hours,
                      })}
                </Badge>
              )}
            </div>
          )}

          {(cooldownActive || monthlyLimitReached) && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-status-warning/40 bg-status-warning/10 p-3.5 text-sm text-on-surface"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />
              <p>
                {cooldownActive
                  ? t('servers.switchDialog.cooldownBlockedNotice', {
                      time: formatCooldownRemaining(data?.cooldown_remaining_seconds ?? 0),
                    })
                  : t('servers.switchDialog.limitBlockedNotice', {
                      max: data?.max_per_30d ?? 0,
                    })}
              </p>
            </div>
          )}

          {server.status !== 'stopped' && (
            <div className="flex items-start gap-2.5 rounded-xl border border-status-warning/40 bg-status-warning/10 p-3.5 text-sm text-status-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('servers.switchStopRequired')}</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Spinner size="md" />
            </div>
          ) : isShopCustomer ? (
            <div className="space-y-3">
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
                  aria-hidden="true"
                />
                <Input
                  data-testid="switch-search-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('servers.switchDialog.searchPlaceholder')}
                  className="pl-9"
                  aria-label={t('servers.switchDialog.searchPlaceholder')}
                />
              </div>

              {filteredOptions.length === 0 ? (
                <p className="rounded-xl border border-outline-variant/25 bg-surface-container-low p-6 text-center text-sm text-on-surface-variant">
                  {t('servers.switchDialog.emptyFilter')}
                </p>
              ) : (
                <div className="grid max-h-[38vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
                  {filteredOptions.map((opt) => {
                    const isSelected = selectedId === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        disabled={!opt.selectable || switching}
                        onClick={() => setSelectedId(opt.id)}
                        data-testid={`switch-game-card-${opt.id}`}
                        className={`flex flex-col gap-2.5 rounded-xl border p-3 text-left transition ${
                          isSelected
                            ? 'border-primary bg-primary/10 ring-2 ring-primary/30'
                            : opt.selectable
                              ? 'border-outline-variant/30 bg-surface-container-low hover:border-primary/50 hover:bg-surface-container'
                              : 'cursor-not-allowed border-outline-variant/20 bg-surface-container-low/50 opacity-65'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          {opt.artwork_url ? (
                            <img
                              src={opt.artwork_url}
                              alt={opt.name}
                              className="h-14 w-24 shrink-0 rounded-lg object-cover"
                            />
                          ) : (
                            <div className="grid h-14 w-24 shrink-0 place-items-center rounded-lg bg-surface-container text-on-surface-variant">
                              <Gamepad2 className="h-6 w-6" aria-hidden="true" />
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate font-semibold text-on-surface">
                                {opt.name}
                              </span>
                              {opt.is_current && (
                                <Badge variant="info">
                                  {t('servers.switchDialog.currentBadge')}
                                </Badge>
                              )}
                            </div>
                            {opt.tagline && (
                              <p className="mt-0.5 line-clamp-2 text-xs text-on-surface-variant">
                                {opt.tagline}
                              </p>
                            )}
                            <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs text-on-surface-variant">
                              {opt.platforms.slice(0, 2).map((platform) => (
                                <span
                                  key={platform}
                                  className="rounded-md bg-surface-container px-1.5 py-0.5 uppercase"
                                >
                                  {platform}
                                </span>
                              ))}
                              {opt.min_ram_mb != null && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-surface-container px-1.5 py-0.5">
                                  <MemoryStick className="h-3 w-3" aria-hidden="true" />
                                  {Math.round(opt.min_ram_mb / 1024)} GB
                                </span>
                              )}
                              {opt.min_cpu != null && (
                                <span className="inline-flex items-center gap-1 rounded-md bg-surface-container px-1.5 py-0.5">
                                  <Cpu className="h-3 w-3" aria-hidden="true" />
                                  {opt.min_cpu} vCPU
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {!opt.selectable && opt.blocked_reason && !opt.is_current && (
                          <div className="flex items-center gap-1.5 text-xs text-status-warning">
                            <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>{blockedReasonLabel(opt.blocked_reason)}</span>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <label
                htmlFor="switch-blueprint-select"
                className="block text-sm font-medium text-on-surface"
              >
                {t('servers.targetBlueprint')}
              </label>
              <Dropdown
                id="switch-blueprint-select"
                data-testid="switch-blueprint-select"
                searchable
                disabled={loading || switching || options.length === 0}
                value={selectedId}
                onChange={setSelectedId}
                options={options.map((opt) => ({
                  value: opt.id,
                  label: formatOptionLabel(opt),
                }))}
              />
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-status-destructive/30 bg-status-destructive/5 p-3.5 text-sm">
            <div className="flex items-start gap-2.5 text-on-surface">
              <ShieldCheck
                className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                aria-hidden="true"
              />
              <span className="font-medium">
                {t('servers.switchDialog.backupGuarantee')}
              </span>
            </div>
            <div className="flex items-start gap-2.5 text-status-destructive">
              <HardDrive className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{t('servers.switchWarning')}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-outline-variant/25 px-6 py-4">
          <Button
            ref={abbrechenRef}
            data-testid="switch-cancel-btn"
            variant="secondary"
            type="button"
            onClick={onClose}
            disabled={switching}
          >
            {t('common.cancel')}
          </Button>
          <Button
            data-testid="switch-submit-btn"
            variant="destructive"
            type="button"
            onClick={() => void handleSwitch()}
            disabled={!canSwitch}
          >
            {switching ? t('common.loading') : t('servers.switchConfirm')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
