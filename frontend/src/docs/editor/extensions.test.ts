import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { createDocsExtensions } from './extensions'

describe('createDocsExtensions', () => {
  it('verwendet den vom Aufrufer lokalisierten Pflicht-Platzhalter', () => {
    const ydoc = new Y.Doc()
    const extensions = createDocsExtensions({
      ydoc,
      provider: null,
      user: { id: 1, name: 'Ada', color: 'hsl(0 0% 0%)' },
      docUid: 'doc-1',
      placeholder: 'Start writing',
    })

    expect(extensions.find((extension) => extension.name === 'placeholder')?.options.placeholder).toBe(
      'Start writing',
    )
    ydoc.destroy()
  })

  it('liefert schon vor dem ersten Sync ein vollständiges Schema', () => {
    const ydoc = new Y.Doc()
    const editor = new Editor({
      extensions: createDocsExtensions({
        ydoc,
        provider: null,
        user: { id: 1, name: 'Ada', color: 'hsl(0 0% 0%)' },
        docUid: 'doc-1',
        placeholder: 'Start writing',
      }),
      content: '<p>Hallo</p>',
    })

    expect(editor.schema.topNodeType.name).toBe('doc')
    expect(editor.schema.nodes.image).toBeDefined()
    expect(editor.schema.marks.comment).toBeDefined()

    editor.destroy()
    ydoc.destroy()
  })

  it('übernimmt beim Import keine fremde Bildadresse in den Dokumentzustand', () => {
    const ydoc = new Y.Doc()
    const editor = new Editor({
      extensions: createDocsExtensions({
        ydoc,
        provider: null,
        user: { id: 1, name: 'Ada', color: 'hsl(0 0% 0%)' },
        docUid: 'doc-1',
        placeholder: 'Start writing',
      }),
      content: '<img src="https://tracker.example/bild.png" data-asset-uid="asset-1" alt="Bild">',
    })

    expect(JSON.stringify(editor.getJSON())).not.toContain('tracker.example')
    expect(editor.getHTML()).not.toContain('tracker.example')
    expect(editor.getJSON().content?.[0].attrs?.assetUid).toBe('asset-1')
    editor.destroy()
    ydoc.destroy()
  })
})
