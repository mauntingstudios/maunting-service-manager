import { render, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { OfflineBanner } from './OfflineBanner'

describe('OfflineBanner', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('ist unsichtbar wenn online', () => {
    const { container } = render(<OfflineBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it('wird sichtbar bei msm:network-offline und verschwindet bei msm:network-online', () => {
    render(<OfflineBanner />)

    act(() => {
      window.dispatchEvent(new CustomEvent('msm:network-offline'))
    })

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText('Offline')).toBeInTheDocument()
    expect(screen.getByText('Erneut versuchen')).toBeInTheDocument()

    act(() => {
      window.dispatchEvent(new CustomEvent('msm:network-online'))
    })

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('löst bei Klick auf Erneut versuchen einen Health-Ping aus und feuert Online-Event nur bei Erfolg', async () => {
    render(<OfflineBanner />)

    act(() => {
      window.dispatchEvent(new CustomEvent('msm:network-offline'))
    })

    const onlineListener = vi.fn()
    window.addEventListener('msm:network-online', onlineListener)

    try {
      // 1. Health-Ping schlägt fehl -> kein Online-Event
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Connection refused'))
      const retryBtn = screen.getByRole('button', { name: /erneut versuchen/i })

      await act(async () => {
        fireEvent.click(retryBtn)
      })
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('/api/health'), expect.any(Object))
      expect(onlineListener).not.toHaveBeenCalled()
      expect(screen.getByRole('status')).toBeInTheDocument()

      // 2. Health-Ping erfolgreich (200 OK) -> Online-Event wird gefeuert
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
      await act(async () => {
        fireEvent.click(retryBtn)
      })
      expect(onlineListener).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('msm:network-online', onlineListener)
    }
  })
})
