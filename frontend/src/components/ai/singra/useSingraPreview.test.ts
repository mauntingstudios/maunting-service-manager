import { createElement, createRef } from 'react'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AiProject } from '@/api/ai'
import { SingraPreviewTab } from './SingraPreviewTab'
import { buildPreviewBridgeScript } from './useSingraPreview'

function installBridgeInDocument(): void {
  document.body.innerHTML = ''
  const raw = buildPreviewBridgeScript()
  const match = raw.match(/<script>([\s\S]*)<\/script>/)
  if (!match) throw new Error('Bridge script tag missing')
  window.eval(match[1])
}

describe('buildPreviewBridgeScript navigation guard', () => {
  it('blockiert Navigation bei leeren, Root-, relativen und javascript:-Links ohne Klick-Handler zu stoppen', () => {
    installBridgeInDocument()
    const logoClick = vi.fn()

    document.body.innerHTML = `
      <a id="empty-link" href=""><span>Logo</span></a>
      <a id="root-link" href="/"><svg id="logo-svg"></svg></a>
      <a id="js-link" href="javascript:alert(1)">XSS</a>
      <a id="anchor-link" href="#wetter">Abschnitt</a>
      <form id="search-form"><button type="submit">Suche</button></form>
    `

    const rootLink = document.getElementById('root-link')!
    rootLink.addEventListener('click', logoClick)

    const emptyEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.querySelector('#empty-link span')!.dispatchEvent(emptyEvent)
    expect(emptyEvent.defaultPrevented).toBe(true)

    const rootEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('logo-svg')!.dispatchEvent(rootEvent)
    expect(rootEvent.defaultPrevented).toBe(true)
    expect(logoClick).toHaveBeenCalledTimes(1)

    const jsEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('js-link')!.dispatchEvent(jsEvent)
    expect(jsEvent.defaultPrevented).toBe(true)

    const anchorEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('anchor-link')!.dispatchEvent(anchorEvent)
    expect(anchorEvent.defaultPrevented).toBe(false)

    const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
    document.getElementById('search-form')!.dispatchEvent(submitEvent)
    expect(submitEvent.defaultPrevented).toBe(true)
  })
})

describe('SingraPreviewTab iframe sandbox', () => {
  it('rendert srcDoc-Vorschau ohne allow-same-origin in sandbox', () => {
    const project = {
      id: 'proj-1',
      name: 'PreviewTest',
      description: '',
      project_kind: 'coding',
      sandbox_enabled: false,
      sandbox_path: null,
      local_directory: null,
      git_repo_url: null,
      git_provider: null,
      git_branch: 'main',
      system_prompt: null,
      created_at: '2026-11-27T00:00:00Z',
      updated_at: '2026-11-27T00:00:00Z',
    } as unknown as AiProject

    const { container } = render(
      createElement(SingraPreviewTab, {
        selectedProject: project,
        files: [{ path: 'index.html', content: '<h1>Hallo</h1>' } as never],
        productionFiles: [],
        projectChats: [],
        envState: null,
        devStatus: null,
        devStatusLoading: false,
        resolvedDevWebUrl: null,
        previewEnv: 'dev',
        setPreviewEnv: vi.fn(),
        devPreviewMode: 'bundle',
        setDevPreviewMode: vi.fn(),
        previewDevice: 'desktop',
        setPreviewDevice: vi.fn(),
        inspectMode: false,
        setInspectMode: vi.fn(),
        inspectElement: null,
        setInspectElement: vi.fn(),
        inspectTargetChatId: '__latest__',
        setInspectTargetChatId: vi.fn(),
        fixTargetChatId: '__latest__',
        setFixTargetChatId: vi.fn(),
        previewIframeRef: createRef<HTMLIFrameElement>(),
        previewSrcDoc: '<html><body><h1>Hallo</h1></body></html>',
        previewError: null,
        previewErrorDismissed: false,
        setPreviewErrorDismissed: vi.fn(),
        visualLoading: false,
        devConsoleOpen: false,
        setDevConsoleOpen: vi.fn(),
        consoleLogs: [],
        setConsoleLogs: vi.fn(),
        consoleFilter: 'all',
        setConsoleFilter: vi.fn(),
        onOpenPublishModal: vi.fn(),
        onRunVisualInspection: vi.fn(),
        onApplyElementWithSingra: vi.fn(),
        onFixPreviewWithSingra: vi.fn(),
        onStartDevSandbox: vi.fn(),
        onStopDevSandbox: vi.fn(),
        onOpenProjectChat: vi.fn(),
      }),
    )

    const iframe = container.querySelector('iframe[title="Projekt-Vorschau"]')
    expect(iframe).not.toBeNull()
    const sandbox = iframe?.getAttribute('sandbox') ?? ''
    expect(sandbox).toContain('allow-scripts')
    expect(sandbox).not.toContain('allow-same-origin')
  })
})
