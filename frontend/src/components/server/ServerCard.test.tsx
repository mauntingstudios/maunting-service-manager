import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { vorladenBildquelle } from '@/hooks/useBildquelle'
import type { Server } from '@/types'
import { ServerCard } from './ServerCard'

vi.mock('@/hooks/useBildquelle', () => ({
  vorladenBildquelle: vi.fn(),
  useBildquelle: () => ({ quelle: null, fehlgeschlagen: true, bildFehler: () => {} }),
}))

const KARTE = {
  id: 7,
  name: 'Zomboid 1',
  game_type: 'project_zomboid',
  status: 'stopped',
  ports: [],
  wallpaper_url: '/api/servers/7/wallpaper',
  wallpaper_version: 'custom-12',
} as unknown as Server

function karte(server: Server = KARTE) {
  return render(
    <MemoryRouter>
      <ServerCard server={server} gameLabel="Project Zomboid" />
    </MemoryRouter>,
  )
}

describe('ServerCard Titelbild-Blitzstart', () => {
  beforeEach(() => {
    vi.mocked(vorladenBildquelle).mockClear()
  })

  it('lädt das Titelbild beim Hovern mit niedriger Priorität vor', () => {
    karte()
    fireEvent.mouseEnter(screen.getByTestId('server-card-7'))
    expect(vorladenBildquelle).toHaveBeenCalledWith(
      '/api/servers/7/wallpaper?v=custom-12',
      'low',
    )
  })

  it('lädt beim Fokussieren vor (Tastatur)', () => {
    karte()
    fireEvent.focus(screen.getByRole('link', { name: 'Zomboid 1' }))
    expect(vorladenBildquelle).toHaveBeenCalledWith(
      '/api/servers/7/wallpaper?v=custom-12',
      'low',
    )
  })

  it('lädt ohne Titelbild nichts vor', () => {
    karte({ ...KARTE, wallpaper_url: null, wallpaper_version: null })
    fireEvent.mouseEnter(screen.getByTestId('server-card-7'))
    expect(vorladenBildquelle).not.toHaveBeenCalled()
  })

  it('führt weiter auf die Detailseite', () => {
    karte()
    expect(screen.getByRole('link', { name: 'Zomboid 1' }).getAttribute('href')).toBe('/servers/7')
  })
})
