import type { DocSummary } from '@/api/docs'

const METADATA_PREFIX = 'msm_docs_meta:'
const DB_PREFIX = 'msm-docs-'

export function metadataKey(userId: number): string {
  return `${METADATA_PREFIX}${userId}`
}

export function docDatabaseName(userId: number, docUid: string): string {
  return `${DB_PREFIX}${userId}-${docUid}`
}

export function loadCachedDocuments(userId: number): DocSummary[] {
  try {
    const raw = localStorage.getItem(metadataKey(userId))
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DocSummary[]) : []
  } catch {
    return []
  }
}

export function saveCachedDocuments(userId: number, documents: DocSummary[]): void {
  try {
    localStorage.setItem(metadataKey(userId), JSON.stringify(documents))
  } catch {
    /* Speicher voll oder gesperrt — die Liste kommt beim naechsten REST-Lauf. */
  }
}

export function cacheDocument(userId: number, doc: DocSummary): void {
  const vorhanden = loadCachedDocuments(userId)
  const ohne = vorhanden.filter((eintrag) => eintrag.uid !== doc.uid)
  saveCachedDocuments(userId, [doc, ...ohne].slice(0, 500))
}

export function forgetDocument(userId: number, docUid: string): void {
  saveCachedDocuments(
    userId,
    loadCachedDocuments(userId).filter((eintrag) => eintrag.uid !== docUid),
  )
  void deleteDatabase(docDatabaseName(userId, docUid))
}

async function deleteDatabase(name: string): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
      request.onblocked = () => resolve()
    })
  } catch {
    /* Kein IndexedDB (z. B. SSR oder gesperrter Speicher). */
  }
}

async function listDatabases(): Promise<string[]> {
  try {
    const datenbanken = await indexedDB.databases?.()
    return (datenbanken ?? []).map((eintrag) => eintrag.name ?? '')
  } catch {
    return []
  }
}

/**
 * Beim Kontowechsel oder Logout lokale Dokumentkopien entfernen.
 *
 * y-indexeddb haelt Klartext. Wer das Geraet weitergibt, soll nicht die
 * Dokumente des vorigen Kontos vorfinden.
 */
export async function clearLocalDocuments(userId: number | null): Promise<void> {
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(METADATA_PREFIX)) continue
      if (userId === null || key !== metadataKey(userId)) {
        localStorage.removeItem(key)
      }
    }
  } catch {
    /* localStorage gesperrt. */
  }

  const behalten = userId === null ? null : docDatabaseName(userId, '')
  const namen = await listDatabases()
  for (const name of namen) {
    if (!name.startsWith(DB_PREFIX)) continue
    if (behalten && name.startsWith(behalten)) continue
    await deleteDatabase(name)
  }
}

export function hasLocalCopy(userId: number, docUid: string): boolean {
  return loadCachedDocuments(userId).some((eintrag) => eintrag.uid === docUid)
}
