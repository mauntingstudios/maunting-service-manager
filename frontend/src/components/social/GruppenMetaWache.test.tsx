import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const dienste = vi.hoisted(() => ({
  ladeGruppenInfo: vi.fn(),
  ladeGruppenHintergrund: vi.fn(),
}))

vi.mock('@/services/e2eeCrypto', () => ({
  deriveGroupBlindMailboxId: async (groupId: number) => `group:${groupId}`,
}))
vi.mock('@/services/gruppenInfo', () => dienste)

import { GruppenMetaWache } from './GruppenMetaWache'

const GRUPPE = {
  id: 7,
  name: null,
  description: null,
  avatar_url: null,
  owner_user_id: 1,
  role: 'member',
  members: [
    { user_id: 1, username: 'anna', role: 'owner', permissions: null },
    { user_id: 2, username: 'bert', role: 'member', permissions: 'send_messages' },
  ],
} as never

function info(name = 'Küchenplanung') {
  return {
    art: 'info' as const,
    info: { v: 1, name, beschreibung: 'Wer bringt was', logo: null },
    revision: 1,
    vonKonto: 1,
    quelle: 'info' as const,
  }
}

function ereignis(detail: Record<string, unknown>): void {
  window.dispatchEvent(new CustomEvent('msm:sync-event', { detail }))
}

async function initialAbwarten() {
  await waitFor(() => expect(dienste.ladeGruppenInfo).toHaveBeenCalled())
  dienste.ladeGruppenInfo.mockClear()
}

describe('GruppenMetaWache', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dienste.ladeGruppenInfo.mockResolvedValue(info())
    dienste.ladeGruppenHintergrund.mockResolvedValue({ art: 'leer' })
  })

  it('liest die Info einmal beim Anzeigen der Liste, ohne Ereignis', async () => {
    const onInfo = vi.fn()
    render(
      <GruppenMetaWache
        groups={[GRUPPE]}
        eigeneId={2}
        onInfo={onInfo}
        onStruktur={vi.fn()}
      />,
    )

    await waitFor(() =>
      expect(onInfo).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ name: 'Küchenplanung' }),
        1,
        'info',
      ),
    )
  })

  it('lädt die Info, wenn der Server eine Änderung meldet', async () => {
    const onInfo = vi.fn()
    render(
      <GruppenMetaWache
        groups={[GRUPPE]}
        eigeneId={2}
        onInfo={onInfo}
        onStruktur={vi.fn()}
      />,
    )

    await initialAbwarten()
    ereignis({ type: 'chat_group_info_updated', group_id: 7, revision: 2 })

    await waitFor(() =>
      expect(onInfo).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ name: 'Küchenplanung' }),
        1,
        'info',
      ),
    )
  })

  it('lädt bei mehreren Ereignissen im selben Fenster nur einmal', async () => {
    const onInfo = vi.fn()
    render(
      <GruppenMetaWache
        groups={[GRUPPE]}
        eigeneId={2}
        onInfo={onInfo}
        onStruktur={vi.fn()}
      />,
    )

    await initialAbwarten()
    ereignis({ type: 'chat_group_info_updated', group_id: 7, revision: 2 })
    ereignis({ type: 'chat_group_config_updated', group_id: 7, revision: 3 })

    await waitFor(() => expect(onInfo).toHaveBeenCalledTimes(1))
  })

  it('ignoriert das eigene Echo anhand der Revision', async () => {
    const onInfo = vi.fn()
    render(
      <GruppenMetaWache
        groups={[GRUPPE]}
        eigeneId={2}
        onInfo={onInfo}
        onStruktur={vi.fn()}
      />,
    )

    await initialAbwarten()
    window.dispatchEvent(
      new CustomEvent('msm:gruppenblock-geschrieben', {
        detail: { groupId: 7, art: 'info', revision: 4 },
      }),
    )
    ereignis({ type: 'chat_group_info_updated', group_id: 7, revision: 4 })

    await new Promise((fertig) => window.setTimeout(fertig, 250))
    expect(dienste.ladeGruppenInfo).not.toHaveBeenCalled()
  })

  it('holt bei einer Mitgliederänderung die Gruppenliste neu', async () => {
    const onStruktur = vi.fn()
    render(
      <GruppenMetaWache
        groups={[GRUPPE]}
        eigeneId={2}
        onInfo={vi.fn()}
        onStruktur={onStruktur}
      />,
    )

    await initialAbwarten()
    ereignis({ type: 'chat_group_member_updated', group_id: 7 })

    await waitFor(() => expect(onStruktur).toHaveBeenCalledTimes(1))
    expect(dienste.ladeGruppenInfo).not.toHaveBeenCalled()
  })

  it('lädt den geteilten Hintergrund bei eigenem Ereignis', async () => {
    dienste.ladeGruppenHintergrund.mockResolvedValue({
      art: 'hintergrund',
      hintergrund: { v: 1, preset: 'sterne', dim: 30, bild: null },
      revision: 2,
      vonKonto: 1,
    })
    const onHintergrund = vi.fn()
    render(
      <GruppenMetaWache
        groups={[GRUPPE]}
        eigeneId={2}
        onInfo={vi.fn()}
        onHintergrund={onHintergrund}
        onStruktur={vi.fn()}
      />,
    )

    ereignis({ type: 'chat_group_background_updated', group_id: 7, revision: 2 })

    await waitFor(() =>
      expect(onHintergrund).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ preset: 'sterne', dim: 30 }),
        2,
      ),
    )
  })

  it('meldet einen entfernten Hintergrund als null', async () => {
    const onHintergrund = vi.fn()
    render(
      <GruppenMetaWache
        groups={[GRUPPE]}
        eigeneId={2}
        onInfo={vi.fn()}
        onHintergrund={onHintergrund}
        onStruktur={vi.fn()}
      />,
    )

    ereignis({ type: 'chat_group_background_updated', group_id: 7, revision: 3 })

    await waitFor(() => expect(onHintergrund).toHaveBeenCalledWith(7, null, 0))
  })

  it('lädt nichts für eine Gruppe, die dieses Gerät nicht kennt', async () => {
    const onInfo = vi.fn()
    render(
      <GruppenMetaWache
        groups={[]}
        eigeneId={2}
        onInfo={onInfo}
        onStruktur={vi.fn()}
      />,
    )

    ereignis({ type: 'chat_group_info_updated', group_id: 99, revision: 1 })

    await new Promise((fertig) => window.setTimeout(fertig, 250))
    expect(dienste.ladeGruppenInfo).not.toHaveBeenCalled()
  })
})
