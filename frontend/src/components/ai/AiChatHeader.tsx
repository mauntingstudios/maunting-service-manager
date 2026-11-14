import { CalendarClock, ChevronLeft, ChevronRight, Menu, MoreHorizontal, Plus, RotateCw, ShieldAlert, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { AiProviderAvailable } from '@/api/ai'
import { Button, Dropdown, Kurzinfo } from '@maunting/ui'
import { AiAutonomyButton } from './AiAutonomyButton'
import { AI_IS_BETA } from './AiBetaBanner'
import { AiChatMenue } from './AiChatMenue'
import type { Denkwahl } from './AiModellBlatt'
import { ReasoningPicker } from './ReasoningPicker'

interface ServerOption {
  id: number
  name: string
}

interface AiChatHeaderProps {
  singraShell: boolean
  eingebettet: boolean
  isSidebarCollapsed: boolean
  onToggleSidebar?: () => void
  onOpenMobileMenu?: () => void
  activeProjectName?: string | null
  currentConversationTitle: string | null
  availableProviders: AiProviderAvailable[]
  providerId: number | null
  onSelectProvider: (wert: string) => void
  aktiverProviderMitModell: AiProviderAvailable | null
  denken: Denkwahl
  onSelectDenken: (wahl: Denkwahl) => void
  busy: boolean
  streaming: boolean
  reloading: boolean
  empty: boolean
  canUseAutonomy: boolean
  servers: ServerOption[]
  scopeKind: 'primary' | 'docs'
  canUseSkills: boolean
  onOpenSkills: () => void
  showTasks: boolean
  canTasks: boolean
  showGuardian: boolean
  onSwitchMode?: (mode: 'sprache' | 'guardian' | 'aufgaben') => void
  onReload: () => void
  onNewChat?: () => void
  menueOffen: boolean
  setMenueOffen: (open: boolean) => void
  onOpenHistorySearch?: () => void
  onOpenGeo: () => void
  onOpenWallpaper: () => void
  onClearHistory: () => void
  geoOpen: boolean
  hasGeoData: boolean
}

export function AiChatHeader({
  singraShell,
  eingebettet,
  isSidebarCollapsed,
  onToggleSidebar,
  onOpenMobileMenu,
  activeProjectName,
  currentConversationTitle,
  availableProviders,
  providerId,
  onSelectProvider,
  aktiverProviderMitModell,
  denken,
  onSelectDenken,
  busy,
  streaming,
  reloading,
  empty,
  canUseAutonomy,
  servers,
  scopeKind,
  canUseSkills,
  onOpenSkills,
  showTasks,
  canTasks,
  showGuardian,
  onSwitchMode,
  onReload,
  onNewChat,
  menueOffen,
  setMenueOffen,
  onOpenHistorySearch,
  onOpenGeo,
  onOpenWallpaper,
  onClearHistory,
  geoOpen,
  hasGeoData,
}: AiChatHeaderProps) {
  const { t } = useTranslation()

  return (
    <header
      className={`flex items-center justify-between z-20 gap-2 min-w-0 transition-colors ${
        singraShell
          ? 'pointer-events-none absolute inset-x-0 top-0 px-3 pt-2.5 sm:px-4'
          : 'border-b px-3 py-2 sm:px-4 sm:py-2.5 shrink-0 sticky top-0 border-outline-variant/30 bg-surface-container-low'
      } ${
        eingebettet ? 'flex-wrap gap-y-1' : ''
      }`}
    >
      <div className={`flex min-w-0 flex-1 items-center gap-2 py-0.5 ${singraShell ? 'pointer-events-auto' : ''}`}>
        {singraShell && onToggleSidebar && (
          <Kurzinfo text={isSidebarCollapsed ? 'Seitenleiste einblenden' : 'Seitenleiste einklappen'}>
            <button
              type="button"
              onClick={onToggleSidebar}
              className="hidden lg:flex h-10 w-10 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high/85 hover:bg-surface-container-high text-on-surface hover:text-primary border border-outline-variant/30 backdrop-blur-md shadow-sm transition-all active:scale-95"
              aria-label={isSidebarCollapsed ? 'Seitenleiste einblenden' : 'Seitenleiste einklappen'}
            >
              {isSidebarCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </button>
          </Kurzinfo>
        )}

        {singraShell && onOpenMobileMenu && (
          <Kurzinfo text="Navigation öffnen">
            <button
              type="button"
              onClick={onOpenMobileMenu}
              className="lg:hidden flex h-10 w-10 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high/85 hover:bg-surface-container-high text-on-surface hover:text-primary border border-outline-variant/30 backdrop-blur-md shadow-sm transition-all active:scale-95"
              aria-label="Singra Navigation öffnen"
            >
              <Menu className="h-5 w-5" />
            </button>
          </Kurzinfo>
        )}

        <div
          className={`flex items-center gap-2 min-w-0 ${
            singraShell
              ? 'rounded-full bg-surface-container-high/85 border border-outline-variant/30 backdrop-blur-md px-3 py-1 shadow-sm'
              : ''
          }`}
        >
          <span className="font-semibold text-xs sm:text-sm text-on-surface truncate">
            {activeProjectName
              ? `Projekt: ${activeProjectName}${currentConversationTitle && currentConversationTitle !== activeProjectName ? ` • ${currentConversationTitle}` : ''}`
              : (currentConversationTitle || t('ai.chat.title'))}
          </span>
          {!singraShell && AI_IS_BETA && (
            <span className="px-1.5 py-0.5 rounded bg-status-warning/15 text-status-warning border border-status-warning/30 text-label-sm font-bold uppercase tracking-wider shrink-0">
              {t('ai.betaBadge', 'Beta')}
            </span>
          )}
        </div>

        {!singraShell && availableProviders.length > 0 && (
          <div className="shrink-0 min-w-[7rem] max-w-[11rem]">
            <Dropdown
              value={String(providerId ?? '')}
              onChange={onSelectProvider}
              options={availableProviders.map((p) => ({ value: String(p.id), label: p.name }))}
              aria-label={t('ai.chat.selectProvider', 'Provider auswählen')}
            />
          </div>
        )}

        {!singraShell && (
          <div className="shrink-0">
            <ReasoningPicker
              provider={aktiverProviderMitModell}
              wahl={denken}
              onChange={onSelectDenken}
              disabled={busy}
            />
          </div>
        )}

        {!singraShell && canUseAutonomy && (
          <div className="shrink-0">
            <AiAutonomyButton
              servers={servers}
              disabled={busy}
              bereich={scopeKind === 'docs' ? 'docs' : 'panel'}
            />
          </div>
        )}

        {!singraShell && canUseSkills && (
          <Kurzinfo text={t('ai.skills.directoryTitle')} className="xl:!hidden" aussen="shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onOpenSkills}
              className="h-8 px-2 text-xs flex items-center gap-1.5 border border-outline-variant/30 text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 rounded-lg transition-colors"
              aria-label={t('ai.skills.directoryTitle')}
            >
              <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
              <span className="hidden xl:inline">{t('ai.skills.directoryTitle')}</span>
            </Button>
          </Kurzinfo>
        )}

        {!singraShell && ((showTasks && canTasks) || (showGuardian && onSwitchMode)) && (
          <div className="flex items-center rounded-lg border border-outline-variant/30 bg-surface-container/50 p-0.5 shrink-0">
            {showTasks && canTasks && onSwitchMode && (
              <Kurzinfo text={t('ai.tasks.toTasks')} className="xl:!hidden">
                <button
                  type="button"
                  onClick={() => onSwitchMode('aufgaben')}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 transition-colors"
                  aria-label={t('ai.tasks.toTasks')}
                >
                  <CalendarClock className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
                  <span className="hidden xl:inline">Aufgaben</span>
                </button>
              </Kurzinfo>
            )}

            {showGuardian && onSwitchMode && (
              <Kurzinfo text={t('ai.guardian.toGuardianMode')} className="xl:!hidden">
                <button
                  type="button"
                  onClick={() => onSwitchMode('guardian')}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60 transition-colors"
                  aria-label={t('ai.guardian.toGuardianMode')}
                >
                  <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
                  <span className="hidden xl:inline">Guardian</span>
                </button>
              </Kurzinfo>
            )}
          </div>
        )}
      </div>

      <div className={`flex items-center gap-1.5 shrink-0 ml-1 ${singraShell ? 'pointer-events-auto' : ''}`}>
        {!singraShell && (
          <Kurzinfo text={t('common.refresh', 'Aktualisieren')}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              disabled={busy || streaming}
              onClick={onReload}
              aria-label={t('common.refresh', 'Aktualisieren')}
            >
              <RotateCw className={`h-4 w-4 ${reloading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </Button>
          </Kurzinfo>
        )}

        {onNewChat && (
          <Kurzinfo text="Neuer Chat">
            <button
              type="button"
              onClick={onNewChat}
              className="lg:hidden flex h-10 w-10 sm:h-9 sm:w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-high/85 hover:bg-surface-container-high text-on-surface hover:text-primary border border-outline-variant/30 backdrop-blur-md shadow-sm transition-all active:scale-95"
              aria-label="Neuer Chat"
            >
              <Plus className="h-4 w-4" />
            </button>
          </Kurzinfo>
        )}

        <Kurzinfo text={t('ai.chat.moreSettings')} seite="ende" portal>
          <button
            type="button"
            onClick={() => setMenueOffen(true)}
            className="flex items-center justify-center rounded-full h-10 w-10 sm:h-9 sm:w-9 bg-surface-container-high/85 hover:bg-surface-container-high text-on-surface hover:text-primary border border-outline-variant/30 backdrop-blur-md shadow-sm transition-all active:scale-95 shrink-0"
            aria-haspopup="dialog"
            aria-expanded={menueOffen}
            aria-label={t('ai.chat.moreSettings')}
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </Kurzinfo>

        <AiChatMenue
          offen={menueOffen}
          onSchliessen={() => setMenueOffen(false)}
          onNewChat={onNewChat}
          onOpenHistorySearch={onOpenHistorySearch}
          onOpenGeo={onOpenGeo}
          onOpenWallpaper={onOpenWallpaper}
          onClearHistory={onClearHistory}
          singraShell={singraShell}
          busy={busy}
          streaming={streaming}
          reloading={reloading}
          empty={empty}
          geoOpen={geoOpen}
          hasGeoData={hasGeoData}
          onReload={onReload}
        />
      </div>
    </header>
  )
}
