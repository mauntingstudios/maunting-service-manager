import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { Blueprints } from './Blueprints'
import i18n from '@/i18n'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { useToastStore } from '@/stores/toastStore'
import { useConfirmStore } from '@/stores/confirmStore'
import type { MePermissions } from '@/types/permissions'

function renderPage() {
  return render(
    <MemoryRouter>
      <Blueprints />
    </MemoryRouter>,
  )
}

function setMe(me: MePermissions | null) {
  usePermissionsStore.setState({ me, isLoading: false })
}

const ownerMe: MePermissions = {
  is_owner: true,
  role_id: null,
  role_name: null,
  global_keys: [],
  server_keys: {},
}

const readOnlyMe: MePermissions = {
  is_owner: false,
  role_id: 2,
  role_name: 'user',
  global_keys: [],
  server_keys: {},
}

function mockJson(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(),
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response)
}

const sampleList = {
  blueprints: [
    {
      id: 'minecraft_paper',
      name: 'Minecraft (Paper)',
      game: 'Minecraft',
      edition: 'Paper',
      category: 'non_steam_game',
      author: 'Maunting Studios',
      description: null,
      origin: 'native',
      version: 1,
      image: 'itzg/minecraft-server:latest',
      source_type: 'dockerOnly',
      supports_mods: true,
      supports_steam_workshop: false,
      mod_injection: 'none',
      ports: [{ name: 'game', protocol: 'tcp' }],
    },
    {
      id: 'minecraft_vanilla',
      name: 'Minecraft (Vanilla)',
      game: 'Minecraft',
      edition: 'Vanilla',
      category: 'non_steam_game',
      author: 'Maunting Studios',
      description: null,
      origin: 'native',
      version: 1,
      image: 'itzg/minecraft-server:latest',
      source_type: 'dockerOnly',
      supports_mods: false,
      supports_steam_workshop: false,
      mod_injection: 'none',
      ports: [{ name: 'game', protocol: 'tcp' }],
    },
    {
      id: 'my_custom',
      name: 'My Custom Game',
      category: 'non_steam_game',
      author: null,
      description: null,
      origin: 'community',
      version: 1,
      image: 'alpine',
      source_type: 'custom',
      supports_mods: false,
      supports_steam_workshop: false,
      mod_injection: 'none',
      ports: [{ name: 'game', protocol: 'udp' }],
    },
  ],
}

async function openGameCard(key: string) {
  const card = await screen.findByTestId(`blueprint-game-card-${key}`)
  fireEvent.click(within(card).getByRole('button'))
}

describe('Blueprints page', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    i18n.changeLanguage('en')
    setMe(null)
    useToastStore.setState({ toasts: [] })
    useConfirmStore.setState({ pending: null })
    fetchSpy = vi.spyOn(global, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('groups blueprints by game first and drills into the selected game', async () => {
    fetchSpy.mockReturnValueOnce(mockJson(200, sampleList))
    renderPage()

    const minecraftCard = await screen.findByTestId('blueprint-game-card-minecraft')
    expect(screen.getByTestId('blueprint-game-card-my-custom-game')).toBeInTheDocument()
    expect(within(minecraftCard).getByText('2 blueprints')).toBeInTheDocument()
    // Blueprints are not shown flat before choosing a game.
    expect(screen.queryByTestId('blueprint-row-minecraft_paper')).toBeNull()

    fireEvent.click(within(minecraftCard).getByRole('button'))
    await screen.findByTestId('blueprint-row-minecraft_paper')
    expect(screen.getByTestId('blueprint-row-minecraft_vanilla')).toBeInTheDocument()
    expect(screen.queryByTestId('blueprint-row-my_custom')).toBeNull()

    fireEvent.click(screen.getByTestId('blueprints-back-to-games'))
    await screen.findByTestId('blueprint-game-card-minecraft')
    expect(screen.queryByTestId('blueprint-row-minecraft_paper')).toBeNull()
  })

  it('shows matching blueprints across all games while searching', async () => {
    fetchSpy.mockReturnValueOnce(mockJson(200, sampleList))
    renderPage()

    const searchInput = await screen.findByRole('searchbox', { name: new RegExp(i18n.t('blueprints.search'), 'i') })
    await screen.findByTestId('blueprint-game-card-minecraft')

    fireEvent.change(searchInput, { target: { value: 'paper' } })
    await screen.findByTestId('blueprint-row-minecraft_paper')
    expect(screen.queryByTestId('blueprint-row-minecraft_vanilla')).toBeNull()
  })

  it('keeps header actions aligned and removes visible schema-version chrome', async () => {
    setMe(ownerMe)
    fetchSpy.mockReturnValueOnce(mockJson(200, sampleList))
    renderPage()

    await screen.findByTestId('blueprint-game-card-minecraft')
    const actions = screen.getByTestId('blueprints-header-actions')
    expect(actions).toHaveClass('grid-flow-col', 'items-stretch')
    expect(screen.getByRole('link', { name: i18n.t('blueprints.guide') })).toHaveClass('h-10')
    expect(screen.getByTestId('blueprints-create')).toHaveClass('h-10')
    expect(screen.queryByText(/schema v1/i)).toBeNull()
  })

  it('opens a compact responsive blueprint dialog above the app shell', async () => {
    setMe(ownerMe)
    fetchSpy.mockReturnValueOnce(mockJson(200, sampleList))
    renderPage()

    await screen.findByTestId('blueprint-game-card-minecraft')
    fireEvent.click(screen.getByTestId('blueprints-create'))

    const dialog = screen.getByRole('dialog', { name: i18n.t('blueprintBuilder.title.create') })
    expect(dialog).toHaveClass('msm-modal-overlay', 'items-end', 'sm:items-center')
    expect(screen.getByTestId('blueprint-builder-panel')).toHaveClass('max-w-2xl', 'rounded-t-3xl', 'sm:rounded-panel', 'overflow-hidden')
    expect(screen.getByTestId('blueprint-builder-actions')).toHaveClass('shrink-0')
    expect(within(dialog).queryByText(/schema v1/i)).toBeNull()
  })

  it('hides Replace/Delete buttons for native blueprints', async () => {
    setMe(ownerMe)
    fetchSpy.mockReturnValueOnce(mockJson(200, sampleList))
    renderPage()
    await openGameCard('minecraft')
    await screen.findByTestId('blueprint-row-minecraft_paper')
    expect(screen.queryByTestId('blueprint-replace-minecraft_paper')).toBeNull()
    expect(screen.queryByTestId('blueprint-delete-minecraft_paper')).toBeNull()

    fireEvent.click(screen.getByTestId('blueprints-back-to-games'))
    await openGameCard('my-custom-game')
    // Community-Row hat beide Buttons fuer Owner.
    expect(screen.getByTestId('blueprint-replace-my_custom')).toBeInTheDocument()
    expect(screen.getByTestId('blueprint-delete-my_custom')).toBeInTheDocument()
    expect(document.querySelectorAll('[title]')).toHaveLength(0)
  })

  it('hides write actions completely for read-only users', async () => {
    setMe(readOnlyMe)
    fetchSpy.mockReturnValueOnce(mockJson(200, sampleList))
    renderPage()
    await openGameCard('my-custom-game')
    await screen.findByTestId('blueprint-row-my_custom')
    expect(screen.queryByTestId('blueprints-upload-new')).toBeNull()
    expect(screen.queryByTestId('blueprint-replace-my_custom')).toBeNull()
    expect(screen.queryByTestId('blueprint-delete-my_custom')).toBeNull()
  })

  it('always exposes Download link (even for native, even for read-only)', async () => {
    setMe(readOnlyMe)
    fetchSpy.mockReturnValueOnce(mockJson(200, sampleList))
    renderPage()
    await openGameCard('minecraft')
    const download = await screen.findByTestId('blueprint-download-minecraft_paper')
    expect(download.getAttribute('href')).toBe('/api/blueprints/minecraft_paper')
  })

  it('deletes a community blueprint after confirm and refreshes', async () => {
    setMe(ownerMe)
    fetchSpy
      .mockReturnValueOnce(mockJson(200, sampleList))
      .mockReturnValueOnce(mockJson(204, null))
      .mockReturnValueOnce(mockJson(200, { blueprints: [sampleList.blueprints[0]] }))
    renderPage()

    await openGameCard('my-custom-game')
    const deleteBtn = await screen.findByTestId('blueprint-delete-my_custom')
    fireEvent.click(deleteBtn)

    await waitFor(() => expect(useConfirmStore.getState().pending).not.toBeNull())
    useConfirmStore.getState().resolve(true)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3))
    const [url, options] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/blueprints/my_custom')
    expect(options.method).toBe('DELETE')

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((tt) => tt.type === 'success' && tt.message.includes('my_custom'))).toBe(true)
    })
  })

  it('does NOT delete when user cancels the confirm dialog', async () => {
    setMe(ownerMe)
    fetchSpy.mockReturnValueOnce(mockJson(200, sampleList))
    renderPage()

    await openGameCard('my-custom-game')
    const deleteBtn = await screen.findByTestId('blueprint-delete-my_custom')
    fireEvent.click(deleteBtn)
    await waitFor(() => expect(useConfirmStore.getState().pending).not.toBeNull())
    useConfirmStore.getState().resolve(false)

    // Nur der initiale GET — kein DELETE-Call.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('replace accepts a display-style id equivalent to the stored normalized id', async () => {
    setMe(ownerMe)
    fetchSpy
      .mockReturnValueOnce(mockJson(200, sampleList))
      .mockReturnValueOnce(mockJson(200, { id: 'my_custom' }))
      .mockReturnValueOnce(mockJson(200, sampleList))
    renderPage()
    await openGameCard('my-custom-game')
    fireEvent.click(await screen.findByTestId('blueprint-replace-my_custom'))

    const input = screen.getByTestId('blueprints-replace-input') as HTMLInputElement
    const file = new File(
      [JSON.stringify({ meta: { id: 'My Custom' } })],
      'my-custom.blueprint.json',
      { type: 'application/json' },
    )
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3))
    const [url, options] = fetchSpy.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('/api/blueprints/import')
    expect(options.method).toBe('POST')
    expect(JSON.parse(String(options.body)).meta.id).toBe('My Custom')
  })

  it('replace rejects file with mismatching meta.id (client-side guard)', async () => {
    setMe(ownerMe)
    fetchSpy.mockReturnValueOnce(mockJson(200, sampleList))
    renderPage()
    await openGameCard('my-custom-game')
    const replaceBtn = await screen.findByTestId('blueprint-replace-my_custom')
    fireEvent.click(replaceBtn)

    const input = screen.getByTestId('blueprints-replace-input') as HTMLInputElement
    const file = new File(
      [JSON.stringify({ meta: { id: 'something_else' } })],
      'wrong.blueprint.json',
      { type: 'application/json' },
    )
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    fireEvent.change(input)

    await waitFor(() => {
      const toasts = useToastStore.getState().toasts
      expect(toasts.some((tt) => tt.type === 'error' && tt.message.includes('my_custom'))).toBe(true)
    })
    // Nur der initiale GET — Upload wurde geblockt.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})
