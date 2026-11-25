import type { ReactNode } from 'react'
import { ArrowDown, ArrowUp, LayoutDashboard, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Kurzinfo,
} from '@maunting/ui'
import { FavoriteButton } from '@/components/FavoriteButton'
import { MAX_DASHBOARD_TABS } from '@/desktop/dashboard/dashboardWege'
import type { DashboardOption } from './DashboardReiter'

interface DashboardReiterAnpassenDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  options: DashboardOption[]
  pinnedOptions: DashboardOption[]
  pinnedSet: ReadonlySet<string>
  isCustom: boolean
  onTogglePin: (to: string) => void
  onMovePin: (to: string, direction: 'up' | 'down') => void
  onReset: () => void
}

function OptionPinRow({
  option,
  subtitle,
  isPinned,
  onTogglePin,
  testId,
  beforeFavorite,
}: {
  option: DashboardOption
  subtitle?: string
  isPinned: boolean
  onTogglePin: (to: string) => void
  testId: string
  beforeFavorite?: ReactNode
}) {
  const { t } = useTranslation()
  const Icon = option.icon

  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-control border px-3 py-2 transition-colors ${
        isPinned
          ? 'border-status-warning/50 bg-status-warning/[0.07]'
          : 'border-outline-variant/35 bg-surface-container-low/60 hover:bg-surface-container/70'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {Icon && (
          <Icon
            className={`h-4 w-4 shrink-0 ${isPinned ? 'text-status-warning' : 'text-on-surface-variant'}`}
            aria-hidden="true"
          />
        )}
        <div className="min-w-0">
          <div className="truncate text-label-md font-medium text-on-surface">{option.label}</div>
          {subtitle && <div className="truncate text-xs text-on-surface-variant">{subtitle}</div>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {beforeFavorite}
        <FavoriteButton
          isFavorite={isPinned}
          onToggle={() => onTogglePin(option.to)}
          tooltipText={t(isPinned ? 'settings.unpinFromBar' : 'settings.pinToBar')}
          ariaLabel={t(isPinned ? 'settings.unpinSectionFromBar' : 'settings.pinSectionToBar', {
            section: option.label,
          })}
          testId={testId}
        />
      </div>
    </div>
  )
}

export function DashboardReiterAnpassenDialog({
  open,
  onOpenChange,
  options,
  pinnedOptions,
  pinnedSet,
  isCustom,
  onTogglePin,
  onMovePin,
  onReset,
}: DashboardReiterAnpassenDialogProps) {
  const { t } = useTranslation()
  const panelOptions = options.filter((opt) => opt.kind === 'panel')
  const settingsOptions = options.filter((opt) => opt.kind === 'settings')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('dashboard.customize.title')}</DialogTitle>
          <DialogDescription>
            {t('dashboard.customize.description', { max: MAX_DASHBOARD_TABS })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-label-md font-semibold text-on-surface">
                {t('dashboard.customize.pinnedHeading')}
              </h4>
              <Badge variant={pinnedOptions.length >= MAX_DASHBOARD_TABS ? 'warning' : 'default'}>
                {t('dashboard.customize.countBadge', {
                  count: pinnedOptions.length,
                  max: MAX_DASHBOARD_TABS,
                })}
              </Badge>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 rounded-control border border-outline-variant/35 bg-surface-container-low/40 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <LayoutDashboard className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span className="truncate text-label-md font-medium text-on-surface">
                    {t('nav.dashboard')}
                  </span>
                </div>
                <Badge variant="default">{t('dashboard.customize.fixedBadge')}</Badge>
              </div>

              {pinnedOptions.length === 0 ? (
                <p className="rounded-control border border-dashed border-outline-variant/40 px-3 py-3 text-xs text-on-surface-variant">
                  {t('dashboard.customize.noExtraPinned')}
                </p>
              ) : (
                pinnedOptions.map((option, index) => (
                  <OptionPinRow
                    key={option.to}
                    option={option}
                    subtitle={
                      option.kind === 'settings' && option.groupLabel
                        ? `${t('mss.dashboard.panelEinstellungen')}: ${option.groupLabel}`
                        : undefined
                    }
                    isPinned
                    onTogglePin={onTogglePin}
                    testId={`customize-pinned-remove-${option.to}`}
                    beforeFavorite={
                      <>
                        <Kurzinfo text={t('dashboard.customize.moveUp')}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            fingerziel
                            disabled={index === 0}
                            onClick={() => onMovePin(option.to, 'up')}
                            aria-label={t('dashboard.customize.moveItemUp', { name: option.label })}
                          >
                            <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </Kurzinfo>
                        <Kurzinfo text={t('dashboard.customize.moveDown')}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            fingerziel
                            disabled={index === pinnedOptions.length - 1}
                            onClick={() => onMovePin(option.to, 'down')}
                            aria-label={t('dashboard.customize.moveItemDown', { name: option.label })}
                          >
                            <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </Kurzinfo>
                      </>
                    }
                  />
                ))
              )}
            </div>
          </section>

          {panelOptions.length > 0 && (
            <section className="space-y-2.5">
              <h4 className="text-label-md font-semibold text-on-surface">
                {t('dashboard.customize.panelAreasHeading')}
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {panelOptions.map((option) => (
                  <OptionPinRow
                    key={option.to}
                    option={option}
                    isPinned={pinnedSet.has(option.to)}
                    onTogglePin={onTogglePin}
                    testId={`customize-pin-${option.to}`}
                  />
                ))}
              </div>
            </section>
          )}

          {settingsOptions.length > 0 && (
            <section className="space-y-2.5">
              <h4 className="text-label-md font-semibold text-on-surface">
                {t('dashboard.customize.settingsSectionsHeading')}
              </h4>
              <div className="grid gap-2 sm:grid-cols-2">
                {settingsOptions.map((option) => (
                  <OptionPinRow
                    key={option.to}
                    option={option}
                    subtitle={option.groupLabel}
                    isPinned={pinnedSet.has(option.to)}
                    onTogglePin={onTogglePin}
                    testId={`customize-pin-${option.to}`}
                  />
                ))}
              </div>
            </section>
          )}
        </div>

        <DialogFooter className="shrink-0 justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            fingerziel
            disabled={!isCustom}
            onClick={onReset}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            {t('dashboard.customize.reset')}
          </Button>
          <Button type="button" variant="primary" size="sm" fingerziel onClick={() => onOpenChange(false)}>
            {t('dashboard.customize.done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
