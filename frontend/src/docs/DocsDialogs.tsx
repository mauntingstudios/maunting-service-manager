import { useShallow } from 'zustand/react/shallow'

import type { DocDetail, DocFolder } from '@/api/docs'
import type { Team } from '@/api/teams'
import { MembersDialog } from './MembersDialog'
import { MoveDialog } from './MoveDialog'
import { ShareDialog } from './ShareDialog'
import { useDocsStore } from './docsStore'

interface DocsDialogsProps {
  detail: DocDetail
  folders: DocFolder[]
  teams: Team[]
  teamId: number | null
  uid: string | undefined
  listeLaden: () => void
  detailLaden: (docUid: string) => void
  /** Das offene Dokument gehört nach einem Teamwechsel nicht mehr hierher. */
  onDetailEntfernt: () => void
}

/** Freigeben, Mitglieder und Verschieben zum offenen Dokument (Befund 21). */
export function DocsDialogs({
  detail,
  folders,
  teams,
  teamId,
  uid,
  listeLaden,
  detailLaden,
  onDetailEntfernt,
}: DocsDialogsProps) {
  const { shareOpen, setShareOpen, membersOpen, setMembersOpen, moveDoc, setMoveDoc } =
    useDocsStore(
      useShallow((state) => ({
        shareOpen: state.shareOpen,
        setShareOpen: state.setShareOpen,
        membersOpen: state.membersOpen,
        setMembersOpen: state.setMembersOpen,
        moveDoc: state.moveDoc,
        setMoveDoc: state.setMoveDoc,
      })),
    )

  return (
    <>
      <ShareDialog
        detail={detail}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onChanged={() => void detailLaden(detail.uid)}
      />
      <MembersDialog
        detail={detail}
        open={membersOpen}
        onOpenChange={setMembersOpen}
        onChanged={() => void detailLaden(detail.uid)}
      />
      <MoveDialog
        document={moveDoc}
        folders={folders}
        teams={teams}
        open={moveDoc !== null}
        onOpenChange={(offen) => {
          if (!offen) setMoveDoc(null)
        }}
        onMoved={() => {
          void listeLaden()
          const gleichesTeam = moveDoc?.team_id === teamId
          if (uid) {
            if (gleichesTeam) void detailLaden(uid)
            else onDetailEntfernt()
          }
        }}
      />
    </>
  )
}
