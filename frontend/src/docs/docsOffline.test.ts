import { describe, expect, it } from 'vitest'
import type { DocSummary } from '@/api/docs'
import {
  cacheDocument,
  clearLocalDocuments,
  hasLocalCopy,
  loadCachedDocuments,
  metadataKey,
  saveCachedDocuments,
} from './docsOffline'

function dokument(uid: string, title: string): DocSummary {
  return {
    uid,
    title,
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
  }
}

describe('docsOffline', () => {
  it('legt Metadaten je Konto ab und findet sie wieder', () => {
    localStorage.clear()
    saveCachedDocuments(7, [dokument('a', 'Erstes')])
    expect(loadCachedDocuments(7)).toHaveLength(1)
    expect(hasLocalCopy(7, 'a')).toBe(true)
    expect(hasLocalCopy(7, 'b')).toBe(false)
  })

  it('cacheDocument stellt das neueste Dokument nach vorn', () => {
    localStorage.clear()
    saveCachedDocuments(7, [dokument('a', 'Alt')])
    cacheDocument(7, dokument('b', 'Neu'))
    expect(loadCachedDocuments(7).map((eintrag) => eintrag.uid)).toEqual(['b', 'a'])
  })

  it('liest fremde Konten nicht mit', () => {
    localStorage.clear()
    saveCachedDocuments(7, [dokument('a', 'A')])
    saveCachedDocuments(8, [dokument('b', 'B')])
    expect(loadCachedDocuments(7).map((eintrag) => eintrag.uid)).toEqual(['a'])
    expect(loadCachedDocuments(8).map((eintrag) => eintrag.uid)).toEqual(['b'])
  })

  it('raeumt beim Kontowechsel die Metadaten des alten Kontos', async () => {
    localStorage.clear()
    saveCachedDocuments(7, [dokument('a', 'A')])
    saveCachedDocuments(8, [dokument('b', 'B')])
    await clearLocalDocuments(8)
    expect(localStorage.getItem(metadataKey(7))).toBeNull()
    expect(loadCachedDocuments(8)).toHaveLength(1)
  })

  it('raeumt beim Logout alles weg', async () => {
    localStorage.clear()
    saveCachedDocuments(7, [dokument('a', 'A')])
    await clearLocalDocuments(null)
    expect(loadCachedDocuments(7)).toEqual([])
  })
})
