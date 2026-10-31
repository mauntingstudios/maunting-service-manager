import { useCallback, useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

import { aiApi, type AiAttachment } from '@/api/ai'
import { SanitizedApiError } from '@/api/client'
import { spiegleAnhangInTresor } from '@/desktop/vault/kiAnhangSpiegelung'
import { bereiteAiAnhangAuf } from '@/lib/aiAnhangAufbereitung'
import { istVorschauFaehig } from '@/lib/aiAnhangTypen'

/**
 * Alle Anhaenge eines Composer-Lebens: mehrere Dateien annehmen, einzeln
 * hochladen, Vorschau halten, wieder entfernen.
 *
 * Bewusst ein Hook und kein Zustand im Chat: die Dateiauswahl, der
 * Drag-and-drop-Empfang und das Einfuegen aus der Zwischenablage landen
 * alle hier, und der Chat muss nur noch `uploadFiles(files)` rufen.
 *
 * Hochgeladen wird **nacheinander**. Zehn parallele Requests auf denselben
 * Chat konkurrieren um dieselbe Tagesquote und dieselbe Unterhaltung; die
 * langsamere Reihenfolge ist der Preis fuer eine verlaessliche Zuordnung.
 */
export function useAnhangUpload({
  aktiv,
  gesperrt,
  setAttachments,
  onFehler,
  uploadAttachment = aiApi.uploadAttachment,
  deleteAttachment = aiApi.deleteAttachment,
}: {
  aktiv: boolean
  /** Waehrend eines Laufs wird nichts angenommen — der Anhang gehoerte sonst
   *  zu keiner Frage. */
  gesperrt: boolean
  setAttachments: Dispatch<SetStateAction<AiAttachment[]>>
  onFehler: (text: string) => void
  uploadAttachment?: (file: File) => Promise<AiAttachment>
  deleteAttachment?: (id: string) => Promise<unknown>
}) {
  const { t } = useTranslation()
  const [uploading, setUploading] = useState(false)
  const [vorschauen, setVorschauen] = useState<Record<string, string>>({})
  const vorschauenRef = useRef(new Map<string, string>())
  const mountedRef = useRef(true)
  const laufendRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
        for (const url of vorschauenRef.current.values()) URL.revokeObjectURL(url)
      }
      vorschauenRef.current.clear()
    }
  }, [])

  const merkeVorschau = useCallback((id: string, datei: File) => {
    if (!istVorschauFaehig(datei)) return
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return
    let url: string
    try {
      url = URL.createObjectURL(datei)
    } catch {
      return
    }
    vorschauenRef.current.set(id, url)
    if (mountedRef.current) {
      setVorschauen((current) => ({ ...current, [id]: url }))
    }
  }, [])

  const freigeben = useCallback((id: string) => {
    const url = vorschauenRef.current.get(id)
    if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(url)
    }
    vorschauenRef.current.delete(id)
    if (mountedRef.current) {
      setVorschauen((current) => {
        if (!(id in current)) return current
        const naechste = { ...current }
        delete naechste[id]
        return naechste
      })
    }
  }, [])

  const clearPreviews = useCallback(() => {
    if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      for (const url of vorschauenRef.current.values()) URL.revokeObjectURL(url)
    }
    vorschauenRef.current.clear()
    if (mountedRef.current) setVorschauen({})
  }, [])

  const fehlerText = useCallback((error: unknown) => {
    if (error instanceof SanitizedApiError && error.message) return error.message
    if (error instanceof Error && error.message) return error.message
    return t('ai.attachments.error')
  }, [t])

  const uploadFiles = useCallback(async (dateien: FileList | File[] | null | undefined) => {
    if (!aktiv) return
    const liste = Array.from(dateien ?? [])
    if (liste.length === 0 || gesperrt || laufendRef.current) return
    laufendRef.current = true
    setUploading(true)
    // Timeout: Wenn ein Upload haengt, soll der Zustand nach 60s zurueckgesetzt
    // werden. Der Browser-eigene TCP-Timeout liegt bei 2-5 Minuten — zu lang
    // fuer eine responsive UI.
    const timeout = setTimeout(() => {
      if (mountedRef.current && laufendRef.current) {
        onFehler(t('ai.attachments.timeout'))
        laufendRef.current = false
        setUploading(false)
      }
    }, 60_000)
    try {
      for (const datei of liste) {
        if (!mountedRef.current) break
        try {
          const vorbereitet = await bereiteAiAnhangAuf(datei)
          const created = await uploadAttachment(vorbereitet)
          void spiegleAnhangInTresor(datei).catch(() => {})
          if (!mountedRef.current) continue
          merkeVorschau(created.id, datei)
          // Nach Kennung einsetzen statt anhaengen: das Nachladen nach dem
          // Absenden kann eine Antwort ueberholen, die noch unterwegs war.
          setAttachments((current) => [
            ...current.filter((item) => item.id !== created.id),
            created,
          ])
        } catch (error: unknown) {
          onFehler(`${datei.name}: ${fehlerText(error)}`)
        }
      }
    } finally {
      clearTimeout(timeout)
      laufendRef.current = false
      if (mountedRef.current) setUploading(false)
    }
  }, [aktiv, deleteAttachment, fehlerText, gesperrt, merkeVorschau, onFehler, setAttachments, t, uploadAttachment])

  const remove = useCallback(async (anhang: AiAttachment) => {
    try {
      await deleteAttachment(anhang.id)
      freigeben(anhang.id)
      if (mountedRef.current) {
        setAttachments((current) => current.filter((item) => item.id !== anhang.id))
      }
    } catch (error: unknown) {
      onFehler(fehlerText(error))
    }
  }, [deleteAttachment, fehlerText, freigeben, onFehler, setAttachments])

  return { uploading, uploadFiles, remove, vorschauen, clearPreviews }
}
