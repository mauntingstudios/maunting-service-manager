import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import type { Server, WallpaperGalleryItem } from '@/types'
import { ServerWallpaperDialog } from './ServerWallpaperDialog'

vi.mock('@/api/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/client')>()
  return { ...original, api: vi.fn() }
})

const server = {
  id: 42,
  name: 'Zomboid 1',
  game_type: 'project_zomboid',
  status: 'stopped',
  has_custom_wallpaper: true,
  wallpaper_url: '/api/servers/42/wallpaper',
  wallpaper_source: 'custom',
} as unknown as Server

const galerie: WallpaperGalleryItem[] = [
  { id: 1, game_type: 'project_zomboid', uploaded_by: 'anna', created_at: '2026-11-10T10:00:00Z', is_active: false },
  { id: 2, game_type: 'project_zomboid', uploaded_by: 'bob', created_at: '2026-11-12T10:00:00Z', is_active: true },
]

function zeichnen(ersetzung: Partial<Server> = {}) {
  return render(
    <ServerWallpaperDialog open onClose={() => {}} server={{ ...server, ...ersetzung } as Server} onChanged={() => {}} />,
  )
}

describe('ServerWallpaperDialog', () => {
  beforeEach(() => {
    vi.mocked(client.api).mockReset()
    vi.mocked(client.api).mockResolvedValue([])
  })

  it('zeigt die Galerie aus der echten Antwortform (nacktes Array)', async () => {
    vi.mocked(client.api).mockResolvedValue(galerie)
    zeichnen()
    const dialog = await screen.findByRole('dialog')
    // Dropzone + 2 Galerie-Miniaturen + Reset + Schließen, davon 1 aktiv:
    expect(within(dialog).getAllByRole('button')).toHaveLength(5)
    expect(within(dialog).getAllByRole('button', { pressed: true })).toHaveLength(1)
    expect(vi.mocked(client.api)).toHaveBeenCalledWith('/servers/42/wallpaper/gallery')
  })

  it('weist falsche Dateiformate inline ab, ohne hochzuladen', async () => {
    const { container } = zeichnen()
    await screen.findByRole('dialog')
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const text = new File(['kein bild'], 'notiz.txt', { type: 'text/plain' })
    fireEvent.change(input, { target: { files: [text] } })
    // Nur der Galerie-GET lief — kein POST:
    expect(vi.mocked(client.api).mock.calls.filter(([_, o]) => (o as { method?: string })?.method === 'POST')).toHaveLength(0)
    // Fehlertext (nicht der Dropzone-Hinweis — der nennt Formate ohne "Nur/Only"):
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent(/Nur JPG|Only JPG/))
  })

  it('zeigt Reset nur bei aktivem Custom-Bild', async () => {
    zeichnen()
    await screen.findByRole('dialog')
    expect(screen.getByRole('dialog').textContent).toMatch(/zurücksetzen|reset/i)
  })

  it('blendet Reset ohne Custom-Bild aus', async () => {
    zeichnen({ has_custom_wallpaper: false, wallpaper_url: '/api/servers/42/wallpaper', wallpaper_source: 'steam' })
    await screen.findByRole('dialog')
    expect(screen.getByRole('dialog').textContent).not.toMatch(/zurücksetzen|reset/i)
  })

  it('rendert geschlossen nichts', () => {
    render(
      <ServerWallpaperDialog open={false} onClose={() => {}} server={server} onChanged={() => {}} />,
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(vi.mocked(client.api)).not.toHaveBeenCalled()
  })
})
