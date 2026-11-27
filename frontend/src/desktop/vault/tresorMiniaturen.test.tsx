import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVaultStore } from './vaultStore'
import { useMiniaturStatus } from './tresorMiniaturen'

const miniaturenLesenMock = vi.hoisted(() => vi.fn())
const ansichtOeffnenMock = vi.hoisted(() => vi.fn(() => 'blob:mini-1'))
const ansichtSchliessenMock = vi.hoisted(() => vi.fn())

vi.mock('./tresorDateien', async (original) => ({
  ...(await original<typeof import('./tresorDateien')>()),
  miniaturenLesen: miniaturenLesenMock,
  ansichtOeffnen: ansichtOeffnenMock,
  ansichtSchliessen: ansichtSchliessenMock,
}))

function Probe({ id, kopfId = 'b-1', echt = 128 }: { id: string; kopfId?: string; echt?: number }) {
  const kopf = { id: kopfId, groesse: 128, echt, schluessel: 'x', loeschen: 'y' }
  const { url, status, erneut } = useMiniaturStatus(kopf, id, true)
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="url">{url ?? ''}</span>
      <button type="button" onClick={erneut}>
        erneut
      </button>
    </div>
  )
}

describe('useMiniaturStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    miniaturenLesenMock.mockReset()
    ansichtOeffnenMock.mockClear()
    ansichtSchliessenMock.mockClear()
    useVaultStore.setState({ userKey: {} as CryptoKey })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('versucht fehlende Miniaturen automatisch erneut und landet bei dauerhaftem Fehler auf fehler', async () => {
    miniaturenLesenMock.mockResolvedValue(new Map())
    render(<Probe id="e1" kopfId="blob-retry" />)

    // Initialer Lauf (16ms Batch-Timer in miniaturHolen)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(miniaturenLesenMock).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('status')).toHaveTextContent('laedt')

    // Erster Auto-Retry nach 1500ms + 16ms Batch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1550)
    })
    expect(miniaturenLesenMock).toHaveBeenCalledTimes(2)

    // Zweiter Auto-Retry nach 4000ms + 16ms Batch -> danach Zustand fehler
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4050)
    })
    expect(miniaturenLesenMock).toHaveBeenCalledTimes(3)
    expect(screen.getByTestId('status')).toHaveTextContent('fehler')
    expect(screen.getByTestId('url')).toHaveTextContent('')

    // Manueller Retry lädt nach Erfolg die Miniatur
    miniaturenLesenMock.mockResolvedValueOnce(new Map([['blob-retry', new Uint8Array([1, 2, 3])]]))
    fireEvent.click(screen.getByRole('button', { name: 'erneut' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(25)
    })
    expect(screen.getByTestId('status')).toHaveTextContent('bereit')
    expect(screen.getByTestId('url')).toHaveTextContent('blob:mini-1')
  })

  it('lädt bei Rückkehr der Netzverbindung im Fehlerzustand automatisch nach', async () => {
    miniaturenLesenMock.mockResolvedValue(new Map())
    render(<Probe id="e2" kopfId="blob-online" />)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1550)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4050)
    })
    expect(screen.getByTestId('status')).toHaveTextContent('fehler')

    miniaturenLesenMock.mockResolvedValueOnce(new Map([['blob-online', new Uint8Array([9, 8])]]))
    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.getByTestId('status')).toHaveTextContent('bereit')
    expect(screen.getByTestId('url')).toHaveTextContent('blob:mini-1')
  })
})
