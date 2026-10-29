import { useCallback, useState } from 'react'

import { updateDocument } from '@/api/docs'

/** Ein Weg fuer Dialog und Drag & Drop — dieselbe Prüfung, derselbe Aufruf. */
export function useDokumentVerschieben(onMoved: () => void) {
  const [laeuft, setLaeuft] = useState(false)

  const verschieben = useCallback(
    async (uid: string, ziel: { teamId?: number; folderUid: string | null }) => {
      setLaeuft(true)
      try {
        await updateDocument(uid, {
          ...(ziel.teamId !== undefined ? { team_id: ziel.teamId } : {}),
          folder_uid: ziel.folderUid,
        })
        onMoved()
        return true
      } finally {
        setLaeuft(false)
      }
    },
    [onMoved],
  )

  return { laeuft, verschieben }
}
