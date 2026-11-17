import { ArrowLeft, Eye, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, RoleBadge } from '@maunting/ui'
import { useRolePreviewStore } from '@/stores/rolePreviewStore'

/**
 * Globale Vorschau-Leiste im Stil von Discord ("Mit Rolle betrachten").
 *
 * Zeigt dauerhaft am oberen Rand des Panels an, welche Panel- oder Team-Rolle
 * gerade simuliert wird, und erlaubt das direkte Beenden oder Zurückkehren.
 */
export function RolePreviewBanner() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const preview = useRolePreviewStore((s) => s.preview)
  const returnPath = useRolePreviewStore((s) => s.returnPath)
  const stopPreview = useRolePreviewStore((s) => s.stopPreview)

  if (!preview) return null

  const displayName =
    preview.kind === 'panel' && preview.isSystem
      ? t(`roles.systemNames.${preview.roleName}`, { defaultValue: preview.roleName })
      : preview.roleName

  const summaryText =
    preview.kind === 'panel'
      ? t('rolePreview.permissionsCount', { count: preview.permissions.length })
      : preview.isAdmin
        ? t('teams.adminBadge')
        : t('rolePreview.teamSummary', {
            servers: Object.keys(preview.serverKeys).length,
            permissions: preview.permissionKeys.length,
          })

  const showReturnAction = Boolean(returnPath && location.pathname !== returnPath)

  const handleBackAndExit = () => {
    const target = returnPath
    stopPreview()
    if (target) navigate(target)
  }

  return (
    <div
      role="region"
      aria-label={t('rolePreview.previewActive')}
      data-testid="role-preview-banner"
      className="shrink-0 border-b border-primary/35 bg-primary/12 backdrop-blur-xl px-3.5 py-2 sm:px-6 z-30"
    >
      <div className="mx-auto flex flex-wrap items-center justify-between gap-2.5 max-w-7xl">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary border border-primary/30">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          </span>

          <span className="text-xs sm:text-sm font-medium text-on-surface">
            {t('rolePreview.bannerLabel')}
          </span>

          <RoleBadge
            name={displayName}
            color={preview.color}
            icon={preview.icon}
            size="sm"
          />

          {preview.kind === 'team' && (
            <span className="inline-flex items-center rounded-full border border-outline-variant/40 bg-surface-container-high/80 px-2.5 py-0.5 text-xs font-medium text-on-surface-variant">
              {t('rolePreview.teamContext', { team: preview.teamName })}
            </span>
          )}

          <span className="hidden sm:inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
            {summaryText}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {showReturnAction && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleBackAndExit}
              className="gap-1.5 text-xs"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{t('rolePreview.backToSource')}</span>
            </Button>
          )}
          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={stopPreview}
            className="gap-1.5 text-xs"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{t('rolePreview.exit')}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
