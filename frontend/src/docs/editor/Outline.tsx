import { useEffect, useState } from 'react'
import type { Editor } from '@tiptap/react'
import { useTranslation } from 'react-i18next'

export interface OutlineEntry {
  pos: number
  level: number
  text: string
}

/**
 * Die Überschriften des Dokuments, live am Editor.
 *
 * Der Editor gehört `DocEditor`, das Panel gehört `DocsApp`. Diese beiden
 * Hälften bleiben getrennt: Der Hook liest nur und liefert die Liste nach
 * oben, damit sie in derselben rechten Seitenleiste wie Kommentare und
 * Verlauf gezeichnet werden kann.
 */
export function useOutlineEntries(editor: Editor | null): OutlineEntry[] {
  const { t } = useTranslation()
  const [eintraege, setEintraege] = useState<OutlineEntry[]>([])

  useEffect(() => {
    if (!editor) {
      setEintraege([])
      return
    }
    const lesen = () => {
      const naechste: OutlineEntry[] = []
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== 'heading') return
        naechste.push({
          pos,
          level: Number(node.attrs.level) || 1,
          text: node.textContent || t('docs.tree.untitled'),
        })
      })
      setEintraege(naechste)
    }
    lesen()
    editor.on('update', lesen)
    return () => {
      editor.off('update', lesen)
    }
  }, [editor, t])

  return eintraege
}

export function OutlineList({
  entries,
  onJump,
}: {
  entries: OutlineEntry[]
  onJump: (pos: number) => void
}) {
  const { t } = useTranslation()

  if (!entries.length) {
    return <p className="px-3 py-2 text-xs text-on-surface-variant">{t('docs.outline.empty')}</p>
  }

  return (
    <nav aria-label={t('docs.outline.label')} className="flex flex-col gap-0.5 px-2 py-1">
      {entries.map((eintrag, index) => (
        <button
          key={`${eintrag.pos}-${index}`}
          type="button"
          onClick={() => onJump(eintrag.pos)}
          className="truncate rounded-md px-2 py-1.5 text-left text-xs text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
          style={{ paddingLeft: `${8 + (eintrag.level - 1) * 12}px` }}
        >
          {eintrag.text}
        </button>
      ))}
    </nav>
  )
}