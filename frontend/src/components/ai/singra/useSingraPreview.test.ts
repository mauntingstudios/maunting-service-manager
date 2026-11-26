import { describe, expect, it, vi } from 'vitest'
import { buildPreviewBridgeScript } from './useSingraPreview'

function installBridgeInDocument(): void {
  document.body.innerHTML = ''
  const raw = buildPreviewBridgeScript()
  const match = raw.match(/<script>([\s\S]*)<\/script>/)
  if (!match) throw new Error('Bridge script tag missing')
  window.eval(match[1])
}

describe('buildPreviewBridgeScript navigation guard', () => {
  it('blockiert Navigation bei leeren, Root- und relativen Links ohne Klick-Handler zu stoppen', () => {
    installBridgeInDocument()
    const logoClick = vi.fn()

    document.body.innerHTML = `
      <a id="empty-link" href=""><span>Logo</span></a>
      <a id="root-link" href="/"><svg id="logo-svg"></svg></a>
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

    const anchorEvent = new MouseEvent('click', { bubbles: true, cancelable: true })
    document.getElementById('anchor-link')!.dispatchEvent(anchorEvent)
    expect(anchorEvent.defaultPrevented).toBe(false)

    const submitEvent = new Event('submit', { bubbles: true, cancelable: true })
    document.getElementById('search-form')!.dispatchEvent(submitEvent)
    expect(submitEvent.defaultPrevented).toBe(true)
  })
})
