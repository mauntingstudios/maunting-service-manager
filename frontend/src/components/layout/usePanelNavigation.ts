import { useTranslation } from 'react-i18next'

import { useHasPermission } from '@/hooks/useHasPermission'
import { useIsOnline } from '@/hooks/useIsOnline'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { useTeamInvitationStore } from '@/stores/teamInvitationStore'
import { buildNavigation, type NavigationItem } from './navigation'

/**
 * Die Navigation des Panels samt ihrer Sichtbarkeitsregeln.
 *
 * Die Seitenleiste im Web und das Dashboard in der App lesen dieselbe Quelle.
 * Wer eine Route, ein Recht oder eine Gruppe ändert, ändert damit beide
 * Oberflächen — es gibt keinen zweiten Nachbau der Regeln.
 */
export function usePanelNavigation(): { items: NavigationItem[]; isOnline: boolean } {
  const { t } = useTranslation()
  const user = useAuthStore((s) => s.user)

  // Alle Rechteabfragen laufen unbedingt: hinter `||` verschwände ein Hook,
  // sobald ein Recht dazukommt, und React bricht ab.
  const hasUsersRead = useHasPermission('users.read')
  const hasUsersManage = useHasPermission('users.manage')
  const canManageUsers = hasUsersRead || hasUsersManage
  const canManageRoles = useHasPermission('roles.manage')
  const canViewAudit = useHasPermission('system.audit.read')
  const canViewSettings = useHasPermission('panel.settings.read')
  const canManagePanelBackups = useHasPermission('panel.settings.write')
  const canReadPanelDatabase = useHasPermission('panel.database.read')
  const canReadNodes = useHasPermission('nodes.read')
  const canManageNodes = useHasPermission('nodes.manage')
  const canChatWithAi = useHasPermission('ai.chat.use')
  const canManageAiSkills = useHasPermission('ai.skills.manage')
  const canUseSkills = useHasPermission('ai.skills.use')
  const canUseDocs = useHasPermission('docs.use')
  const canCreateTeams = useHasPermission('teams.create')
  const canUseAi = canChatWithAi || canManageAiSkills
  const isOnline = useIsOnline()
  const teamInvitationCount = useTeamInvitationStore((s) => s.count)
  const publicSettings = usePublicSettingsStore()

  const items = buildNavigation(
    {
      dashboard: t('nav.dashboard'),
      calendar: t('nav.calendar'),
      notes: t('nav.notes'),
      documents: t('nav.documents'),
      chat: t('nav.chat'),
      servers: t('nav.servers'),
      users: t('nav.users'),
      roles: t('nav.roles'),
      teams: t('nav.teams'),
      audit: t('nav.audit'),
      settings: t('nav.settings'),
      blueprints: t('nav.blueprints'),
      panelBackups: t('nav.panelBackups'),
      panelDatabase: t('nav.panelDatabase'),
      nodes: t('nav.nodes'),
      docs: t('nav.docs'),
      ai: t('nav.ai'),
    },
    {
      owner: Boolean(user?.is_owner),
      canManageUsers,
      canManageRoles,
      canViewAudit,
      canViewSettings,
      canManagePanelBackups,
      canReadPanelDatabase,
      canViewNodes: canReadNodes || canManageNodes,
      canUseAi,
      canUseSkills,
      canCreateTeams,
      teamInvitationCount,
      calendarEnabled: publicSettings.calendar_enabled,
      notesEnabled: publicSettings.notes_enabled,
      docsEnabled: publicSettings.docs_enabled,
      canUseDocs,
      socialEnabled: publicSettings.social_enabled,
      isOnline,
    },
  )

  return { items, isOnline }
}
