import { describe, expect, it } from 'vitest'
import { AI_ENTWURF_EVENT, entwurfNehmen, entwurfUebergeben, entwurfWillNeuenChat } from './aiEntwurf'

describe('aiEntwurf', () => {
  it('merkt sich optional das Neuer-Chat-Flag fuer Singra-Diagnosen und konsumiert es einmalig', () => {
    const events: boolean[] = []
    const listener = (event: Event) => {
      events.push(Boolean((event as CustomEvent<{ neuerChat?: boolean }>).detail?.neuerChat))
    }
    window.addEventListener(AI_ENTWURF_EVENT, listener)

    entwurfUebergeben('Fehleranalyse starten', { neuerChat: true })
    expect(events).toEqual([true])
    expect(entwurfWillNeuenChat()).toBe(true)
    expect(entwurfWillNeuenChat()).toBe(false)
    expect(entwurfNehmen()).toBe('Fehleranalyse starten')
    expect(entwurfNehmen()).toBeNull()

    entwurfUebergeben('Normaler Entwurf')
    expect(events).toEqual([true, false])
    expect(entwurfWillNeuenChat()).toBe(false)
    expect(entwurfNehmen()).toBe('Normaler Entwurf')

    window.removeEventListener(AI_ENTWURF_EVENT, listener)
  })
})
