import { useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Bold,
  Braces,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Highlighter,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquarePlus,
  Minus,
  Pilcrow,
  Plus,
  Quote,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Blattmenue, Kurzinfo, buttonClasses, prompt } from '@/Singra/UI'
import { cx } from '@/utils/classNames'

interface MobileToolbarProps {
  editor: Editor | null
  disabled?: boolean
  onImage: () => void
  onComment: () => void
}

function Knopf({
  label,
  aktiv,
  disabled,
  onClick,
  children,
}: {
  label: string
  aktiv?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Kurzinfo text={label} lage="oben">
      <button
        type="button"
        aria-label={label}
        aria-pressed={aktiv || undefined}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          'inline-flex h-11 w-11 items-center justify-center rounded-xl text-on-surface-variant',
          'active:bg-surface-container-high disabled:opacity-40',
          aktiv && 'bg-primary/15 text-primary',
        )}
      >
        {children}
      </button>
    </Kurzinfo>
  )
}

const ICON = 'h-5 w-5'

export function MobileToolbar({ editor, disabled, onImage, onComment }: MobileToolbarProps) {
  const { t } = useTranslation()
  const [offen, setOffen] = useState(false)
  if (!editor) return null

  const schliessen = () => setOffen(false)
  const ausfuehren = (fn: () => void) => {
    fn()
    schliessen()
  }
  const linkSetzen = async () => {
    const alt = editor.getAttributes('link').href as string | undefined
    const ziel = await prompt({
      title: t('docs.toolbar.link'),
      message: t('docs.toolbar.linkPrompt'),
      placeholder: 'https://',
      defaultValue: alt ?? '',
    })
    if (ziel === null) return
    if (!ziel.trim()) editor.chain().focus().extendMarkRange('link').unsetLink().run()
    else editor.chain().focus().extendMarkRange('link').setLink({ href: ziel.trim() }).run()
    schliessen()
  }

  return (
    <>
      <div
        className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-outline-variant/40 bg-surface-container px-2 py-1 pb-[max(0.25rem,var(--msm-unten-sicher,0px))]"
        role="toolbar"
        aria-label={t('docs.toolbar.label')}
      >
        <Knopf label={t('docs.toolbar.bold')} aktiv={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold className={ICON} />
        </Knopf>
        <Knopf label={t('docs.toolbar.italic')} aktiv={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic className={ICON} />
        </Knopf>
        <Knopf label={t('docs.toolbar.bulletList')} aktiv={editor.isActive('bulletList')} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List className={ICON} />
        </Knopf>
        <Knopf label={t('docs.toolbar.comment')} disabled={disabled} onClick={onComment}>
          <MessageSquarePlus className={ICON} />
        </Knopf>
        <button
          type="button"
          onClick={() => setOffen(true)}
          aria-label={t('docs.toolbar.more')}
          className={buttonClasses('primary', 'icon', 'ml-auto h-10 w-10 rounded-xl')}
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <Blattmenue offen={offen} onSchliessen={schliessen} titel={t('docs.toolbar.label')}>
        <div className="grid grid-cols-4 gap-1 p-2">
          <Knopf label={t('docs.toolbar.paragraph')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().setParagraph().run())}>
            <Pilcrow className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.heading1')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}>
            <Heading1 className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.heading2')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}>
            <Heading2 className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.heading3')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}>
            <Heading3 className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.underline')} aktiv={editor.isActive('underline')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleUnderline().run())}>
            <UnderlineIcon className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.strike')} aktiv={editor.isActive('strike')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleStrike().run())}>
            <Strikethrough className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.code')} aktiv={editor.isActive('code')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleCode().run())}>
            <Code className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.highlight')} aktiv={editor.isActive('highlight')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleHighlight().run())}>
            <Highlighter className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.link')} aktiv={editor.isActive('link')} disabled={disabled} onClick={() => void linkSetzen()}>
            <Link2 className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.orderedList')} aktiv={editor.isActive('orderedList')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleOrderedList().run())}>
            <ListOrdered className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.taskList')} aktiv={editor.isActive('taskList')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleTaskList().run())}>
            <ListChecks className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.blockquote')} aktiv={editor.isActive('blockquote')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleBlockquote().run())}>
            <Quote className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.codeBlock')} aktiv={editor.isActive('codeBlock')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().toggleCodeBlock().run())}>
            <Braces className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.horizontalRule')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().setHorizontalRule().run())}>
            <Minus className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.table')} aktiv={editor.isActive('table')} disabled={disabled} onClick={() => ausfuehren(() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run())}>
            <Table2 className={ICON} />
          </Knopf>
          <Knopf label={t('docs.toolbar.image')} disabled={disabled} onClick={() => ausfuehren(onImage)}>
            <ImagePlus className={ICON} />
          </Knopf>
        </div>
      </Blattmenue>
    </>
  )
}
