import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

import {
  createGroup,
  deleteGroup,
  leaveGroup,
  setzeEinladungsKarte,
  type ChatGroupItem,
} from '@/api/social'
import { starteGruppenanruf } from '@/api/calls'
import type { ChatContact } from '@/components/social/sidebar/ConversationListItem'
import {
  baueEinladungsKarte,
  erzeugeEinladungsschluessel,
  mitSchluessel,
} from '@/services/einladungsKarte'
import { deriveGroupBlindMailboxId } from '@/services/e2eeCrypto'
import { oeffentlicheBasisUrl } from '@/lib/einladungsUrsprung'
import { verwirfGruppenSchluessel } from '@/services/gruppenSchluessel'
import {
  merkeGruppenName,
  sichereGruppenAnsicht,
  vergissGruppenName,
} from '@/services/gruppenName'
import { useCallStore } from '@/stores/useCallStore'
import { toast } from '@/stores/toastStore'

interface Optionen {
  t: (schluessel: string, optionen?: Record<string, unknown>) => string
  currentUserId: number
  activeGroup: ChatGroupItem | null
  setActiveGroup: Dispatch<SetStateAction<ChatGroupItem | null>>
  setActiveContact: Dispatch<SetStateAction<ChatContact | null>>
  loadData: () => Promise<unknown>
  gruppenTitel: (gruppe: { name?: string | null } | null | undefined) => string
  handleZurueckZurListe: () => void
}

/**
 * Die reinen Gruppen-Aktionen. Bewusst ohne Rollen- und Rechteauswertung:
 * `gruppenRollenZustand`, `wirksameGruppenrechte` und der Effekt, der den
 * verschlüsselten Rollenblock lädt, bleiben in `Messenger.tsx`. Ein zweiter
 * Effekt hier würde den Block doppelt laden und die Rechteauswertung spalten.
 */
export function useGruppenAktionen({
  t,
  currentUserId,
  activeGroup,
  setActiveGroup,
  setActiveContact,
  loadData,
  gruppenTitel,
  handleZurueckZurListe,
}: Optionen) {
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false)
  const [groupToDelete, setGroupToDelete] = useState<ChatGroupItem | null>(null)
  const [isDeletingGroup, setIsDeletingGroup] = useState(false)

  const groupCallPermissions = useMemo(() => {
    if (!activeGroup) {
      return {
        canStart: false, canJoin: false, canShare: false,
        canModerate: false, canMute: false, canKick: false,
      }
    }
    return {
      canStart: activeGroup.can_start_call === true,
      canJoin: activeGroup.can_join_call === true,
      canShare: activeGroup.can_share_screen === true,
      canModerate: activeGroup.can_start_call === true,
      canMute: activeGroup.can_mute_others === true,
      canKick: activeGroup.can_kick_from_call === true,
    }
  }, [activeGroup])

  const handleStartGroupCall = async (joinExisting = false) => {
    if (!activeGroup) return
    if (joinExisting ? !groupCallPermissions.canJoin : !groupCallPermissions.canStart) {
      toast.error(joinExisting ? t('messenger.noJoinCallRight') : t('messenger.noStartCallRight'))
      return
    }
    const mitgliederIds = (activeGroup.members ?? []).map((member) => member.user_id)
    let roomToken: string
    try {
      if (joinExisting) {
        const existingToken = (activeGroup as ChatGroupItem & { room_token?: string }).room_token
        if (!existingToken) {
          toast.error(t('messenger.noCallRoom'))
          return
        }
        roomToken = existingToken
      } else {
        roomToken = (await starteGruppenanruf(activeGroup.id)).room_token
      }
    } catch {
      toast.error(joinExisting ? t('messenger.callOpenFailed') : t('messenger.callStartFailed'))
      return
    }

    await useCallStore.getState().joinGroupCall(
      {
        id: activeGroup.id,
        name: gruppenTitel(activeGroup),
        avatarUrl: activeGroup.avatar_url ?? null,
        canShare: groupCallPermissions.canShare,
        canModerate: groupCallPermissions.canModerate,
        canMute: groupCallPermissions.canMute,
        canKick: groupCallPermissions.canKick,
      },
      roomToken,
      joinExisting ? undefined : mitgliederIds,
    )
  }

  const handleCreateGroup = async (name: string, beschreibung: string | null): Promise<boolean> => {
    try {
      const roh = await createGroup()
      await merkeGruppenName(roh.id, { name, beschreibung }).catch(() => {})
      const mailbox = await deriveGroupBlindMailboxId(roh.id).catch(() => null)
      if (mailbox && currentUserId) {
        await sichereGruppenAnsicht(
          {
            groupId: roh.id,
            blindMailboxId: mailbox,
            eigeneId: currentUserId,
            mitglieder: [currentUserId],
            istEigentuemer: true,
          },
          { name, beschreibung },
        ).catch(() => false)
      }
      const newGroup: ChatGroupItem = { ...roh, name, description: beschreibung }
      toast.success(t('messenger.groupCreated', { name }))
      setIsCreateGroupOpen(false)
      await loadData()
      setActiveGroup(newGroup)
      setActiveContact(null)
      return true
    } catch {
      toast.error(t('messenger.groupCreateFailed'))
      return false
    }
  }

  const handleCopyInviteLink = async (group: ChatGroupItem) => {
    if (!group.invite_code) {
      toast.error(t('messenger.inviteNoRight'))
      return
    }
    const basis = oeffentlicheBasisUrl()
    if (!basis) {
      toast.error(t('messenger.inviteNoPanelUrl'))
      return
    }
    const url = `${basis}/chat/join/${group.invite_code}`
    let fertig = url
    try {
      const einladungsschluessel = erzeugeEinladungsschluessel()
      const karte = await baueEinladungsKarte(einladungsschluessel, group.invite_code, {
        name: group.name,
        beschreibung: group.description ?? null,
        logo: group.avatar_url?.startsWith('data:image/') ? group.avatar_url : null,
      })
      await setzeEinladungsKarte(group.id, karte)
      fertig = mitSchluessel(url, einladungsschluessel)
    } catch {
      // Eine Karte, die nicht zustande kommt, darf das Einladen nicht aufhalten.
    }
    navigator.clipboard.writeText(fertig)
    toast.success(t('messenger.inviteCopied'))
  }

  const handleLeaveGroup = async (group: ChatGroupItem) => {
    try {
      const name = gruppenTitel(group)
      await leaveGroup(group.id)
      await verwirfGruppenSchluessel(group.id).catch(() => {})
      await vergissGruppenName(group.id).catch(() => {})
      toast.success(t('messenger.groupLeft', { name }))
      handleZurueckZurListe()
      await loadData()
    } catch {
      toast.error(t('messenger.groupLeaveFailed'))
    }
  }

  const handleDeleteGroup = (group: ChatGroupItem) => setGroupToDelete(group)

  const handleConfirmDeleteGroup = async () => {
    if (!groupToDelete) return
    setIsDeletingGroup(true)
    try {
      const name = gruppenTitel(groupToDelete)
      await deleteGroup(groupToDelete.id)
      await verwirfGruppenSchluessel(groupToDelete.id).catch(() => {})
      await vergissGruppenName(groupToDelete.id).catch(() => {})
      toast.success(t('messenger.groupDeleted', { name }))
      handleZurueckZurListe()
      setGroupToDelete(null)
      await loadData()
    } catch {
      toast.error(t('messenger.groupDeleteFailed'))
    } finally {
      setIsDeletingGroup(false)
    }
  }

  return {
    isCreateGroupOpen,
    setIsCreateGroupOpen,
    groupToDelete,
    setGroupToDelete,
    isDeletingGroup,
    groupCallPermissions,
    handleStartGroupCall,
    handleCreateGroup,
    handleCopyInviteLink,
    handleLeaveGroup,
    handleDeleteGroup,
    handleConfirmDeleteGroup,
  }
}

export type GruppenAktionen = ReturnType<typeof useGruppenAktionen>
