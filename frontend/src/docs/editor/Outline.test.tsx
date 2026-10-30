import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { OutlineList, type OutlineEntry } from './Outline'

const eintraege: OutlineEntry[] = [
  { pos: 4, level: 1, text: 'Einleitung' },
  { pos: 40, level: 2, text: 'Details' },
]

describe('OutlineList', () => {
  it('zeigt Überschriften und springt auf die Position', () => {
    const onJump = vi.fn()
    render(<OutlineList entries={eintraege} onJump={onJump} />)

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))

    expect(onJump).toHaveBeenCalledWith(40)
  })

  it('zeigt den leeren Zustand', () => {
    render(<OutlineList entries={[]} onJump={vi.fn()} />)
    expect(screen.getByText(i18n.t('docs.outline.empty'))).toBeInTheDocument()
  })
})