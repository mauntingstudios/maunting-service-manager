import Collaboration from '@tiptap/extension-collaboration'
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret'
import { Mark, mergeAttributes } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import { Image } from '@tiptap/extension-image'
import { DocImageNodeView } from './DocImage'
// Diese Importe laden die Typ-Erweiterungen der Kommandos (`toggleBold`,
// `insertTable`, `setImage`, …) in das Projekt.
import '@tiptap/starter-kit'
import '@tiptap/extension-underline'
import '@tiptap/extension-highlight'
import '@tiptap/extension-text-align'
import '@tiptap/extension-link'
import '@tiptap/extension-image'
import '@tiptap/extension-table'
import '@tiptap/extension-task-list'
import '@tiptap/extension-task-item'
import '@tiptap/extension-placeholder'
import '@tiptap/extension-character-count'
import '@tiptap/extension-typography'
import '@tiptap/extension-code-block-lowlight'
import '@tiptap/extension-color'
import '@tiptap/extension-text-style'
import { createCoreExtensions } from '@msm/docs-schema'
import { common, createLowlight } from 'lowlight'
import type { HocuspocusProvider } from '@hocuspocus/provider'
import type * as Y from 'yjs'

export interface DocsUser {
  id: number
  name: string
  color: string
}

export function farbeFuerBenutzer(id: number): string {
  return `hsl(${Math.abs(id * 47) % 360} 72% 58%)`
}

/** Kommentar-Mark: die Anker-UID steht am Span, der Text bleibt normal editierbar. */
export const KommentarMark = Mark.create({
  name: 'comment',
  inclusive: false,
  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-comment-id'),
        renderHTML: (attributes) =>
          attributes.commentId ? { 'data-comment-id': attributes.commentId } : {},
      },
    }
  },
  parseHTML() {
    return [{ tag: 'span[data-comment-id]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { class: 'docs-comment-mark' }),
      0,
    ]
  },
})

export const DocImage = Image.extend({
  addOptions() {
    return {
      ...(this.parent?.() ?? {}),
      docUid: '',
    } as unknown as ReturnType<NonNullable<typeof this.parent>>
  },
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      assetUid: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-asset-uid'),
        renderHTML: (attributes: Record<string, unknown>) =>
          attributes.assetUid ? { 'data-asset-uid': attributes.assetUid } : {},
      },
    }
  },
  addNodeView() {
    return ReactNodeViewRenderer(DocImageNodeView)
  },
})

export function createDocsExtensions({
  ydoc,
  provider,
  user,
  docUid,
  placeholder,
}: {
  ydoc: Y.Doc
  provider: HocuspocusProvider | null
  user: DocsUser
  docUid: string
  placeholder?: string
}) {
  const kern = createCoreExtensions({ placeholder, lowlight: createLowlight(common) }).filter(
    (extension) => extension.name !== 'image',
  )
  const basis = [...kern, KommentarMark, DocImage.configure({ docUid } as never)]
  // Der Editor wird schon vor dem ersten Sync erzeugt. Ohne Provider fehlt
  // nur die Zusammenarbeit, nicht das Schema — sonst kennt TipTap den
  // Dokumentknoten nicht und der Editor wirft beim Aufbau.
  if (!provider) return basis
  return [
    ...basis,
    Collaboration.configure({ document: ydoc }),
    CollaborationCaret.configure({
      provider,
      user: { name: user.name, color: user.color },
    }),
  ]
}
