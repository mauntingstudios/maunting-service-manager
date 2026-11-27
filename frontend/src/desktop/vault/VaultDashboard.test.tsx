import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@/i18n'
import i18n from '@/i18n'
import { VaultDashboard } from './VaultDashboard'
import type { VaultItem } from './vaultEintrag'

vi.mock('./tresorMiniaturen', async (original) => ({
  ...(await original<typeof import('./tresorMiniaturen')>()),
  useMiniatur: (kopf: { id: string } | undefined) => (kopf ? `blob:${kopf.id}` : null),
}))

function eintrag(id: string, service: string, extra: Partial<VaultItem> = {}): VaultItem {
  return {
    id,
    service,
    username: 'user@example.com',
    password: 'Strong!Password123',
    category: 'login',
    createdAt: 1,
    updatedAt: 10,
    revision: 1,
    ...extra,
  }
}

describe('VaultDashboard (Phase 3)', () => {
  const basisProps = {
    begruessung: 'Guten Tag',
    isTeam: false,
    syncStatus: 'synced' as const,
    geraete: 2,
    sicherheitscheck: { laeuft: false, geprueft: 0, gesamt: 0, gefunden: 0, abgeschlossen: false },
    onNeuerEintrag: vi.fn(),
    onPasswortGenerieren: vi.fn(),
    onDateiHochladen: vi.fn(),
    onSicherheitscheck: vi.fn(),
    onSammlung: vi.fn(),
    onSammlungUmbenennen: vi.fn(),
    onNeueSammlung: vi.fn(),
    onAlleEintraege: vi.fn(),
    onAlleFotos: vi.fn(),
    onEintrag: vi.fn(),
  }

  it('zeigt letzte Fotos als Vorschau-Streifen und hält sie aus dem Textkatalog fern', () => {
    const foto = eintrag('f1', 'sonnenuntergang.jpg', {
      category: 'datei',
      username: '',
      password: '',
      datei: {
        typ: 'image/jpeg',
        sha256: 'abc',
        original: { id: 'o1', groesse: 2048, echt: 1500, nonce: 'n1', teile: 1 },
        miniatur: { id: 'm1', groesse: 512, echt: 400, nonce: 'n2', teile: 1 },
      },
    })
    const doc = eintrag('d1', 'steuer.pdf', {
      category: 'datei',
      username: '',
      password: '',
      datei: {
        typ: 'application/pdf',
        sha256: 'def',
        original: { id: 'o2', groesse: 4096, echt: 3000, nonce: 'n3', teile: 1 },
      },
    })
    const login = eintrag('p1', 'GitHub')

    const onAlleFotos = vi.fn()
    const onEintrag = vi.fn()
    render(<VaultDashboard {...basisProps} items={[foto, doc, login]} onAlleFotos={onAlleFotos} onEintrag={onEintrag} />)

    const streifen = screen.getByRole('region', { name: i18n.t('mss.vault.dashboard.letzteFotos') })
    const fotoKnopf = within(streifen).getByRole('button', { name: 'sonnenuntergang.jpg' })
    expect(fotoKnopf.querySelector('img')).toHaveAttribute('src', 'blob:m1')

    // Foto darf nicht doppelt im unteren Katalog stehen
    expect(screen.getAllByRole('button', { name: 'sonnenuntergang.jpg' })).toHaveLength(1)
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('steuer.pdf')).toBeInTheDocument()

    fireEvent.click(fotoKnopf)
    expect(onEintrag).toHaveBeenCalledWith(foto)

    fireEvent.click(within(streifen).getByRole('button', { name: new RegExp(i18n.t('mss.vault.dashboard.alleAnsehen')) }))
    expect(onAlleFotos).toHaveBeenCalled()
  })

  it('blendet ab dem sechsten Katalog-Eintrag am Handy über max-sm aus', () => {
    const logins = Array.from({ length: 7 }, (_, i) => eintrag(`p-${i}`, `Dienst-${i}`, { updatedAt: 100 - i }))
    render(<VaultDashboard {...basisProps} items={logins} />)

    const sechster = screen.getByText('Dienst-5').closest('button')
    const fuenfter = screen.getByText('Dienst-4').closest('button')
    expect(fuenfter?.className).not.toContain('hidden sm:flex')
    expect(sechster?.className).toContain('hidden sm:flex')
  })
})
