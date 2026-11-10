import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { StickerPack } from '@/services/stickerPacks'

vi.mock('@/services/appUmgebung', () => ({ istDesktopApp: () => true }))

vi.mock('@/lib/imageCompression', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/imageCompression')>()),
  bildAusDatei: vi.fn(),
}))

vi.mock('@/services/bildSticker', async (importOriginal) => {
  const echt = await importOriginal<typeof import('@/services/bildSticker')>()
  return {
    ...echt,
    erstelleBildSticker: vi.fn(async () => ({
      bild: 'data:image/webp;base64,VORSCHAU',
      miniatur: 'data:image/webp;base64,MINI',
    })),
  }
})

import { bildAusDatei } from '@/lib/imageCompression'
import { erstelleBildSticker } from '@/services/bildSticker'
import { BildStickerEditor } from './BildStickerEditor'

const PACK: StickerPack = {
  id: 'pack-1',
  name: 'Meine Mixes',
  coverId: null,
  createdAt: 1,
  updatedAt: 1,
}

function zeige(overrides: { packId?: string | null } = {}) {
  const onSpeichern = vi.fn(async () => {})
  const onOpenChange = vi.fn()
  const { container } = render(
    <BildStickerEditor
      open
      onOpenChange={onOpenChange}
      packs={[PACK]}
      packId={overrides.packId === undefined ? PACK.id : overrides.packId}
      onPack={vi.fn()}
      onNeuesPack={vi.fn(async () => PACK.id)}
      onSpeichern={onSpeichern}
    />,
  )
  return { onSpeichern, onOpenChange, container }
}

async function waehleDatei(datei: File) {
  // Der Dialog liegt per Portal an `document.body`, nicht im render-Container.
  const eingabe = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(eingabe, { target: { files: [datei] } })
}

describe('BildStickerEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(bildAusDatei).mockResolvedValue({
      dataUrl: 'data:image/png;base64,QUELLE',
      name: 'foto.png',
    })
  })

  it('bietet Kamera, lokale Galerie und Tresor an und sperrt Speichern ohne Bild', async () => {
    zeige()
    const dialog = await screen.findByRole('dialog', { name: 'Sticker aus Foto' })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kamera' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Galerie' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tresor' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Senden' })).toBeDisabled()
  })

  it('weist eine Datei ab, die kein Bild ist', async () => {
    vi.mocked(bildAusDatei).mockRejectedValueOnce(new Error('Keine Bilddatei'))
    zeige()

    await waehleDatei(new File(['x'], 'notiz.txt', { type: 'text/plain' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Das ist kein Bild.')
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('baut eine Vorschau und speichert sie ohne zu senden', async () => {
    const { onSpeichern, onOpenChange } = zeige()

    await waehleDatei(new File(['x'], 'foto.png', { type: 'image/png' }))

    await waitFor(() =>
      expect(document.querySelector('img[src="data:image/webp;base64,VORSCHAU"]')).not.toBeNull(),
    )
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() =>
      expect(onSpeichern).toHaveBeenCalledWith(
        {
          bild: 'data:image/webp;base64,VORSCHAU',
          miniatur: 'data:image/webp;base64,MINI',
          text: '',
          stil: 'fett',
        },
        false,
      ),
    )
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('sendet den fertigen Foto-Sticker', async () => {
    const { onSpeichern } = zeige()
    await waehleDatei(new File(['x'], 'foto.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled())

    fireEvent.click(screen.getByRole('button', { name: 'Senden' }))

    await waitFor(() => expect(onSpeichern).toHaveBeenCalledWith(expect.anything(), true))
  })

  it('gibt den Text an die Vorschau weiter', async () => {
    zeige()
    await waehleDatei(new File(['x'], 'foto.png', { type: 'image/png' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Senden' })).toBeEnabled())

    fireEvent.change(screen.getByLabelText('Text'), { target: { value: 'Hallo' } })

    await waitFor(() =>
      expect(vi.mocked(erstelleBildSticker)).toHaveBeenLastCalledWith(
        'data:image/png;base64,QUELLE',
        'Hallo',
        'fett',
      ),
    )
  })

  it('sperrt Speichern ohne Ablage', async () => {
    zeige({ packId: null })
    await waehleDatei(new File(['x'], 'foto.png', { type: 'image/png' }))

    expect(await screen.findByText('Wähle eine Ablage.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })
})
