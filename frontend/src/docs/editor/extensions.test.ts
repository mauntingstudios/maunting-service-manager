import { Editor } from '@tiptap/core'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import { createDocsExtensions } from './extensions'

describe('createDocsExtensions', () => {
  it('liefert schon vor dem ersten Sync ein vollständiges Schema', () => {
    const ydoc = new Y.Doc()
    const editor = new Editor({
      extensions: createDocsExtensions({
        ydoc,
        provider: null,
        user: { id: 1, name: 'Ada', color: 'hsl(0 0% 0%)' },
        docUid: 'doc-1',
      }),
      content: '<p>Hallo</p>',
    })

    expect(editor.schema.topNodeType.name).toBe('doc')
    expect(editor.schema.nodes.image).toBeDefined()
    expect(editor.schema.marks.comment).toBeDefined()

    editor.destroy()
    ydoc.destroy()
  })
})
