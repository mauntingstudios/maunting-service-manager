import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { VoiceRecordingBar } from './VoiceRecordingBar'

describe('VoiceRecordingBar', () => {
  it('zeigt in der kompakten Variante Status, Kontingent und beide Aktionen', () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    const { container } = render(
      <VoiceRecordingBar
        kompakt
        durationSeconds={5}
        statusLabel="Jetzt sprechen …"
        extraInfo={<span>12:00</span>}
        onCancel={onCancel}
        onConfirm={onConfirm}
        cancelLabel="Abbrechen"
        confirmLabel="Senden"
      />,
    )

    expect(container.firstElementChild).toHaveClass('flex-col')
    expect(screen.getByText('Jetzt sprechen …')).toBeInTheDocument()
    expect(screen.getByText('12:00')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})