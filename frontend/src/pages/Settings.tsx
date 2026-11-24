import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Globe, Mail, Gamepad2, Flame, KeyRound, Shield, Cloud, FileText, LifeBuoy, ShieldAlert, Bot, Plug, Megaphone, Newspaper, CloudCog, MessageSquare, HardDrive, Search, ShoppingBag } from 'lucide-react'
import { SettingsLayout, type SettingsSectionEintrag } from '@maunting/ui'
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
import { AiTab } from './settings/AiTab'
import { SearchEngineTab } from './settings/SearchEngineTab'
import { MessengerTab } from './settings/MessengerTab'
import { HosterTab } from './settings/HosterTab'
import { ShopTab } from './settings/ShopTab'
import { PopupTab } from './settings/PopupTab'
import { NewsTab } from './settings/NewsTab'
import { VaultStorageTab } from './settings/VaultStorageTab'
import { useHasPermission } from '@/hooks/useHasPermission'

type TabId =
  | 'general'
  | 'email'
  | 'steam'
  | 'curseforge'
  | 'oauth'
  | 'imprint'
  | 'captcha'
  | 'cloudflare'
  | 'supportWidget'
  | 'backup'
  | 'security'
  | 'searchEngine'
  | 'ai'
  | 'vaultStorage'
  | 'messenger'
  | 'popup'
  | 'news'
  | 'hoster'
  | 'shop'

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
  const initialTab = (searchParams.get('tab') as TabId | null) || 'general'
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)

  useEffect(() => {
    const queryTab = searchParams.get('tab') as TabId | null
    if (queryTab) setActiveTab(queryTab)
  }, [searchParams])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: TabId }>).detail
      if (detail?.tab) setActiveTab(detail.tab)
    }
    window.addEventListener('msm:open-settings-tab', handler)
    return () => window.removeEventListener('msm:open-settings-tab', handler)
  }, [])

  const sections: SettingsSectionEintrag<TabId>[] = [
    { id: 'general', label: t('settings.tabs.general'), icon: Globe, group: t('settings.groups.basis') },
    { id: 'imprint', label: t('settings.tabs.imprint'), icon: FileText, group: t('settings.groups.basis') },
    { id: 'security', label: t('settings.tabs.security'), icon: ShieldAlert, group: t('settings.groups.sicherheit') },
    { id: 'captcha', label: t('settings.tabs.captcha'), icon: Shield, group: t('settings.groups.sicherheit') },
    { id: 'cloudflare', label: t('settings.tabs.cloudflare'), icon: CloudCog, group: t('settings.groups.sicherheit') },
    { id: 'oauth', label: t('settings.tabs.oauth'), icon: KeyRound, group: t('settings.groups.verbindungen') },
    { id: 'steam', label: t('settings.tabs.steam'), icon: Gamepad2, group: t('settings.groups.verbindungen') },
    { id: 'curseforge', label: t('settings.tabs.curseforge'), icon: Flame, group: t('settings.groups.verbindungen') },
    ...(canReadHoster
      ? [{ id: 'hoster' as const, label: t('settings.tabs.hoster'), icon: Plug, group: t('settings.groups.verbindungen') }]
      : []),
    { id: 'shop', label: t('settings.tabs.shop'), icon: ShoppingBag, group: t('settings.groups.erweitert') },
    { id: 'email', label: t('settings.tabs.email'), icon: Mail, group: t('settings.groups.kommunikation') },
    { id: 'messenger', label: t('settings.tabs.messenger'), icon: MessageSquare, group: t('settings.groups.kommunikation') },
    { id: 'searchEngine', label: t('settings.tabs.searchEngine'), icon: Search, group: t('settings.groups.kommunikation') },
    { id: 'ai', label: t('settings.tabs.ai'), icon: Bot, group: t('settings.groups.kommunikation') },
    { id: 'vaultStorage', label: t('settings.tabs.vaultStorage'), icon: HardDrive, group: t('settings.groups.daten') },
    ...(canManageBackup
      ? [{ id: 'backup' as const, label: t('settings.tabs.backup'), icon: Cloud, group: t('settings.groups.daten') }]
      : []),
    { id: 'supportWidget', label: t('settings.tabs.supportWidget'), icon: LifeBuoy, group: t('settings.groups.erweitert') },
    { id: 'popup', label: t('settings.tabs.popup'), icon: Megaphone, group: t('settings.groups.erweitert') },
    ...(canManageNews
      ? [{ id: 'news' as const, label: t('settings.tabs.news'), icon: Newspaper, group: t('settings.groups.erweitert') }]
      : []),
  ]

  const aktiv = sections.some((section) => section.id === activeTab) ? activeTab : 'general'

  return (
    <div className="msm-page">
      <SettingsLayout
        sections={sections}
        active={aktiv}
        onChange={setActiveTab}
        title={t('common.settings')}
        description={t('settings.subtitle')}
      >
        {aktiv === 'general' && <GeneralTab />}
        {aktiv === 'email' && <EmailTab />}
        {aktiv === 'steam' && <SteamTab />}
        {aktiv === 'curseforge' && <CurseForgeTab />}
        {aktiv === 'oauth' && <OAuthTab />}
        {aktiv === 'captcha' && <CaptchaTab />}
        {aktiv === 'cloudflare' && <CloudflareTab />}
        {aktiv === 'imprint' && <ImprintTab />}
        {aktiv === 'supportWidget' && <SupportWidgetTab />}
        {aktiv === 'popup' && <PopupTab />}
        {aktiv === 'news' && canManageNews && <NewsTab />}
        {aktiv === 'backup' && <BackupTab />}
        {aktiv === 'security' && <SecurityTab />}
        {aktiv === 'searchEngine' && <SearchEngineTab />}
        {aktiv === 'ai' && <AiTab />}
        {aktiv === 'vaultStorage' && <VaultStorageTab />}
        {aktiv === 'messenger' && <MessengerTab />}
        {aktiv === 'hoster' && canReadHoster && <HosterTab canWrite={canWriteHoster} />}
        {aktiv === 'shop' && <ShopTab />}
      </SettingsLayout>
    </div>
  )
}
