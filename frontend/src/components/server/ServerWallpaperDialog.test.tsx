import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as client from '@/api/client'
import { useConfirmStore } from '@/stores/confirmStore'
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
    useConfirmStore.setState({ pending: null })
  })

  it('zeigt die Galerie aus der echten Antwortform (nacktes Array)', async () => {
    vi.mocked(client.api).mockResolvedValue(galerie)
    zeichnen()
    const dialog = await screen.findByRole('dialog')
    // Dropzone + 2 Galerie-Miniaturen + 2 Löschen-Knöpfe + Reset + Schließen, davon 1 aktiv:
    expect(within(dialog).getAllByRole('button')).toHaveLength(7)
    expect(within(dialog).getAllByRole('button', { pressed: true })).toHaveLength(1)
    expect(vi.mocked(client.api)).toHaveBeenCalledWith('/servers/42/wallpaper/gallery')
  })

  it('löscht erst nach Bestätigung und meldet die Änderung', async () => {
    vi.mocked(client.api).mockResolvedValue(galerie)
    const onChanged = vi.fn()
    render(
      <ServerWallpaperDialog open onClose={() => {}} server={server} onChanged={onChanged} />,
    )
    const dialog = await screen.findByRole('dialog')
    const entfernen = within(dialog).getAllByRole('button', { name: /löschen|Delete image by/ })
    expect(entfernen).toHaveLength(2)
    fireEvent.click(entfernen[0])
    // Die Rückfrage nennt, welches Bild mitgeht:
    await waitFor(() => expect(useConfirmStore.getState().pending).not.toBeNull())
    expect(useConfirmStore.getState().pending?.message).toMatch(/anna/)
    expect(useConfirmStore.getState().pending?.danger).toBe(true)
    await act(async () => useConfirmStore.getState().resolve(true))
    await waitFor(() => expect(vi.mocked(client.api)).toHaveBeenCalledWith(
      '/servers/42/wallpaper/gallery/1',
      { method: 'DELETE' },
    ))
    expect(onChanged).toHaveBeenCalled()
  })

  it('lädt die Miniaturen aus der Galerie des Servers', async () => {
    vi.mocked(client.api).mockResolvedValue(galerie)
    zeichnen()
    const dialog = await screen.findByRole('dialog')
    const bilder = dialog.querySelectorAll('img')
    expect(bilder).toHaveLength(2)
    expect(bilder[0].getAttribute('src')).toContain('/api/servers/42/wallpaper/gallery/1/image')
    expect(bilder[1].getAttribute('src')).toContain('/api/servers/42/wallpaper/gallery/2/image')
  })

  it('lässt die API bei abgelehnter Rückfrage unberührt', async () => {
    vi.mocked(client.api).mockResolvedValue(galerie)
    zeichnen()
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getAllByRole('button', { name: /löschen|Delete image by/ })[0])
    await waitFor(() => expect(useConfirmStore.getState().pending).not.toBeNull())
    await act(async () => useConfirmStore.getState().resolve(false))
    // Nur Galerie-GETs — kein DELETE:
    await waitFor(() => expect(vi.mocked(client.api)).toHaveBeenCalled())
    expect(vi.mocked(client.api).mock.calls.filter(([_, o]) => (o as { method?: string })?.method === 'DELETE')).toHaveLength(0)
  })

  it('weist falsche Dateiformate inline ab, ohne hochzuladen', async () => {
    zeichnen()
    const dialog = await screen.findByRole('dialog')
    const input = dialog.querySelector('input[type="file"]') as HTMLInputElement
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
