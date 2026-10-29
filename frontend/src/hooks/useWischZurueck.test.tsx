import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useWischZurueck } from './useWischZurueck'

function Wischer({ aktiv, onZurueck }: { aktiv: boolean; onZurueck: () => void }) {
  useWischZurueck(aktiv, onZurueck)
  return <div data-testid="flaeche" />
}

/** Ein Wisch als zwei Ereignisse — jsdom kennt keine echten Berührungen. */
function wische(von: number, nach: number, ziel: EventTarget = window, dy = 0) {
  const start = new Event('touchstart', { bubbles: true })
  Object.defineProperty(start, 'touches', { value: [{ clientX: von, clientY: 200 }] })
  ziel.dispatchEvent(start)

  const ende = new Event('touchend', { bubbles: true })
  Object.defineProperty(ende, 'changedTouches', { value: [{ clientX: nach, clientY: 200 + dy }] })
  ziel.dispatchEvent(ende)
}

afterEach(() => {
  delete (window as { __msbZurueck?: () => boolean }).__msbZurueck
})

describe('useWischZurueck', () => {
  it('geht beim Wisch vom linken Rand zurück', () => {
    const zurueck = vi.fn()
    render(<Wischer aktiv onZurueck={zurueck} />)

    wische(5, 120)

    expect(zurueck).toHaveBeenCalledTimes(1)
  })

  it('geht beim Wisch vom rechten Rand nach links zurück', () => {
    const zurueck = vi.fn()
    render(<Wischer aktiv onZurueck={zurueck} />)

    wische(window.innerWidth - 5, window.innerWidth - 120)

    expect(zurueck).toHaveBeenCalledTimes(1)
  })

  it('lässt die Mitte dem Inhalt', () => {
    const zurueck = vi.fn()
    render(<Wischer aktiv onZurueck={zurueck} />)

    wische(window.innerWidth / 2, window.innerWidth / 2 + 150)

    expect(zurueck).not.toHaveBeenCalled()
  })

  it('schweigt über Dialogen und Eingabefeldern', () => {
    const zurueck = vi.fn()
    const { getByTestId } = render(
      <>
        <Wischer aktiv onZurueck={zurueck} />
        <div role="dialog" data-testid="dialog">
          <input data-testid="feld" />
        </div>
      </>,
    )

    wische(5, 120, getByTestId('dialog'))
    wische(5, 120, getByTestId('feld'))

    expect(zurueck).not.toHaveBeenCalled()
  })

  it('schweigt, solange kein Chat offen ist', () => {
    const zurueck = vi.fn()
    render(<Wischer aktiv={false} onZurueck={zurueck} />)

    wische(5, 120)

    expect(zurueck).not.toHaveBeenCalled()
  })

  it('schweigt in Pontis, wo die Randgeste am Fenster schon läuft', () => {
    ;(window as { __msbZurueck?: () => boolean }).__msbZurueck = () => true
    const zurueck = vi.fn()
    render(<Wischer aktiv onZurueck={zurueck} />)

    wische(5, 120)

    expect(zurueck).not.toHaveBeenCalled()
  })
})
