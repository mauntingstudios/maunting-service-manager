import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import {
  Cloud,
  CloudCog,
  Flame,
  Gamepad2,
  HardDrive,
  LifeBuoy,
  Mail,
  Megaphone,
  MessageSquare,
  Newspaper,
  Shield,
  ShieldAlert,
} from 'lucide-react'
import { SettingsLayout, TabBar, type SettingsSectionEintrag, type TabDef } from '@maunting/ui'
import { FavoriteButton } from '@/components/FavoriteButton'
import { GeneralTab } from './settings/GeneralTab'
import { EmailTab } from './settings/EmailTab'
import { SteamTab } from './settings/SteamTab'
import { CurseForgeTab } from './settings/CurseForgeTab'
import { OAuthTab } from './settings/OAuthTab'
import { BackupTab } from './settings/BackupTab'
import { ImprintTab } from './settings/ImprintTab'
import { SupportWidgetTab } from './settings/SupportWidgetTab'
import { CaptchaTab } from './settings/CaptchaTab'
import { CloudflareTab } from './settings/CloudflareTab'
import { SecurityTab } from './settings/SecurityTab'
import { AiTab, type AiSubTab } from './settings/AiTab'
import { MessengerTab } from './settings/MessengerTab'
import { ShopTab, type ShopSubTabId } from './settings/ShopTab'
import { PopupTab } from './settings/PopupTab'
import { NewsTab } from './settings/NewsTab'
import { VaultStorageTab } from './settings/VaultStorageTab'
import { useHasPermission } from '@/hooks/useHasPermission'
import {
  DEFAULT_DASHBOARD_TABS,
  MAX_DASHBOARD_TABS,
  SETTINGS_SEKTIONEN,
  resolveSettingsTarget,
  type AnnouncementsSubTab,
  type CommunicationSubTab,
  type GameIntegrationSubTab,
  type SecuritySubTab,
  type SettingsSectionId,
  type StorageSubTab,
} from '@/desktop/dashboard/dashboardWege'
import { useDashboardPreferencesStore } from '@/stores/dashboardPreferencesStore'
import { toast } from '@/stores/toastStore'

interface SubTabItem<T extends string> {
  id: T
  labelKey: string
  icon: LucideIcon
  render: () => ReactNode
}

function SettingsSubTabs<T extends string>({
  items,
  active,
  onChange,
  ariaLabel,
}: {
  items: SubTabItem<T>[]
  active: T
  onChange: (id: T) => void
  ariaLabel: string
}) {
  const { t } = useTranslation()
  const resolved = items.find((item) => item.id === active) ?? items[0]
  if (!resolved) return null

  if (items.length === 1) {
    return <>{resolved.render()}</>
  }

  const tabs: TabDef<T>[] = items.map((item) => ({
    id: item.id,
    labelKey: item.labelKey,
    icon: item.icon,
  }))

  return (
    <div className="space-y-6">
      <div className="border-b border-outline-variant/25 pb-1">
        <TabBar
          tabs={tabs}
          active={resolved.id}
          onChange={onChange}
          variante="underline"
          einzeilig
          ariaLabel={ariaLabel}
        />
      </div>
      <div role="tabpanel" aria-label={t(resolved.labelKey)}>
        {resolved.render()}
      </div>
    </div>
  )
}

export function Settings() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const canManageBackup = useHasPermission('panel.settings.write')
  const canManageNews =
    useHasPermission('panel.news.manage') ||
    useHasPermission('panel.settings.write') ||
    useHasPermission('shop.write')
  const canReadHoster = useHasPermission('panel.hoster.read')
  const canWriteHoster = useHasPermission('panel.hoster.write')

  const initial = resolveSettingsTarget(searchParams.get('tab'))
  const [activeTab, setActiveTab] = useState<SettingsSectionId>(initial.section)
  const pinnedTabs = useDashboardPreferencesStore((s) => s.pinnedTabs)
  const togglePinnedTab = useDashboardPreferencesStore((s) => s.togglePinnedTab)
  const pinnedSet = useMemo(() => new Set(pinnedTabs ?? DEFAULT_DASHBOARD_TABS), [pinnedTabs])

  const handleTogglePin = useCallback(
    (targetTo: string) => {
      const result = togglePinnedTab(targetTo)
      if (result === 'limit') {
        toast.info(t('dashboard.customize.limitReached', { max: MAX_DASHBOARD_TABS }))
      }
    },
    [togglePinnedTab, t],
  )

  const renderPinButton = useCallback(
    (targetTo: string, label: string, isPinned: boolean, testId: string) => (
      <FavoriteButton
        isFavorite={isPinned}
        onToggle={() => handleTogglePin(targetTo)}
        tooltipText={t(isPinned ? 'settings.unpinFromBar' : 'settings.pinToBar')}
        ariaLabel={t(isPinned ? 'settings.unpinSectionFromBar' : 'settings.pinSectionToBar', {
          section: label,
        })}
        testId={testId}
      />
    ),
    [handleTogglePin, t],
  )
  const [announcementsTab, setAnnouncementsTab] = useState<AnnouncementsSubTab>(
    initial.announcements ?? 'popup',
  )
  const [securityTab, setSecurityTab] = useState<SecuritySubTab>(initial.security ?? 'security')
  const [gameTab, setGameTab] = useState<GameIntegrationSubTab>(
    initial.gameIntegrations ?? 'steam',
  )
  const [shopSubTab, setShopSubTab] = useState<ShopSubTabId | undefined>(initial.shop)
  const [communicationTab, setCommunicationTab] = useState<CommunicationSubTab>(
    initial.communication ?? 'email',
  )
  const [aiSubTab, setAiSubTab] = useState<AiSubTab | undefined>(initial.ai)
  const [storageTab, setStorageTab] = useState<StorageSubTab>(initial.storage ?? 'vaultStorage')

  const applyTarget = useCallback((rawTab: string | null) => {
    if (!rawTab) return
    const target = resolveSettingsTarget(rawTab)
    setActiveTab(target.section)
    if (target.announcements) setAnnouncementsTab(target.announcements)
    if (target.security) setSecurityTab(target.security)
    if (target.gameIntegrations) setGameTab(target.gameIntegrations)
    if (target.shop) setShopSubTab(target.shop)
    if (target.communication) setCommunicationTab(target.communication)
    if (target.ai) setAiSubTab(target.ai)
    if (target.storage) setStorageTab(target.storage)
  }, [])

  useEffect(() => {
    applyTarget(searchParams.get('tab'))
  }, [searchParams, applyTarget])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: string }>).detail
      if (detail?.tab) applyTarget(detail.tab)
    }
    window.addEventListener('msm:open-settings-tab', handler)
    return () => window.removeEventListener('msm:open-settings-tab', handler)
  }, [applyTarget])

  const sections: SettingsSectionEintrag<SettingsSectionId>[] = useMemo(
    () =>
      SETTINGS_SEKTIONEN.map((sektion) => {
        const label = sektion.altLabelKey && canReadHoster ? t(sektion.altLabelKey) : t(sektion.labelKey)
        const isPinned = pinnedSet.has(sektion.to)
        return {
          id: sektion.id,
          label,
          icon: sektion.icon,
          group: t(sektion.groupKey),
          highlighted: isPinned,
          trailing: renderPinButton(sektion.to, label, isPinned, `pin-settings-${sektion.id}`),
        }
      }),
    [canReadHoster, pinnedSet, renderPinButton, t],
  )

  const aktiv = sections.some((section) => section.id === activeTab) ? activeTab : 'general'
  const aktivSektion = sections.find((section) => section.id === aktiv) ?? sections[0]
  const aktivTarget = `/settings?tab=${aktiv}`
  const aktivPinned = pinnedSet.has(aktivTarget)

  const announcementsItems: SubTabItem<AnnouncementsSubTab>[] = [
    { id: 'popup', labelKey: 'settings.tabs.popup', icon: Megaphone, render: () => <PopupTab /> },
    ...(canManageNews
      ? [{ id: 'news' as const, labelKey: 'settings.tabs.news', icon: Newspaper, render: () => <NewsTab /> }]
      : []),
  ]

  const securityItems: SubTabItem<SecuritySubTab>[] = [
    { id: 'security', labelKey: 'settings.tabs.security', icon: ShieldAlert, render: () => <SecurityTab /> },
    { id: 'captcha', labelKey: 'settings.tabs.captcha', icon: Shield, render: () => <CaptchaTab /> },
    { id: 'cloudflare', labelKey: 'settings.tabs.cloudflare', icon: CloudCog, render: () => <CloudflareTab /> },
  ]

  const gameItems: SubTabItem<GameIntegrationSubTab>[] = [
    { id: 'steam', labelKey: 'settings.tabs.steam', icon: Gamepad2, render: () => <SteamTab /> },
    { id: 'curseforge', labelKey: 'settings.tabs.curseforge', icon: Flame, render: () => <CurseForgeTab /> },
  ]

  const communicationItems: SubTabItem<CommunicationSubTab>[] = [
    { id: 'email', labelKey: 'settings.tabs.email', icon: Mail, render: () => <EmailTab /> },
    { id: 'messenger', labelKey: 'settings.tabs.messenger', icon: MessageSquare, render: () => <MessengerTab /> },
    { id: 'supportWidget', labelKey: 'settings.tabs.supportWidget', icon: LifeBuoy, render: () => <SupportWidgetTab /> },
  ]

  const storageItems: SubTabItem<StorageSubTab>[] = [
    { id: 'vaultStorage', labelKey: 'settings.tabs.vaultStorage', icon: HardDrive, render: () => <VaultStorageTab /> },
    ...(canManageBackup
      ? [{ id: 'backup' as const, labelKey: 'settings.tabs.backup', icon: Cloud, render: () => <BackupTab /> }]
      : []),
  ]

  const handleSectionChange = useCallback((section: SettingsSectionId) => {
    setActiveTab(section)
    if (section !== 'shop') setShopSubTab(undefined)
    if (section !== 'ai') setAiSubTab(undefined)
  }, [])

  return (
    <div className="msm-page">
      <SettingsLayout
        sections={sections}
        active={aktiv}
        onChange={handleSectionChange}
        title={t('common.settings')}
        description={t('settings.subtitle')}
      >
        {aktivSektion && (
          <div className="flex items-center justify-between gap-2 rounded-control border border-outline-variant/35 bg-surface-container-low/60 px-3 py-1.5 lg:hidden">
            <span className="truncate text-label-md font-medium text-on-surface">{aktivSektion.label}</span>
            {renderPinButton(aktivTarget, aktivSektion.label, aktivPinned, `pin-settings-mobile-${aktiv}`)}
          </div>
        )}
        {aktiv === 'general' && <GeneralTab />}
        {aktiv === 'imprint' && <ImprintTab />}
        {aktiv === 'announcements' && (
          <SettingsSubTabs
            items={announcementsItems}
            active={announcementsTab}
            onChange={setAnnouncementsTab}
            ariaLabel={t('settings.tabs.announcements')}
          />
        )}
        {aktiv === 'security' && (
          <SettingsSubTabs
            items={securityItems}
            active={securityTab}
            onChange={setSecurityTab}
            ariaLabel={t('settings.tabs.security')}
          />
        )}
        {aktiv === 'oauth' && <OAuthTab />}
        {aktiv === 'gameIntegrations' && (
          <SettingsSubTabs
            items={gameItems}
            active={gameTab}
            onChange={setGameTab}
            ariaLabel={t('settings.tabs.gameIntegrations')}
          />
        )}
        {aktiv === 'shop' && (
          <ShopTab
            canReadHoster={canReadHoster}
            canWriteHoster={canWriteHoster}
            initialTab={shopSubTab}
          />
        )}
        {aktiv === 'communication' && (
          <SettingsSubTabs
            items={communicationItems}
            active={communicationTab}
            onChange={setCommunicationTab}
            ariaLabel={t('settings.tabs.communication')}
          />
        )}
        {aktiv === 'ai' && (
          <AiTab includeSearchEngine initialTab={aiSubTab} />
        )}
        {aktiv === 'storage' && (
          <SettingsSubTabs
            items={storageItems}
            active={storageTab}
            onChange={setStorageTab}
            ariaLabel={t('settings.tabs.storage')}
          />
        )}
      </SettingsLayout>
    </div>
  )
}
