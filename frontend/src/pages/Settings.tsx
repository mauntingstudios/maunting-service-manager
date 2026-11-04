import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Mail, Gamepad2, Flame, KeyRound, Shield, Github, Cloud, FileText, LifeBuoy, ShieldAlert, Bot, Plug, Megaphone, CloudCog, MessageSquare, HardDrive, Search } from 'lucide-react'
import { TabBar, type TabDef } from '@/components/ui/TabBar'
import { PageHeader } from '@/Singra/UI/PageHeader'
import { GeneralTab } from './settings/GeneralTab'
import { EmailTab } from './settings/EmailTab'
import { SteamTab } from './settings/SteamTab'
import { CurseForgeTab } from './settings/CurseForgeTab'
import { OAuthTab } from './settings/OAuthTab'
import { GitHubTab } from './settings/GitHubTab'
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
import { PopupTab } from './settings/PopupTab'
import { VaultStorageTab } from './settings/VaultStorageTab'
import { useHasPermission } from '@/hooks/useHasPermission'

type TabId =
  | 'general'
  | 'email'
  | 'steam'
  | 'curseforge'
  | 'github'
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
  | 'hoster'

export function Settings() {
  const { t } = useTranslation()
  const canManageBackup = useHasPermission('panel.settings.write')
  // Der Hoster-Tab erscheint nur, wenn die Anbindung ueberhaupt sichtbar ist.
  // Self-Hosted-Betreiber ohne Shop sollen den Bereich gar nicht erst sehen.
  const canReadHoster = useHasPermission('panel.hoster.read')
  const canWriteHoster = useHasPermission('panel.hoster.write')
  const [activeTab, setActiveTab] = useState<TabId>('general')

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tab?: TabId }>).detail
      if (detail?.tab) {
        setActiveTab(detail.tab)
      }
    }
    window.addEventListener('msm:open-settings-tab', handler)
    return () => window.removeEventListener('msm:open-settings-tab', handler)
  }, [])

  // Backup-Tab: panel.settings.write.
  // Security-Tab: immer sichtbar (Rate-Limits für panel.settings.*;
  // Cluster-Rotation bleibt im Tab selbst auf system.secrets.rotate beschränkt).
  // Sechs Gruppen, nur Reihenfolge und Trenner — Rechte, Inhalte und die
  // `msm:open-settings-tab`-Namen bleiben.
  const tabs: TabDef<TabId>[] = [
    { id: 'general', labelKey: 'settings.tabs.general', icon: Globe, group: 'basis' },
    { id: 'email', labelKey: 'settings.tabs.email', icon: Mail, group: 'basis' },
    { id: 'messenger', labelKey: 'settings.tabs.messenger', icon: MessageSquare, group: 'kommunikation' },
    { id: 'searchEngine', labelKey: 'settings.tabs.searchEngine', icon: Search, group: 'kommunikation' },
    { id: 'ai', labelKey: 'settings.tabs.ai', icon: Bot, group: 'kommunikation' },
    { id: 'vaultStorage', labelKey: 'settings.tabs.vaultStorage', icon: HardDrive, group: 'daten' },
    ...(canManageBackup ? [{ id: 'backup' as TabId, labelKey: 'settings.tabs.backup', icon: Cloud, group: 'daten' }] : []),
    { id: 'security', labelKey: 'settings.tabs.security', icon: ShieldAlert, group: 'schutz' },
    { id: 'captcha', labelKey: 'settings.tabs.captcha', icon: Shield, group: 'schutz' },
    { id: 'cloudflare', labelKey: 'settings.tabs.cloudflare', icon: CloudCog, group: 'schutz' },
    { id: 'oauth', labelKey: 'settings.tabs.oauth', icon: KeyRound, group: 'anbindung' },
    { id: 'steam', labelKey: 'settings.tabs.steam', icon: Gamepad2, group: 'anbindung' },
    { id: 'curseforge', labelKey: 'settings.tabs.curseforge', icon: Flame, group: 'anbindung' },
    { id: 'github', labelKey: 'settings.tabs.github', icon: Github, group: 'anbindung' },
    ...(canReadHoster ? [{ id: 'hoster' as TabId, labelKey: 'settings.tabs.hoster', icon: Plug, group: 'anbindung' }] : []),
    { id: 'imprint', labelKey: 'settings.tabs.imprint', icon: FileText, group: 'auftritt' },
    { id: 'supportWidget', labelKey: 'settings.tabs.supportWidget', icon: LifeBuoy, group: 'auftritt' },
    { id: 'popup', labelKey: 'settings.tabs.popup', icon: Megaphone, group: 'auftritt' },
  ]

  return (
    <div className="msm-page">
      <PageHeader eyebrow={t('pageContext.panel')} title={t('settings.title')} description={t('settings.subtitle')} status={<span className="msm-badge-info">{t(`settings.tabs.${activeTab}`)}</span>} />

      <TabBar
        tabs={tabs}
        active={activeTab}
        onChange={setActiveTab}
        ariaLabel={t('settings.title')}
      />

      {activeTab === 'general' && <GeneralTab />}
      {activeTab === 'email' && <EmailTab />}
      {activeTab === 'steam' && <SteamTab />}
      {activeTab === 'curseforge' && <CurseForgeTab />}
      {activeTab === 'github' && <GitHubTab />}
      {activeTab === 'oauth' && <OAuthTab />}
      {activeTab === 'captcha' && <CaptchaTab />}
      {activeTab === 'cloudflare' && <CloudflareTab />}
      {activeTab === 'imprint' && <ImprintTab />}
      {activeTab === 'supportWidget' && <SupportWidgetTab />}
      {activeTab === 'popup' && <PopupTab />}
      {activeTab === 'backup' && <BackupTab />}
      {activeTab === 'security' && <SecurityTab />}
      {activeTab === 'searchEngine' && <SearchEngineTab />}
      {activeTab === 'ai' && <AiTab />}
      {activeTab === 'vaultStorage' && <VaultStorageTab />}
      {activeTab === 'messenger' && <MessengerTab />}
      {activeTab === 'hoster' && canReadHoster && <HosterTab canWrite={canWriteHoster} />}
    </div>
  )
}
