import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'

import { clearLocalDocuments, docDatabaseName, forgetDocument, saveCachedDocuments } from './docsOffline'
import type { DocSummary } from '@/api/docs'

const dokument = (uid: string): DocSummary => ({
  uid,
  title: uid,
  folder_uid: null,
  team_id: 1,
  team_name: null,
  role: 'editor',
  can_edit: true,
  can_comment: true,
  can_manage: false,
  rev: 1,
  archived: false,
  deleted: false,
  content_truncated: false,
  updated_at: '2026-10-28T10:00:00Z',
  last_edited_at: '2026-10-28T10:00:00Z',
  owner: null,
})

async function datenbanken(): Promise<string[]> {
  const liste = await indexedDB.databases()
  return liste.map((eintrag) => eintrag.name ?? '')
}

describe('lokale Dokumentkopie', () => {
  it('überlebt das Schließen und lässt sich offline wieder öffnen', async () => {
    const name = docDatabaseName(7, 'doc-offline')
    const erstes = new Y.Doc()
    const ersteAblage = new IndexeddbPersistence(name, erstes)
    await ersteAblage.whenSynced
    erstes.getText('inhalt').insert(0, 'Ohne Netz geschrieben')
    await new Promise((fertig) => setTimeout(fertig, 200))
    await ersteAblage.destroy()

    const zweites = new Y.Doc()
    const zweiteAblage = new IndexeddbPersistence(name, zweites)
    await zweiteAblage.whenSynced
    expect(zweites.getText('inhalt').toString()).toBe('Ohne Netz geschrieben')

    await zweiteAblage.destroy()
    await clearLocalDocuments(null)
  })

  it('löscht beim Kontowechsel nur die Kopien des alten Kontos', async () => {
    const altesKonto = docDatabaseName(7, 'doc-a')
    const neuesKonto = docDatabaseName(8, 'doc-b')
    const a = new Y.Doc()
    const b = new Y.Doc()
    const ablageA = new IndexeddbPersistence(altesKonto, a)
    const ablageB = new IndexeddbPersistence(neuesKonto, b)
    await Promise.all([ablageA.whenSynced, ablageB.whenSynced])
    await ablageA.destroy()
    await ablageB.destroy()
    localStorage.clear()
    saveCachedDocuments(7, [dokument('doc-a')])
    saveCachedDocuments(8, [dokument('doc-b')])

    await clearLocalDocuments(8)

    const namen = await datenbanken()
    expect(namen).not.toContain(altesKonto)
    expect(namen).toContain(neuesKonto)
    expect(localStorage.getItem('msm_docs_meta:7')).toBeNull()

    await clearLocalDocuments(null)
  })

  it('entfernt beim Vergessen eines Dokuments auch dessen lokale Datenbank', async () => {
    const name = docDatabaseName(7, 'doc-weg')
    const doc = new Y.Doc()
    const ablage = new IndexeddbPersistence(name, doc)
    await ablage.whenSynced
    await ablage.destroy()
    saveCachedDocuments(7, [dokument('doc-weg'), dokument('doc-bleibt')])

    forgetDocument(7, 'doc-weg')
    await new Promise((fertig) => setTimeout(fertig, 200))

    const namen = await datenbanken()
    expect(namen).not.toContain(name)
    expect(localStorage.getItem('msm_docs_meta:7')).not.toContain('doc-weg')

    await clearLocalDocuments(null)
  })
})
