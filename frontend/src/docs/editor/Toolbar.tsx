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
  Quote,
  Redo2,
  Strikethrough,
  Table2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dropdown, Kurzinfo, prompt } from '@/Singra/UI'
import { cx } from '@/utils/classNames'

interface ToolbarProps {
  editor: Editor | null
  disabled?: boolean
  onImage: () => void
  onComment: () => void
  onAiUndo?: () => void
  aiUndoVisible?: boolean
}

function Werkzeug({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Kurzinfo text={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active || undefined}
        disabled={disabled}
        onClick={onClick}
        className={cx(
          'inline-flex h-9 w-9 items-center justify-center rounded-lg text-on-surface-variant transition-colors',
          'hover:bg-surface-container-high hover:text-on-surface disabled:opacity-40',
          active && 'bg-primary/15 text-primary',
        )}
      >
        {children}
      </button>
    </Kurzinfo>
  )
}

const ICON = 'h-4 w-4'

export function Toolbar({ editor, disabled, onImage, onComment }: ToolbarProps) {
  const { t } = useTranslation()
  if (!editor) return null

  const blockWert = editor.isActive('heading', { level: 1 })
    ? 'h1'
    : editor.isActive('heading', { level: 2 })
      ? 'h2'
      : editor.isActive('heading', { level: 3 })
        ? 'h3'
        : 'p'

  const linkSetzen = async () => {
    const alt = editor.getAttributes('link').href as string | undefined
    const ziel = await prompt({
      title: t('docs.toolbar.link'),
      message: t('docs.toolbar.linkPrompt'),
      placeholder: 'https://',
      defaultValue: alt && alt !== 'https://' ? alt : '',
    })
    if (ziel === null) return
    const wert = ziel.trim()
    if (!wert) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: wert }).run()
  }

  return (
    <div
      role="toolbar"
      aria-label={t('docs.toolbar.label')}
      className="flex flex-wrap items-center gap-1 border-b border-outline-variant/40 px-2 py-1.5"
    >
      <Dropdown
        aria-label={t('docs.toolbar.block')}
        value={blockWert}
        onChange={(wert) => {
          const kette = editor.chain().focus()
          if (wert === 'p') kette.setParagraph().run()
          else kette.toggleHeading({ level: Number(wert.slice(1)) as 1 | 2 | 3 }).run()
        }}
        options={[
          { value: 'p', label: t('docs.toolbar.paragraph'), icon: <Pilcrow className={ICON} /> },
          { value: 'h1', label: t('docs.toolbar.heading1'), icon: <Heading1 className={ICON} /> },
          { value: 'h2', label: t('docs.toolbar.heading2'), icon: <Heading2 className={ICON} /> },
          { value: 'h3', label: t('docs.toolbar.heading3'), icon: <Heading3 className={ICON} /> },
        ]}
        buttonClassName="h-9 min-w-[8.5rem]"
      />

      <span className="mx-1 h-6 w-px bg-outline-variant/50" aria-hidden />

      <Werkzeug label={t('docs.toolbar.undo')} disabled={disabled} onClick={() => editor.chain().focus().undo().run()}>
        <Undo2 className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.redo')} disabled={disabled} onClick={() => editor.chain().focus().redo().run()}>
        <Redo2 className={ICON} />
      </Werkzeug>

      <span className="mx-1 h-6 w-px bg-outline-variant/50" aria-hidden />

      <Werkzeug label={t('docs.toolbar.bold')} active={editor.isActive('bold')} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.italic')} active={editor.isActive('italic')} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.underline')} active={editor.isActive('underline')} disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.strike')} active={editor.isActive('strike')} disabled={disabled} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.code')} active={editor.isActive('code')} disabled={disabled} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.highlight')} active={editor.isActive('highlight')} disabled={disabled} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        <Highlighter className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.link')} active={editor.isActive('link')} disabled={disabled} onClick={() => void linkSetzen()}>
        <Link2 className={ICON} />
      </Werkzeug>

      <span className="mx-1 h-6 w-px bg-outline-variant/50" aria-hidden />

      <Werkzeug label={t('docs.toolbar.bulletList')} active={editor.isActive('bulletList')} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.orderedList')} active={editor.isActive('orderedList')} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.taskList')} active={editor.isActive('taskList')} disabled={disabled} onClick={() => editor.chain().focus().toggleTaskList().run()}>
        <ListChecks className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.blockquote')} active={editor.isActive('blockquote')} disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.codeBlock')} active={editor.isActive('codeBlock')} disabled={disabled} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
        <Braces className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.horizontalRule')} disabled={disabled} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.table')} active={editor.isActive('table')} disabled={disabled} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
        <Table2 className={ICON} />
      </Werkzeug>
      <Werkzeug label={t('docs.toolbar.image')} disabled={disabled} onClick={onImage}>
        <ImagePlus className={ICON} />
      </Werkzeug>

      <span className="mx-1 h-6 w-px bg-outline-variant/50" aria-hidden />

      <Werkzeug label={t('docs.toolbar.comment')} disabled={disabled} onClick={onComment}>
        <MessageSquarePlus className={ICON} />
      </Werkzeug>
    </div>
  )
}
