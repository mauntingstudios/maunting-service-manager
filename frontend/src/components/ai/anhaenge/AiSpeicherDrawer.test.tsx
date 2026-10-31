import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AiAttachment } from '@/api/ai'
import { AiSpeicherDrawer } from './AiSpeicherDrawer'

const anhaengeTest: AiAttachment[] = [
  {
    id: 'att-1',
    conversation_id: 'c-1',
    original_name: 'einkaufsliste.md',
    media_type: 'text/markdown',
    size_bytes: 1024,
    status: 'ready',
    rejection_code: null,
    message_id: 'm-1',
    redacted_spans: 2,
    created_at: '2026-10-31T12:00:00Z',
  },
  {
    id: 'att-2',
    conversation_id: 'c-1',
    original_name: 'foto.png',
    media_type: 'image/png',
    size_bytes: 204800,
    status: 'ready',
    rejection_code: null,
    message_id: 'm-2',
    redacted_spans: null,
    created_at: '2026-10-30T10:30:00Z',
  },
]

describe('AiSpeicherDrawer', () => {
  it('rendert die Dateiliste und Gesamtgroesse korrekt', () => {
    render(
      <AiSpeicherDrawer
        offen
        onSchliessen={vi.fn()}
        anhaenge={anhaengeTest}
        onLoeschen={vi.fn()}
      />,
    )

    expect(screen.getByText('einkaufsliste.md')).toBeInTheDocument()
    expect(screen.getByText('foto.png')).toBeInTheDocument()
    expect(screen.getByText(/2 Stellen unkenntlich/)).toBeInTheDocument()
  })

  it('filtert die Liste ueber das Suchfeld', () => {
    render(
      <AiSpeicherDrawer
        offen
        onSchliessen={vi.fn()}
        anhaenge={anhaengeTest}
        onLoeschen={vi.fn()}
      />,
    )

    const searchInput = screen.getByLabelText('Dateien durchsuchen …')
    fireEvent.change(searchInput, { target: { value: 'foto' } })

    expect(screen.queryByText('einkaufsliste.md')).toBeNull()
    expect(screen.getByText('foto.png')).toBeInTheDocument()
  })

  it('filtert nach Typ-Buttons', () => {
    render(
      <AiSpeicherDrawer
        offen
        onSchliessen={vi.fn()}
        anhaenge={anhaengeTest}
        onLoeschen={vi.fn()}
      />,
    )

    const bilderBtn = screen.getByRole('button', { name: 'Bilder' })
    fireEvent.click(bilderBtn)

    expect(screen.queryByText('einkaufsliste.md')).toBeNull()
    expect(screen.getByText('foto.png')).toBeInTheDocument()
  })

  it('uebernimmt Anhang in den Prompt per Klick', () => {
    const onEinfuegen = vi.fn()
    const onSchliessen = vi.fn()
    render(
      <AiSpeicherDrawer
        offen
        onSchliessen={onSchliessen}
        anhaenge={anhaengeTest}
        onLoeschen={vi.fn()}
        onInPromptEinfuegen={onEinfuegen}
      />,
    )

    const insertBtn = screen.getByLabelText('In Nachricht erwähnen: einkaufsliste.md')
    fireEvent.click(insertBtn)

    expect(onEinfuegen).toHaveBeenCalledWith(anhaengeTest[0])
    expect(onSchliessen).toHaveBeenCalled()
  })

  it('oeffnet Loesch-Bestaetigungsdialog mit Tresor-Option wenn aktiv', async () => {
    const onLoeschen = vi.fn().mockResolvedValue(undefined)
    render(
      <AiSpeicherDrawer
        offen
        onSchliessen={vi.fn()}
        anhaenge={anhaengeTest}
        onLoeschen={onLoeschen}
        tresorSpiegelungAktiv
      />,
    )

    const deleteBtn = screen.getByLabelText('Anhang entfernen: einkaufsliste.md')
    fireEvent.click(deleteBtn)

    expect(screen.getByText('Datei löschen')).toBeInTheDocument()
    expect(screen.getByText('Auch aus meinem persönlichen Tresor löschen')).toBeInTheDocument()

    const confirmBtn = screen.getAllByRole('button', { name: 'Anhang entfernen' })[0]
    fireEvent.click(confirmBtn)

    expect(onLoeschen).toHaveBeenCalledWith(anhaengeTest[0], false)
  })

  it('unterstuetzt Multi-Select zum Sammel-Loeschen mehrerer Anhaenge', async () => {
    const onLoeschen = vi.fn().mockResolvedValue(undefined)
    render(
      <AiSpeicherDrawer
        offen
        onSchliessen={vi.fn()}
        anhaenge={anhaengeTest}
        onLoeschen={onLoeschen}
      />,
    )

    const selectAllBtn = screen.getByText('Alle auswählen')
    fireEvent.click(selectAllBtn)

    expect(screen.getByText('2 ausgewählt')).toBeInTheDocument()

    const bulkDeleteBtn = screen.getByRole('button', { name: /Ausgewählte löschen \(2\)/ })
    fireEvent.click(bulkDeleteBtn)

    expect(screen.getByText('Datei löschen')).toBeInTheDocument()
    const confirmBtn = screen.getAllByRole('button', { name: 'Anhang entfernen' })[0]
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(onLoeschen).toHaveBeenCalledWith(anhaengeTest[0], false)
      expect(onLoeschen).toHaveBeenCalledWith(anhaengeTest[1], false)
    })
  })
})
