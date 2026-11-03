import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { teamsApi, type Team } from '@/api/teams'
import {
  docsErrorCode,
  getDocsStatus,
  listDocuments,
  listFolders,
  searchDocuments,
  type DocFolder,
  type DocSummary,
  type DocsStatus,
} from '@/api/docs'
import { docsFehlermeldung, type DocsFehlerKontext } from './docsFehler'
import { saveCachedDocuments } from './docsOffline'

const DOKUMENT_SEITENGROESSE = 100

export interface DocsSessionOptionen {
  userId: number | undefined
  docsEnabled: boolean
}

/**
 * Sitzungsdaten des Dokumente-Moduls: Teams, Ordner, Liste inklusive
 * Paging/Cursor, Suche, Filter, Offline-Katalog und Status (Befund 21).
 * Lädt nur, solange das Modul eingeschaltet ist; verspätete Antworten
 * einer alten Ansicht werden über die Generation verworfen.
 */
export function useDocsSession({ userId, docsEnabled }: DocsSessionOptionen) {
  const { t } = useTranslation()

  const [teams, setTeams] = useState<Team[]>([])
  const [teamId, setTeamId] = useState<number | null>(null)
  const [folders, setFolders] = useState<DocFolder[]>([])
  const [documents, setDocuments] = useState<DocSummary[]>([])
  const [mehrDokumente, setMehrDokumente] = useState(false)
  const [ladeMehrDokumente, setLadeMehrDokumente] = useState(false)
  const [folderUid, setFolderUid] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [suchGrenze, setSuchGrenze] = useState<number | null>(null)
  const [trash, setTrash] = useState(false)
  const [archived, setArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [status, setStatus] = useState<DocsStatus | null>(null)
  const [statusModulAus, setStatusModulAus] = useState(false)
  const searchRef = useRef<number | null>(null)
  const listGenerationRef = useRef(0)

  const meldung = useCallback(
    (error: unknown, kontext: DocsFehlerKontext) => docsFehlermeldung(t, error, kontext),
    [t],
  )

  const listeLaden = useCallback(async (generation?: number) => {
    if (generation !== undefined && generation !== listGenerationRef.current) return
    const aktuelleGeneration = generation ?? ++listGenerationRef.current
    setLoading(true)
    setLadeMehrDokumente(false)
    setFehler(null)
    try {
      const begriff = search.trim()
      const [ordner, dokumente] = await Promise.all([
        listFolders(teamId),
        (async () => {
          if (!begriff) {
            const seite = await listDocuments({
              teamId,
              archived,
              trash,
              limit: DOKUMENT_SEITENGROESSE + 1,
            })
            return {
              items: seite.slice(0, DOKUMENT_SEITENGROESSE),
              hasMore: seite.length > DOKUMENT_SEITENGROESSE,
              searched: null,
            }
          }
          const ergebnis = await searchDocuments({ search: begriff, limit: 200 })
          return {
            items: ergebnis.items,
            hasMore: false,
            searched: ergebnis.truncated ? ergebnis.searched : null,
          }
        })(),
      ])
      if (aktuelleGeneration !== listGenerationRef.current) return
      setSuchGrenze(dokumente.searched)
      setMehrDokumente(dokumente.hasMore)
      setFolders(ordner)
      setDocuments(dokumente.items)
      // Nur die ungefilterte Aktivliste ersetzt den Offline-Katalog. Eine
      // Suchtrefferliste oder der Papierkorb wuerde sonst die lokale Kopie
      // aller anderen Dokumente ueberschreiben.
      if (userId !== undefined && !search.trim() && !trash && !archived) {
        saveCachedDocuments(userId, dokumente.items)
      }
    } catch (error) {
      if (aktuelleGeneration === listGenerationRef.current) {
        setFehler(meldung(error, 'list'))
      }
    } finally {
      if (aktuelleGeneration === listGenerationRef.current) setLoading(false)
    }
  }, [archived, meldung, search, teamId, trash, userId])

  const weitereDokumenteLaden = useCallback(async () => {
    if (ladeMehrDokumente || !mehrDokumente || search.trim()) return
    const angefragterStand = documents.length
    const generation = listGenerationRef.current
    setLadeMehrDokumente(true)
    setFehler(null)
    try {
      const seite = await listDocuments({
        teamId,
        archived,
        trash,
        limit: DOKUMENT_SEITENGROESSE + 1,
        cursor: angefragterStand,
      })
      if (generation !== listGenerationRef.current) return
      const weitere = seite
        .slice(0, DOKUMENT_SEITENGROESSE)
        .filter((doc) => !documents.some((geladen) => geladen.uid === doc.uid))
      const aktualisiert = [...documents, ...weitere]
      setDocuments(aktualisiert)
      setMehrDokumente(seite.length > DOKUMENT_SEITENGROESSE)
      if (userId !== undefined && !trash && !archived) {
        saveCachedDocuments(userId, aktualisiert)
      }
    } catch (error) {
      if (generation === listGenerationRef.current) {
        setFehler(meldung(error, 'list'))
      }
    } finally {
      if (generation === listGenerationRef.current) setLadeMehrDokumente(false)
    }
  }, [
    archived,
    documents,
    ladeMehrDokumente,
    mehrDokumente,
    meldung,
    search,
    teamId,
    trash,
    userId,
  ])

  useEffect(() => {
    if (!docsEnabled) {
      setTeams([])
      setStatus(null)
      setStatusModulAus(false)
      return
    }
    void teamsApi.list().then(setTeams).catch(() => setTeams([]))
    const statusLaden = () => {
      void getDocsStatus()
        .then((daten) => {
          setStatus(daten)
          setStatusModulAus(false)
        })
        .catch((error) => {
          setStatus(null)
          if (docsErrorCode(error) === 'DOCS_DISABLED') setStatusModulAus(true)
        })
    }
    statusLaden()
    // Der Sidecar kann waehrend einer Sitzung neu starten. Ein Banner, das
    // nur beim Oeffnen entsteht, bliebe sonst fuer immer stehen.
    const timer = window.setInterval(statusLaden, 30_000)
    return () => window.clearInterval(timer)
  }, [docsEnabled])

  useEffect(() => {
    if (!docsEnabled) {
      setLoading(false)
      return
    }
    const generation = ++listGenerationRef.current
    if (searchRef.current) window.clearTimeout(searchRef.current)
    searchRef.current = window.setTimeout(() => {
      void listeLaden(generation)
    }, search ? 300 : 0)
    return () => {
      if (searchRef.current) window.clearTimeout(searchRef.current)
      if (listGenerationRef.current === generation) listGenerationRef.current += 1
    }
  }, [docsEnabled, listeLaden, search])

  const modulAus = statusModulAus || status?.enabled === false
  const sidecarAus = status && status.enabled && !status.sidecar_ok

  return {
    teams,
    teamId,
    setTeamId,
    folders,
    setFolders,
    documents,
    setDocuments,
    mehrDokumente,
    ladeMehrDokumente,
    folderUid,
    setFolderUid,
    search,
    setSearch,
    suchGrenze,
    trash,
    setTrash,
    archived,
    setArchived,
    loading,
    fehler,
    status,
    listeLaden,
    weitereDokumenteLaden,
    modulAus,
    sidecarAus,
  }
}

export type DocsSession = ReturnType<typeof useDocsSession>
