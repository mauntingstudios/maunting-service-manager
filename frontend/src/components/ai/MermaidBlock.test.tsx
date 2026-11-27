import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MermaidBlock, sanitizeMermaidSvg, stripMermaidDirectives } from './MermaidBlock'

const mockInitialize = vi.fn()
const mockRender = vi.fn()

vi.mock('mermaid', () => ({
  default: {
    initialize: (...args: unknown[]) => mockInitialize(...args),
    render: (...args: unknown[]) => mockRender(...args),
  },
}))

describe('MermaidBlock security & rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('entfernt Mermaid-Directives wie %%{init:...}%% vor dem Rendern', () => {
    const raw = `%%{init: {'themeCSS': '* { background: url(https://evil.example/track) }', 'flowchart': {'htmlLabels': true}}}%%
flowchart LR
  A-->B`
    const stripped = stripMermaidDirectives(raw)
    expect(stripped).not.toContain('%%{')
    expect(stripped).not.toContain('themeCSS')
    expect(stripped).toContain('flowchart LR')
  })

  it('bereinigt SVG fail-closed gegen Skripte, Event-Handler, externe Bilder und CSS-Exfiltration', () => {
    const dirty = `
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
        <style>
          @import url(https://evil.example/a.css);
          .bg { background: /* split */ url("https://evil.example/track.png"); }
          .local { marker-end: url(#arrow); }
        </style>
        <script>alert(1)</script>
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">html</div></foreignObject>
        <image href="https://evil.example/pixel.png" />
        <a href="javascript:alert(1)"><rect width="10" height="10" /></a>
        <use xlink:href="#node1" />
        <path d="M0 0 L10 10" marker-end="url(#arrow)" style="background-image: url(https://evil.example/s.png); stroke: currentColor" />
      </svg>
    `
    const clean = sanitizeMermaidSvg(dirty)
    expect(clean).not.toContain('<script')
    expect(clean).not.toContain('<foreignObject')
    expect(clean).not.toContain('<image')
    expect(clean).not.toContain('onload')
    expect(clean).not.toContain('javascript:')
    expect(clean).not.toContain('@import')
    expect(clean).not.toContain('https://evil.example')
    expect(clean).toContain('url(#arrow)')
    expect(clean).toContain('#node1')
  })

  it('liefert bei defektem XML leeren String (fail-closed)', () => {
    expect(sanitizeMermaidSvg('<div>kein svg</div>')).toBe('')
    expect(sanitizeMermaidSvg('<svg><unclosed></svg>')).toBe('')
  })

  it('rendert gueltiges SVG bereinigt und faellt bei Render-Fehler auf Quelltext zurueck', async () => {
    mockRender.mockResolvedValueOnce({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><g><rect width="20" height="10" /></g><image href="https://evil.example/x.png" /></svg>',
    })

    const { container } = render(
      <MermaidBlock chart={'%%{init: {"theme": "base"}}%%\nflowchart LR\n  A-->B'} />,
    )

    await waitFor(() => {
      expect(container.querySelector('svg')).not.toBeNull()
    })
    expect(mockRender).toHaveBeenCalledWith(expect.any(String), 'flowchart LR\n  A-->B')
    expect(container.innerHTML).not.toContain('https://evil.example')

    mockRender.mockRejectedValueOnce(new Error('Syntax error'))
    render(<MermaidBlock chart="invalid %%% mermaid" />)

    await waitFor(() => {
      expect(screen.getByText('invalid %%% mermaid')).toBeInTheDocument()
    })
  })
})
