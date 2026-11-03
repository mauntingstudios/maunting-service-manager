import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { toast } from '@/stores/toastStore'
import {
  applyPendingEdit,
  docsErrorCode,
  listPendingEdits,
  previewPendingEdit,
  rejectPendingEdit,
} from '@/api/docs'
import { AI_ZUSTELLUNG_EVENT } from '@/lib/aiZustellung'
import { docsFehlermeldung, type DocsFehlerKontext } from './docsFehler'
import { useDocsStore } from './docsStore'

export interface PendingEditsOptionen {
  uid: string | undefined
  detailLaden: (docUid: string) => Promise<void>
  panelDatenLaden: () => Promise<void>
}

/**
 * KI-Vorschläge zum offenen Dokument: laden, übernehmen, verwerfen
 * (Befund 21). Der Stand liegt im Store, die Pflege hier; neue
 * Zustellungen des Assistenten laden den Vorschlag automatisch nach.
 */
export function usePendingEdits({ uid, detailLaden, panelDatenLaden }: PendingEditsOptionen) {
  const { t } = useTranslation()
  const vorschlag = useDocsStore((state) => state.vorschlag)
  const vorschlagBusy = useDocsStore((state) => state.vorschlagBusy)

  const meldung = useCallback(
    (error: unknown, kontext: DocsFehlerKontext) => docsFehlermeldung(t, error, kontext),
    [t],
  )

  const vorschlagLaden = useCallback(async (docUid: string) => {
    const setzen = useDocsStore.getState().setVorschlag
    try {
      const { pending_edits } = await listPendingEdits(docUid)
      const erster =
        pending_edits.find((eintrag) => eintrag.status !== 'stale') ?? pending_edits[0]
      if (!erster) {
        setzen(null)
        return
      }
      try {
        const vorschau = await previewPendingEdit(docUid, erster.uid)
        setzen({ ...erster, ...vorschau })
      } catch (error) {
        // 409 heisst: Der Anker ist nicht mehr eindeutig oder der Vorschlag
        // wurde in einem anderen Tab entschieden. Der Geist verschwindet, der
        // Statuschip bietet noch das Verwerfen an.
        const code = docsErrorCode(error)
        if (
          code === 'DOC_AI_PENDING_NOT_FOUND' ||
          code === 'DOCS_FORBIDDEN' ||
          code === 'DOCUMENT_NOT_FOUND'
        ) {
          setzen(null)
        } else {
          // Auch ein voruebergehend nicht erreichbarer Sidecar soll den
          // Vorschlag nicht aus der Oberflaeche tilgen: Verwerfen bleibt
          // moeglich, Uebernehmen wird beim naechsten Versuch erneut geprueft.
          setzen({
            ...erster,
            stale: true,
            html: '',
            previews: [],
            target_block: null,
            target_index: null,
          })
        }
      }
    } catch {
      setzen(null)
    }
  }, [])

  const vorschlagAnwenden = useCallback(async () => {
    if (!uid || !vorschlag || vorschlagBusy) return
    useDocsStore.getState().setVorschlagBusy(true)
    try {
      await applyPendingEdit(uid, vorschlag.uid)
      toast.success(t('docs.pending.applied'))
      await detailLaden(uid)
      await vorschlagLaden(uid)
      await panelDatenLaden()
    } catch (error) {
      toast.error(meldung(error, 'update'))
      await vorschlagLaden(uid)
    } finally {
      useDocsStore.getState().setVorschlagBusy(false)
    }
  }, [detailLaden, meldung, panelDatenLaden, t, uid, vorschlag, vorschlagBusy, vorschlagLaden])

  const vorschlagVerwerfen = useCallback(async () => {
    if (!uid || !vorschlag || vorschlagBusy) return
    useDocsStore.getState().setVorschlagBusy(true)
    try {
      await rejectPendingEdit(uid, vorschlag.uid)
      toast.success(t('docs.pending.rejected'))
      await vorschlagLaden(uid)
    } catch (error) {
      toast.error(meldung(error, 'update'))
    } finally {
      useDocsStore.getState().setVorschlagBusy(false)
    }
  }, [meldung, t, uid, vorschlag, vorschlagBusy, vorschlagLaden])

  useEffect(() => {
    const kiFertig = () => {
      if (uid) void vorschlagLaden(uid)
    }
    window.addEventListener(AI_ZUSTELLUNG_EVENT, kiFertig)
    return () => {
      window.removeEventListener(AI_ZUSTELLUNG_EVENT, kiFertig)
    }
  }, [uid, vorschlagLaden])

  return { vorschlag, vorschlagBusy, vorschlagLaden, vorschlagAnwenden, vorschlagVerwerfen }
}

export type PendingEdits = ReturnType<typeof usePendingEdits>
