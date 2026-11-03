import { afterEach, expect, it, vi } from 'vitest'
import * as client from './client'
import {
  assetUrl,
  claimShare,
  createComment,
  createDocument,
  createShare,
  docsErrorCode,
  downloadExport,
  getAssetSignedUrl,
  getCollabToken,
  listDocuments,
  listRevisions,
  restoreRevision,
  searchDocuments,
  updateDocument,
  uploadAsset,
} from './docs'

afterEach(() => vi.restoreAllMocks())

it('baut die Listenabfrage nur aus gesetzten Filtern', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue({ items: [], next_cursor: null })

  await listDocuments({ teamId: 7, trash: true, limit: 50, cursor: 'c120' })
  expect(api).toHaveBeenLastCalledWith(
    '/docs?team_id=7&trash=true&limit=50&cursor=c120',
  )

  await listDocuments({ teamId: null, archived: false })
  expect(api).toHaveBeenLastCalledWith('/docs')
})

it('sucht über den eigenen Weg und liefert Treffer mit Suchtiefe', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue({ items: [], searched: 200, truncated: true })

  const ergebnis = await searchDocuments({ search: 'protokoll', limit: 200 })
  expect(api).toHaveBeenLastCalledWith('/docs?search=protokoll&limit=200')
  expect(ergebnis).toEqual({ items: [], searched: 200, truncated: true })
})

it('legt Dokumente ohne Team und Ordner mit expliziten Nullen an', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue({ uid: 'doc-1' })

  await createDocument()
  expect(api).toHaveBeenLastCalledWith('/docs', {
    method: 'POST',
    body: JSON.stringify({ team_id: null, folder_uid: null, title: null }),
  })

  await createDocument({ teamId: 3, folderUid: 'f-1', title: 'Notizen' })
  expect(api).toHaveBeenLastCalledWith('/docs', {
    method: 'POST',
    body: JSON.stringify({ team_id: 3, folder_uid: 'f-1', title: 'Notizen' }),
  })
})

it('kodiert UIDs in Pfaden und behält Teil-Updates knapp', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue({ uid: 'a/b' })

  await updateDocument('a/b', { title: 'Neu' })
  expect(api).toHaveBeenLastCalledWith('/docs/a%2Fb', {
    method: 'PATCH',
    body: JSON.stringify({ title: 'Neu' }),
  })

  await getCollabToken('a/b')
  expect(api).toHaveBeenLastCalledWith('/docs/a%2Fb/collab-token', { method: 'POST' })

  await restoreRevision('a/b', 12)
  expect(api).toHaveBeenLastCalledWith('/docs/a%2Fb/revisions/12/restore', { method: 'POST' })

  await claimShare('tok/en')
  expect(api).toHaveBeenLastCalledWith('/docs/shared/claim', {
    method: 'POST',
    body: JSON.stringify({ token: 'tok/en' }),
  })

  await getAssetSignedUrl('a/b', 'asset/1', 900)
  expect(api).toHaveBeenLastCalledWith('/docs/a%2Fb/assets/asset%2F1/signed-url?ttl=900')
})

it('teilt nur Viewer und Kommentator mit Frist', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue({ url: '/d/1', role: 'viewer' })

  await createShare('doc-1', 'commenter', 3)
  expect(api).toHaveBeenLastCalledWith('/docs/doc-1/share', {
    method: 'POST',
    body: JSON.stringify({ role: 'commenter', expires_in_days: 3 }),
  })
})

it('schickt Kommentare mit leerem Anker, wenn keine Auswahl markiert ist', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue({ uid: 'c-1' })

  await createComment('doc-1', 'Bitte prüfen')
  expect(api).toHaveBeenLastCalledWith('/docs/doc-1/comments', {
    method: 'POST',
    body: JSON.stringify({ body: 'Bitte prüfen', parent_uid: null, anchor: null }),
  })

  await createComment('doc-1', 'Antwort', 'c-1', { quote: 'Stelle' })
  expect(api).toHaveBeenLastCalledWith('/docs/doc-1/comments', {
    method: 'POST',
    body: JSON.stringify({ body: 'Antwort', parent_uid: 'c-1', anchor: { quote: 'Stelle' } }),
  })
})

it('liest Revisionen ohne State', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue([])
  await listRevisions('doc-1')
  expect(api).toHaveBeenLastCalledWith('/docs/doc-1/revisions')
})

it('lädt Exporte als Blob mit sprechendem Dateinamen', async () => {
  const blob = new Blob(['# Titel'])
  const stream = vi
    .spyOn(client, 'apiStream')
    .mockResolvedValue({ blob: async () => blob } as unknown as Response)

  const markdown = await downloadExport('abcdefgh-1234', 'md', 4)
  expect(stream).toHaveBeenLastCalledWith('/docs/abcdefgh-1234/export?format=md&rev=4', {
    method: 'GET',
  })
  expect(markdown.blob).toBe(blob)
  expect(markdown.filename).toBe('dokument-abcdefgh.md')

  await downloadExport('abcdefgh-1234', 'html')
  expect(stream).toHaveBeenLastCalledWith('/docs/abcdefgh-1234/export?format=html', {
    method: 'GET',
  })
})

it('reicht den signierten Asset-Pfad an apiUrl weiter', () => {
  expect(assetUrl('/api/docs/assets/a/content?token=t')).toContain(
    '/api/docs/assets/a/content?token=t',
  )
})

it('erkennt nur den Server-Fehlercode, nicht beliebige Fehler', () => {
  expect(docsErrorCode(new client.SanitizedApiError('x', { code: 'DOC_LIMIT_REACHED' }))).toBe(
    'DOC_LIMIT_REACHED',
  )
  expect(docsErrorCode(new client.SanitizedApiError('x'))).toBeNull()
  expect(docsErrorCode(new Error('DOC_LIMIT_REACHED'))).toBeNull()
})

const GRENZEN = { assetBytes: 4 * 1024 * 1024, assetsPerDoc: 100 }

function dateiMitGroesse(name: string, typ: string, groesse: number): File {
  const datei = new File(['x'], name, { type: typ })
  Object.defineProperty(datei, 'size', { value: groesse })
  return datei
}

it('lehnt zu grosse Dateien ohne arrayBuffer-Aufruf ab (Befund 32)', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue({})
  const datei = dateiMitGroesse('gross.png', 'image/png', 5 * 1024 * 1024)
  const lesen = vi.spyOn(datei, 'arrayBuffer')

  await expect(uploadAsset('doc-1', datei, { grenzen: GRENZEN })).rejects.toMatchObject({
    code: 'ASSET_BYTES_EXCEEDED',
  })
  expect(lesen).not.toHaveBeenCalled()
  expect(api).not.toHaveBeenCalled()
})

it('lehnt fremde Dateitypen ohne arrayBuffer-Aufruf ab (Befund 32)', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue({})
  const datei = dateiMitGroesse('skript.svg', 'image/svg+xml', 1024)
  const lesen = vi.spyOn(datei, 'arrayBuffer')

  await expect(uploadAsset('doc-1', datei, { grenzen: GRENZEN })).rejects.toMatchObject({
    code: 'DOC_INVALID_MIME',
  })
  expect(lesen).not.toHaveBeenCalled()
  expect(api).not.toHaveBeenCalled()
})

it('lehnt volle Anhangsgrenzen ohne arrayBuffer-Aufruf ab (Befund 32)', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue({})
  const datei = dateiMitGroesse('bild.png', 'image/png', 1024)
  const lesen = vi.spyOn(datei, 'arrayBuffer')

  await expect(
    uploadAsset('doc-1', datei, { grenzen: GRENZEN, anzahlAssets: 100 }),
  ).rejects.toMatchObject({ code: 'ASSET_QUOTA_EXCEEDED' })
  expect(lesen).not.toHaveBeenCalled()
  expect(api).not.toHaveBeenCalled()
})

it('laedt die Grenzen selbst, wenn der Aufrufer keine reicht (Befund 32)', async () => {
  const api = vi
    .spyOn(client, 'api')
    .mockResolvedValue({ enabled: true, limits: { asset_bytes: 10, assets_per_doc: 100 } })
  const datei = dateiMitGroesse('bild.png', 'image/png', 1024)
  const lesen = vi.spyOn(datei, 'arrayBuffer')

  await expect(uploadAsset('doc-1', datei)).rejects.toMatchObject({
    code: 'ASSET_BYTES_EXCEEDED',
  })
  expect(api).toHaveBeenLastCalledWith('/docs/status')
  expect(lesen).not.toHaveBeenCalled()
})

it('laedt gueltige Dateien weiter hoch (Befund 32)', async () => {
  const api = vi.spyOn(client, 'api').mockResolvedValue({ asset_uid: 'a-1' })
  vi.stubGlobal('crypto', {
    subtle: { digest: async () => new Uint8Array(32).fill(7).buffer },
  })
  try {
    const datei = new File(['bild-bytes'], 'bild.png', { type: 'image/png' })
    const ergebnis = await uploadAsset('doc-1', datei, { grenzen: GRENZEN })
    expect(ergebnis).toEqual({ asset_uid: 'a-1' })
    expect(api).toHaveBeenLastCalledWith('/docs/doc-1/assets', {
      method: 'POST',
      body: expect.stringContaining('"mime":"image/png"'),
    })
  } finally {
    vi.unstubAllGlobals()
  }
})
