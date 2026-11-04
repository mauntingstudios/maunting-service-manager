import { useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { User, Users, Shield, Link2, AlertTriangle, Bot, Mail, Volume2 } from 'lucide-react'
import { SettingsLayout, type SettingsSectionEintrag } from '@maunting/ui'
import { ProfilTab } from './profile/ProfilTab'
import { KontoTab } from './profile/KontoTab'
import { SocialTab } from './profile/SocialTab'
import { AudioTab } from './profile/AudioTab'
import { PasswordTab } from './profile/PasswordTab'
import { TwoFactorTab } from './profile/TwoFactorTab'
import { LinkedAccountsTab } from './profile/LinkedAccountsTab'
import { DangerZoneTab } from './profile/DangerZoneTab'
import { AiTab } from './profile/AiTab'
import { DevicesTab } from './profile/DevicesTab'
import { CredentialsTab } from './profile/CredentialsTab'
import { MessengerSicherheitTab } from './profile/MessengerSicherheitTab'
import { TresorSicherheitTab } from '@/desktop/vault/TresorSicherheitTab'
import { useHasPermission } from '@/hooks/useHasPermission'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

type TabId = 'profile' | 'account' | 'security' | 'social' | 'connections' | 'audio' | 'ai' | 'danger'

const FRUEHERE_REITER: Record<string, TabId> = {
  password: 'security',
  '2fa': 'security',
  messenger: 'security',
  devices: 'security',
  linked: 'connections',
  credentials: 'connections',
}

export function Profile() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const canUseAi = useHasPermission('ai.chat.use')
  const publicSettings = usePublicSettingsStore()
  const social = publicSettings.social_enabled

  const sections: SettingsSectionEintrag<TabId>[] = [
    { id: 'profile', label: t('profile.tabs.profile'), icon: User, group: t('profile.groups.identitaet') },
    { id: 'account', label: t('profile.tabs.account'), icon: Mail, group: t('profile.groups.identitaet') },
    { id: 'security', label: t('profile.tabs.security'), icon: Shield, group: t('profile.groups.schutz') },
    ...(social ? [{ id: 'social' as const, label: t('profile.tabs.social'), icon: Users, group: t('profile.groups.schutz') }] : []),
    { id: 'connections', label: t('profile.tabs.connections'), icon: Link2, group: t('profile.groups.schutz') },
    { id: 'audio', label: t('profile.tabs.audio'), icon: Volume2, group: t('profile.groups.arbeit') },
    ...(canUseAi ? [{ id: 'ai' as const, label: t('profile.tabs.ai'), icon: Bot, group: t('profile.groups.arbeit') }] : []),
    { id: 'danger', label: t('profile.tabs.danger'), icon: AlertTriangle, tone: 'danger', group: t('profile.groups.gefahr') },
  ]

  const wunsch = searchParams.get('tab') ?? ''
  const aufgeloest = FRUEHERE_REITER[wunsch] ?? wunsch
  const activeTab: TabId = sections.some((section) => section.id === aufgeloest) ? (aufgeloest as TabId) : 'profile'

  const waehle = (tab: TabId) => setSearchParams({ tab }, { replace: true })

  return (
    <div className="msm-page">
      <SettingsLayout
        sections={sections}
        active={activeTab}
        onChange={waehle}
        title={t('profile.title')}
        description={t('profile.subtitle')}
      >
        {activeTab === 'profile' && <ProfilTab social={social} />}
        {activeTab === 'account' && <KontoTab />}
        {activeTab === 'security' && (
          <div className="space-y-6">
            <PasswordTab />
            <TwoFactorTab />
            {social && <MessengerSicherheitTab />}
            {typeof window !== 'undefined' &&
              ('__TAURI_INTERNALS__' in window || '__TAURI__' in window) &&
              publicSettings.vault_enabled && <TresorSicherheitTab />}
            <DevicesTab />
          </div>
        )}
        {activeTab === 'social' && <SocialTab />}
        {activeTab === 'connections' && (
          <div className="space-y-6">
            <LinkedAccountsTab />
            <CredentialsTab />
          </div>
        )}
        {activeTab === 'audio' && <AudioTab />}
        {activeTab === 'ai' && <AiTab />}
        {activeTab === 'danger' && <DangerZoneTab />}
      </SettingsLayout>
    </div>
  )
}
