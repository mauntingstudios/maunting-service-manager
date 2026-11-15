import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ProgressRing } from './ProgressRing'

describe('ProgressRing', () => {
  it('rendert ein natives <progress> ohne doppelten Screenreader-Text im Zentrum', () => {
    const { container } = render(
      <ProgressRing
        value={42.4}
        label="CPU"
        displayValue="42.4%"
        hint="von 100%"
      />,
    )

    const progress = screen.getByRole('progressbar', { name: 'CPU' })
    expect(progress.tagName).toBe('PROGRESS')
    expect(progress).toHaveAttribute('value', '42')
    expect(progress).toHaveAttribute('aria-valuetext', '42.4% · von 100%')
    expect(screen.getByText('42%').closest('[aria-hidden="true"]')).not.toBeNull()
    expect(container.querySelectorAll('[title]')).toHaveLength(0)
  })

  it('meldet „unbekannt“, wenn kein Prozentwert vorliegt', () => {
    render(
      <ProgressRing
        value={null}
        label="RAM"
        displayValue="—"
        hint="Unbegrenzt"
      />,
    )

    const progress = screen.getByRole('progressbar', { name: 'RAM' })
    expect(progress).not.toHaveAttribute('value')
    expect(progress).toHaveAttribute('aria-valuetext', 'unbekannt')
  })

  it('wechselt bei heat-Schwellen auf Warn- und Gefahrenfarbe', () => {
    const { rerender } = render(
      <ProgressRing
        value={75}
        label="RAM"
        displayValue="3.0 GB"
        hint="von 4.0 GB"
        heat
      />,
    )
    expect(screen.getByRole('progressbar')).toHaveStyle({
      '--ring-fill': 'hsl(var(--mui-warning))',
    })

    rerender(
      <ProgressRing
        value={95}
        label="RAM"
        displayValue="3.8 GB"
        hint="von 4.0 GB"
        heat
      />,
    )
    expect(screen.getByRole('progressbar')).toHaveStyle({
      '--ring-fill': 'hsl(var(--mui-danger))',
    })
  })
})
