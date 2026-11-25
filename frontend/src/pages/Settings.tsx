import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import {
  Bot,
  Cloud,
  CloudCog,
  FileText,
  Flame,
  Gamepad2,
  Globe,
  HardDrive,
  KeyRound,
  LifeBuoy,
  Mail,
  Megaphone,
  MessageSquare,
  Newspaper,
  Shield,
  ShieldAlert,
  ShoppingBag,
} from 'lucide-react'
import { SettingsLayout, TabBar, type SettingsSectionEintrag, type TabDef } from '@maunting/ui'
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

type SectionId =
  | 'general'
  | 'imprint'
  | 'announcements'
  | 'security'
  | 'oauth'
  | 'gameIntegrations'
  | 'shop'
  | 'communication'
  | 'ai'
  | 'storage'

type SecuritySubTab = 'security' | 'captcha' | 'cloudflare'
type GameIntegrationSubTab = 'steam' | 'curseforge'
type CommunicationSubTab = 'email' | 'messenger' | 'supportWidget'
type AnnouncementsSubTab = 'popup' | 'news'
type StorageSubTab = 'vaultStorage' | 'backup'

interface ResolvedTarget {
  section: SectionId
  announcements?: AnnouncementsSubTab
  security?: SecuritySubTab
  gameIntegrations?: GameIntegrationSubTab
  shop?: ShopSubTabId
  communication?: CommunicationSubTab
  ai?: AiSubTab
  storage?: StorageSubTab
}

/**
 * Löst sowohl gebündelte Bereichs-IDs als auch historische `?tab=...`-Deep-Links
 * (z. B. `news`, `captcha`, `hoster`) auf den passenden Hauptbereich und Sub-Tab auf.
 */
function resolveSettingsTarget(rawTab: string | null): ResolvedTarget {
  switch (rawTab) {
    case 'imprint':
      return { section: 'imprint' }
    case 'announcements':
    case 'popup':
      return { section: 'announcements', announcements: 'popup' }
    case 'news':
      return { section: 'announcements', announcements: 'news' }
    case 'security':
      return { section: 'security', security: 'security' }
    case 'captcha':
      return { section: 'security', security: 'captcha' }
    case 'cloudflare':
      return { section: 'security', security: 'cloudflare' }
    case 'oauth':
      return { section: 'oauth' }
    case 'gameIntegrations':
    case 'steam':
      return { section: 'gameIntegrations', gameIntegrations: 'steam' }
    case 'curseforge':
      return { section: 'gameIntegrations', gameIntegrations: 'curseforge' }
    case 'shop':
      return { section: 'shop', shop: 'overview' }
    case 'hoster':
      return { section: 'shop', shop: 'hoster' }
    case 'communication':
    case 'email':
      return { section: 'communication', communication: 'email' }
    case 'messenger':
      return { section: 'communication', communication: 'messenger' }
    case 'supportWidget':
      return { section: 'communication', communication: 'supportWidget' }
    case 'ai':
      return { section: 'ai', ai: 'providers' }
    case 'searchEngine':
      return { section: 'ai', ai: 'searchEngine' }
    case 'storage':
    case 'vaultStorage':
      return { section: 'storage', storage: 'vaultStorage' }
    case 'backup':
      return { section: 'storage', storage: 'backup' }
    case 'general':
    default:
      return { section: 'general' }
  }
}

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
  const [activeTab, setActiveTab] = useState<SectionId>(initial.section)
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

  const sections: SettingsSectionEintrag<SectionId>[] = [
    { id: 'general', label: t('settings.tabs.general'), icon: Globe, group: t('settings.groups.basis') },
    { id: 'imprint', label: t('settings.tabs.imprint'), icon: FileText, group: t('settings.groups.basis') },
    { id: 'announcements', label: t('settings.tabs.announcements'), icon: Megaphone, group: t('settings.groups.basis') },
    { id: 'security', label: t('settings.tabs.security'), icon: ShieldAlert, group: t('settings.groups.sicherheit') },
    { id: 'oauth', label: t('settings.tabs.oauth'), icon: KeyRound, group: t('settings.groups.sicherheit') },
    { id: 'gameIntegrations', label: t('settings.tabs.gameIntegrations'), icon: Gamepad2, group: t('settings.groups.verbindungen') },
    {
      id: 'shop',
      label: canReadHoster ? t('settings.tabs.shopAndHoster') : t('settings.tabs.shop'),
      icon: ShoppingBag,
      group: t('settings.groups.verbindungen'),
    },
    { id: 'communication', label: t('settings.tabs.communication'), icon: Mail, group: t('settings.groups.verbindungen') },
    { id: 'ai', label: t('settings.tabs.aiAndSearch'), icon: Bot, group: t('settings.groups.verbindungen') },
    { id: 'storage', label: t('settings.tabs.storage'), icon: HardDrive, group: t('settings.groups.daten') },
  ]

  const aktiv = sections.some((section) => section.id === activeTab) ? activeTab : 'general'

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

  const handleSectionChange = useCallback((section: SectionId) => {
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
