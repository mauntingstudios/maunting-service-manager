import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { Editor } from '@tiptap/react'
import { SlashMenu } from './SlashMenu'
import { Toolbar } from './Toolbar'

const aufrufe: string[] = []

function kette() {
  const ketteObj: Record<string, unknown> = {}
  for (const methode of [
    'focus',
    'undo',
    'redo',
    'toggleBold',
    'toggleItalic',
    'toggleUnderline',
    'toggleStrike',
    'toggleCode',
    'toggleHighlight',
    'toggleBulletList',
    'toggleOrderedList',
    'toggleTaskList',
    'toggleBlockquote',
    'toggleCodeBlock',
    'setHorizontalRule',
    'setParagraph',
    'toggleHeading',
    'setMark',
    'insertTable',
    'deleteRange',
    'extendMarkRange',
    'unsetLink',
    'setLink',
    'insertContent',
  ]) {
    ketteObj[methode] = (...args: unknown[]) => {
      aufrufe.push(args.length ? `${methode}:${JSON.stringify(args[0])}` : methode)
      return ketteObj
    }
  }
  ketteObj.run = () => true
  return ketteObj
}

const editor = {
  chain: () => kette(),
  isActive: () => false,
  getAttributes: () => ({}),
  state: { selection: { from: 3, to: 3 } },
  view: { coordsAtPos: () => ({ bottom: 10, left: 5 }) },
} as unknown as Editor

beforeEach(() => {
  aufrufe.length = 0
})

describe('Toolbar', () => {
  it('führt Formatbefehle aus und reicht Bild/Kommentar weiter', () => {
    const onImage = vi.fn()
    const onComment = vi.fn()
    render(<Toolbar editor={editor} onImage={onImage} onComment={onComment} />)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.toolbar.bold') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.toolbar.undo') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.toolbar.table') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.toolbar.image') }))
    fireEvent.click(screen.getByRole('button', { name: i18n.t('docs.toolbar.comment') }))

    expect(aufrufe).toContain('toggleBold')
    expect(aufrufe).toContain('undo')
    expect(aufrufe).toContain('insertTable:{"rows":3,"cols":3,"withHeaderRow":true}')
    expect(onImage).toHaveBeenCalled()
    expect(onComment).toHaveBeenCalled()
  })

  it('sperrt alle Werkzeuge, solange der Sync aussteht', () => {
    render(<Toolbar editor={editor} disabled onImage={() => {}} onComment={() => {}} />)
    expect(screen.getByRole('button', { name: i18n.t('docs.toolbar.bold') })).toBeDisabled()
    expect(screen.getByRole('button', { name: i18n.t('docs.toolbar.table') })).toBeDisabled()
    expect(screen.getByRole('button', { name: i18n.t('docs.toolbar.image') })).toBeDisabled()
  })
})

describe('SlashMenu', () => {
  it('filtert nach der Eingabe und führt den Treffer per Tastatur aus', () => {
    const onClose = vi.fn()
    const onImage = vi.fn()
    render(
      <SlashMenu editor={editor} query={i18n.t('docs.toolbar.table')} onClose={onClose} onImage={onImage} />,
    )

    const optionen = screen.getAllByRole('option')
    expect(optionen).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'Enter' })

    expect(aufrufe.some((eintrag) => eintrag.startsWith('deleteRange'))).toBe(true)
    expect(aufrufe).toContain('insertTable:{"rows":3,"cols":3,"withHeaderRow":true}')
    expect(onClose).toHaveBeenCalled()
    expect(onImage).not.toHaveBeenCalled()
  })

  it('schließt mit Escape und wandert mit den Pfeiltasten', () => {
    const onClose = vi.fn()
    render(<SlashMenu editor={editor} query="" onClose={onClose} onImage={() => {}} />)

    fireEvent.keyDown(window, { key: 'ArrowDown' })
    const optionen = screen.getAllByRole('option')
    expect(optionen[1]).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('wählt Bilder über den Menüeintrag', () => {
    const onImage = vi.fn()
    const onClose = vi.fn()
    render(
      <SlashMenu editor={editor} query={i18n.t('docs.toolbar.image')} onClose={onClose} onImage={onImage} />,
    )
    fireEvent.click(screen.getByRole('option'))
    expect(onImage).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })
})
