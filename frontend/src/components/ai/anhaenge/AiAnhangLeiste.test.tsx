import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AiAttachment } from '@/api/ai'
import '@/i18n'
import { AiAnhangLeiste } from './AiAnhangLeiste'

function anhang(overrides: Partial<AiAttachment>): AiAttachment {
  return {
    id: 'a1',
    conversation_id: 'c1',
    original_name: 'datei.txt',
    media_type: 'text/plain',
    size_bytes: 2048,
    status: 'ready',
    rejection_code: null,
    message_id: null,
    redacted_spans: null,
    created_at: '2026-10-31T12:00:00Z',
    ...overrides,
  }
}

describe('AiAnhangLeiste', () => {
  it('zeigt Vorschaubild, Namen und Groesse und entfernt einzeln', () => {
    const entfernen = vi.fn()
    const { container } = render(
      <AiAnhangLeiste
        anhaenge={[anhang({ id: 'bild', original_name: 'foto.png', media_type: 'image/png', size_bytes: 2048 })]}
        vorschauen={{ bild: 'blob:vorschau' }}
        onRemove={entfernen}
        disabled={false}
      />,
    )

    const bild = container.querySelector('img')
    expect(bild?.getAttribute('src')).toBe('blob:vorschau')
    expect(screen.getByText('foto.png')).toBeTruthy()
    expect(screen.getByText(/2 KB/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Anhang entfernen: foto.png/ }))
    expect(entfernen).toHaveBeenCalledTimes(1)
  })

  it('zeigt fuer Textdateien ein Symbol statt eines Bildes', () => {
    const { container } = render(
      <AiAnhangLeiste
        anhaenge={[anhang({ original_name: 'log.txt' })]}
        vorschauen={{}}
        onRemove={() => undefined}
        disabled={false}
      />,
    )
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByText('log.txt')).toBeTruthy()
  })
})
