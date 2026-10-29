import { useEffect, useMemo, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Braces,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  List,
  ListChecks,
  ListOrdered,
  Pilcrow,
  Quote,
  Table2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface SlashMenuProps {
  editor: Editor
  query: string
  onClose: () => void
  onImage: () => void
}

export function SlashMenu({ editor, query, onClose, onImage }: SlashMenuProps) {
  const { t } = useTranslation()
  const [aktiv, setAktiv] = useState(0)

  const eintraege = useMemo(
    () => [
      { id: 'p', label: t('docs.toolbar.paragraph'), icon: Pilcrow, run: () => editor.chain().focus().setParagraph().run() },
      { id: 'h1', label: t('docs.toolbar.heading1'), icon: Heading1, run: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
      { id: 'h2', label: t('docs.toolbar.heading2'), icon: Heading2, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
      { id: 'h3', label: t('docs.toolbar.heading3'), icon: Heading3, run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
      { id: 'ul', label: t('docs.toolbar.bulletList'), icon: List, run: () => editor.chain().focus().toggleBulletList().run() },
      { id: 'ol', label: t('docs.toolbar.orderedList'), icon: ListOrdered, run: () => editor.chain().focus().toggleOrderedList().run() },
      { id: 'task', label: t('docs.toolbar.taskList'), icon: ListChecks, run: () => editor.chain().focus().toggleTaskList().run() },
      { id: 'quote', label: t('docs.toolbar.blockquote'), icon: Quote, run: () => editor.chain().focus().toggleBlockquote().run() },
      { id: 'code', label: t('docs.toolbar.codeBlock'), icon: Braces, run: () => editor.chain().focus().toggleCodeBlock().run() },
      { id: 'table', label: t('docs.toolbar.table'), icon: Table2, run: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
      { id: 'image', label: t('docs.toolbar.image'), icon: ImagePlus, run: onImage },
    ],
    [editor, onImage, t],
  )

  const gefiltert = useMemo(() => {
    const wert = query.trim().toLowerCase()
    if (!wert) return eintraege
    return eintraege.filter((eintrag) => eintrag.label.toLowerCase().includes(wert))
  }, [eintraege, query])

  useEffect(() => {
    setAktiv(0)
  }, [query])

  const ausfuehren = (index: number) => {
    const eintrag = gefiltert[index]
    if (!eintrag) return
    const { from } = editor.state.selection
    const start = from - (query.length + 1)
    editor.chain().focus().deleteRange({ from: Math.max(0, start), to: from }).run()
    eintrag.run()
    onClose()
  }

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setAktiv((alt) => (gefiltert.length ? (alt + 1) % gefiltert.length : 0))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setAktiv((alt) => (gefiltert.length ? (alt - 1 + gefiltert.length) % gefiltert.length : 0))
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        ausfuehren(aktiv)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  if (!gefiltert.length) return null

  let position = { top: 0, left: 0 }
  try {
    const coords = editor.view.coordsAtPos(editor.state.selection.from)
    position = { top: coords.bottom + 6, left: coords.left }
  } catch {
    /* Selection ausserhalb des Viewports. */
  }

  return (
    <div
      role="listbox"
      aria-label={t('docs.slash.label')}
      className="fixed z-50 max-h-72 w-60 overflow-y-auto rounded-xl border border-outline-variant/50 bg-surface-container p-1 shadow-xl"
      style={{ top: position.top, left: position.left }}
    >
      {gefiltert.map((eintrag, index) => {
        const Icon = eintrag.icon
        return (
          <button
            key={eintrag.id}
            type="button"
            role="option"
            aria-selected={index === aktiv}
            onMouseEnter={() => setAktiv(index)}
            onClick={() => ausfuehren(index)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm ${
              index === aktiv ? 'bg-primary/15 text-primary' : 'text-on-surface hover:bg-surface-container-high'
            }`}
          >
            <Icon className="h-4 w-4" />
            <span>{eintrag.label}</span>
          </button>
        )
      })}
    </div>
  )
}
