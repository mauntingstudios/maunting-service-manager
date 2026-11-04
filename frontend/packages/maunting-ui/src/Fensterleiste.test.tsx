import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Fensterleiste } from './Fensterleiste'

const steuerung = { minimieren: vi.fn(), maximieren: vi.fn(), schliessen: vi.fn() }
const beschriftungen = { minimieren: 'Minimieren', maximieren: 'Maximieren', schliessen: 'Schließen' }

describe('Fensterleiste', () => {
  it('nennt die drei Fensterknöpfe und führt sie aus', () => {
    const { container } = render(<Fensterleiste steuerung={steuerung} beschriftungen={beschriftungen} />)
    expect(container.firstElementChild).toHaveAttribute('data-tauri-drag-region')

    fireEvent.click(screen.getByRole('button', { name: 'Minimieren' }))
    fireEvent.click(screen.getByRole('button', { name: 'Maximieren' }))
    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }))

    expect(steuerung.minimieren).toHaveBeenCalledOnce()
    expect(steuerung.maximieren).toHaveBeenCalledOnce()
    expect(steuerung.schliessen).toHaveBeenCalledOnce()
  })

  it('gibt es nicht, wenn das Fenster keine Leiste trägt', () => {
    const { container } = render(
      <Fensterleiste steuerung={steuerung} beschriftungen={beschriftungen} sichtbar={false} />,
    )
    expect(container.firstChild).toBeNull()
  })
})
