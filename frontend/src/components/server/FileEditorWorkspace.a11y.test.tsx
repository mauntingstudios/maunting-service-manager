import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { FileEditorWorkspace } from './FileEditorWorkspace'
import type { EditorTab } from './fileWorkspaceTypes'

vi.mock('@uiw/react-codemirror', () => ({
  default: ({
    className,
    height,
    onCreateEditor,
  }: {
    className?: string
    height?: string
    onCreateEditor: (view: { dispatch: ReturnType<typeof vi.fn>; focus: () => void }) => void
  }) => (
    <button
      type="button"
      data-testid="code-editor"
      data-height={height}
      className={className}
      onClick={(event) => {
        const editorElement = event.currentTarget
        onCreateEditor({
          dispatch: vi.fn(),
          focus: () => editorElement.focus(),
        })
      }}
    />
  ),
}))

function tab(path: string, content = ''): EditorTab {
  return {
    path,
    content,
    savedContent: content,
    revision: 'revision',
    lineEnding: '\n',
    loading: false,
    saveState: 'clean',
    size: 0,
    modified: 0,
    mode: null,
    owner: null,
    group: null,
  }
}

describe('FileEditorWorkspace tabs', () => {
  // Die sichtbaren Texte kommen jetzt aus der Sprachdatei. Ohne feste Sprache
  // hängen die Erwartungen unten an der Spracherkennung der Testumgebung.
  beforeEach(async () => {
    await i18n.changeLanguage('de')
  })

  it('binds the CodeMirror wrapper and editor to the available height', () => {
    render(
      <FileEditorWorkspace
        tabs={[tab('config/server.ini', 'setting=value')]}
        activePath="config/server.ini"
        canWrite
        tabListLabel="Open files"
        horizontalScrollHint="Scroll horizontally"
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    )

    expect(screen.getByTestId('code-editor')).toHaveClass('h-full')
    expect(screen.getByTestId('code-editor')).toHaveAttribute('data-height', '100%')
  })

  it('uses sibling native controls and supports roving arrow navigation', async () => {
    const onActivate = vi.fn()
    render(
      <FileEditorWorkspace
        tabs={[tab('config/one.ini'), tab('config/two.ini')]}
        activePath="config/one.ini"
        canWrite
        tabListLabel="Open files"
        horizontalScrollHint="Scroll horizontally"
        onActivate={onActivate}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    )

    const first = screen.getByRole('tab', { name: 'one.ini' })
    const second = screen.getByRole('tab', { name: 'two.ini' })
    const close = screen.getByRole('button', { name: 'one.ini schließen' })
    expect(first.contains(close)).toBe(false)
    expect(first).toHaveAttribute('tabindex', '0')
    expect(second).toHaveAttribute('tabindex', '-1')

    first.focus()
    const focusSpy = vi.spyOn(second, 'focus')
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(onActivate).toHaveBeenCalledWith('config/two.ini')
    await waitFor(() => expect(second).toHaveFocus())
    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('keeps focus in find and replacement inputs while selecting matches', async () => {
    render(
      <FileEditorWorkspace
        tabs={[tab('config/server.ini', 'Alpha=one\nAlpha=two')]}
        activePath="config/server.ini"
        canWrite
        tabListLabel="Open files"
        horizontalScrollHint="Scroll horizontally"
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByTestId('code-editor'))
    fireEvent.click(screen.getByRole('button', { name: 'Suchen und ersetzen' }))

    const findInput = await screen.findByPlaceholderText(/Suchen/)
    await waitFor(() => expect(findInput).toHaveFocus())
    // Felder aus der Design-DNA (Input), unter md 44 px hoch; bis 02.10.2026 nativ und 32 px.
    for (const feld of [findInput, screen.getByPlaceholderText(/Ersetzen/)]) {
      expect(feld).toHaveClass('msm-input', 'max-md:h-11')
      expect(feld.parentElement).toHaveClass('flex-col')
    }
    fireEvent.change(findInput, { target: { value: 'Alpha' } })
    expect(findInput).toHaveFocus()
    fireEvent.keyDown(findInput, { key: 'Enter' })
    expect(findInput).toHaveFocus()
    fireEvent.keyDown(findInput, { key: 'Enter', shiftKey: true })
    expect(findInput).toHaveFocus()

    const replacementInput = screen.getByPlaceholderText(/Ersetzen durch/)
    replacementInput.focus()
    fireEvent.change(replacementInput, { target: { value: 'Beta' } })
    expect(replacementInput).toHaveFocus()
  })
})

/**
 * Der Editor war vollständig auf Deutsch verdrahtet, während der Dateibaum
 * daneben längst aus dem Katalog las. Wer die Oberfläche auf Englisch stellte,
 * bekam im selben Bild einen englischen Baum und einen deutschen Editor — bis
 * hin zum Warnhinweis über den Änderungskonflikt. Diese Tests halten fest, dass
 * die sichtbaren Texte aus der Sprachdatei kommen und nicht aus dem Quelltext.
 */
describe('FileEditorWorkspace — Sprachwahl', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  afterEach(async () => {
    await i18n.changeLanguage('de')
  })

  it('beschriftet Suchleiste und Speichern in der gewählten Sprache', () => {
    render(
      <FileEditorWorkspace
        tabs={[tab('config/server.ini', 'Alpha=one')]}
        activePath="config/server.ini"
        canWrite
        tabListLabel="Open files"
        horizontalScrollHint="Scroll horizontally"
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Search and replace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close server.ini' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Speichern' })).toBeNull()
  })

  it('führt den Konflikthinweis in der gewählten Sprache', () => {
    render(
      <FileEditorWorkspace
        tabs={[{ ...tab('config/server.ini', 'Alpha=one'), saveState: 'conflict' }]}
        activePath="config/server.ini"
        canWrite
        tabListLabel="Open files"
        horizontalScrollHint="Scroll horizontally"
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Reload server version' })).toBeInTheDocument()
    expect(screen.getByText(/changed outside this editor/i)).toBeInTheDocument()
  })

  it('zeigt den leeren Editor in der gewählten Sprache', () => {
    render(
      <FileEditorWorkspace
        tabs={[]}
        activePath={null}
        canWrite
        tabListLabel="Open files"
        horizontalScrollHint="Scroll horizontally"
        onActivate={vi.fn()}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onClose={vi.fn()}
        onReload={vi.fn()}
      />,
    )

    expect(screen.getByText('No file open')).toBeInTheDocument()
    expect(screen.getByText('Open a file to edit')).toBeInTheDocument()
  })
})

/**
 * Strg+F galt nur, solange CodeMirror den Fokus hatte. Lag er auf einem Knopf
 * der Kopfzeile oder (im Tresor) irgendwo im Vollbild, öffnete der Browser
 * seine eigene Suche, die im Editor nichts ersetzen kann.
 */
describe('FileEditorWorkspace — Tastenkürzel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
  })

  const props = (extra: Partial<React.ComponentProps<typeof FileEditorWorkspace>> = {}) => ({
    tabs: [tab('notizen/liste.txt', 'Alpha\nBeta')],
    activePath: 'notizen/liste.txt',
    canWrite: true,
    tabListLabel: 'Offene Dateien',
    horizontalScrollHint: 'Seitlich scrollen',
    onActivate: vi.fn(),
    onChange: vi.fn(),
    onSave: vi.fn(),
    onClose: vi.fn(),
    onReload: vi.fn(),
    ...extra,
  })

  it('öffnet mit Strg+F die eigene Suche, auch wenn ein Knopf den Fokus hat', async () => {
    render(<FileEditorWorkspace {...props()} />)
    const speichern = screen.getByRole('button', { name: 'Speichern' })
    const ereignis = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    speichern.dispatchEvent(ereignis)

    expect(ereignis.defaultPrevented).toBe(true)
    const suche = await screen.findByRole('textbox', { name: /Suchen/ })
    await waitFor(() => expect(suche).toHaveFocus())
  })

  it('setzt mit Strg+H den Fokus ins Ersetzen-Feld und speichert mit Strg+S', async () => {
    const onSave = vi.fn()
    render(<FileEditorWorkspace {...props({ onSave })} />)
    const knopf = screen.getByRole('button', { name: 'Suchen und ersetzen' })
    fireEvent.keyDown(knopf, { key: 'h', ctrlKey: true })
    const ersetzen = await screen.findByRole('textbox', { name: /Ersetzen durch/ })
    await waitFor(() => expect(ersetzen).toHaveFocus())

    fireEvent.keyDown(ersetzen, { key: 's', ctrlKey: true })
    expect(onSave).toHaveBeenCalledWith('notizen/liste.txt')
    fireEvent.keyDown(ersetzen, { key: 'Escape' })
    expect(screen.queryByRole('textbox', { name: /Ersetzen durch/ })).toBeNull()
  })

  it('fängt Strg+F auch im normalen Dateimanager im ganzen Dokument ab, wenn eine Datei offen ist', async () => {
    render(<FileEditorWorkspace {...props()} />)
    const ereignis = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(ereignis)

    expect(ereignis.defaultPrevented).toBe(true)
    const suche = await screen.findByRole('textbox', { name: /Suchen/ })
    await waitFor(() => expect(suche).toHaveFocus())
  })

  it('fängt im Vollbild Strg+F im ganzen Dokument ab und zeigt den eigenen Ort', async () => {
    render(<FileEditorWorkspace {...props({ vollbild: true, ortLabel: 'Tresor / Notizen / liste.txt' })} />)
    expect(screen.getByText('Tresor / Notizen / liste.txt')).toBeInTheDocument()
    expect(screen.queryByText(/Server-Dateien/)).toBeNull()

    const ereignis = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    document.body.dispatchEvent(ereignis)
    expect(ereignis.defaultPrevented).toBe(true)
    expect(await screen.findByRole('textbox', { name: /Suchen/ })).toBeInTheDocument()
  })

  it('hat im Vollbild keine Mindesthöhe, damit er bei offener Tastatur in den sichtbaren Bereich passt', () => {
    const { unmount } = render(<FileEditorWorkspace {...props({ vollbild: true })} />)
    const vollbild = screen.getByRole('tablist').closest('section')!.className.split(/\s+/)
    expect(vollbild).not.toContain('min-h-[520px]')
    expect(vollbild).toContain('min-h-0')
    expect(vollbild).toContain('max-h-[100dvh]')
    unmount()

    // Eingebettet (Server-Dateimanager) bleibt die Mindesthöhe unterhalb von lg.
    render(<FileEditorWorkspace {...props()} />)
    expect(screen.getByRole('tablist').closest('section')!.className.split(/\s+/)).toContain('min-h-[520px]')
  })

  it('rendert Suchen-und-Ersetzen-Knöpfe ohne px-3-Kollision und mit vollen 16px-Icons', async () => {
    render(<FileEditorWorkspace {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Suchen und ersetzen' }))

    const prev = await screen.findByRole('button', { name: i18n.t('files.editor.previousMatch') })
    const next = screen.getByRole('button', { name: i18n.t('files.editor.nextMatch') })
    const closeSearch = screen.getByRole('button', { name: i18n.t('files.editor.closeSearch') })
    const matchCase = screen.getByRole('button', { name: i18n.t('files.editor.matchCase') })

    for (const btn of [prev, next, closeSearch, matchCase]) {
      expect(btn.className).toContain('p-0')
      expect(btn.className).toContain('[&_svg]:shrink-0')
      expect(btn.className).not.toContain('px-3')
    }
    for (const btn of [prev, next, closeSearch]) {
      const svg = btn.querySelector('svg')
      expect(svg).not.toBeNull()
      expect(svg!.getAttribute('class')).toContain('h-4')
      expect(svg!.getAttribute('class')).toContain('w-4')
      expect(svg!.getAttribute('class')).toContain('shrink-0')
    }

    const closeTab = screen.getByRole('button', { name: 'liste.txt schließen' })
    const closeTabSvg = closeTab.querySelector('svg')
    expect(closeTabSvg).not.toBeNull()
    expect(closeTabSvg!.getAttribute('class')).not.toContain('h-3 w-3')
    expect(closeTabSvg!.getAttribute('class')).toContain('h-3.5')
  })
})
