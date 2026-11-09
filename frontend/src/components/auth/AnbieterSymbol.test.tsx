import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AnbieterSymbol, anbieterMarke } from './AnbieterSymbol'

describe('AnbieterSymbol', () => {
  it('ordnet Slug und Anzeigename den vorhandenen Marken zu', () => {
    expect(anbieterMarke('google', 'Google')).toBe('Google')
    expect(anbieterMarke('x', '')).toBe('X')
    expect(anbieterMarke('firma-sso', 'X (Twitter)')).toBe('X')
    expect(anbieterMarke('firma-sso', 'GitHub Enterprise')).toBe('GitHub')
    expect(anbieterMarke('microsoft', 'Microsoft Entra ID')).toBe('Microsoft')
    expect(anbieterMarke('steam', 'Steam')).toBe('Steam')
    expect(anbieterMarke('apple', 'Apple')).toBe('Apple')
    expect(anbieterMarke('gitlab', 'GitLab')).toBe('GitLab')
    expect(anbieterMarke('twitch', 'Twitch')).toBe('Twitch')
  })

  it('fällt bei unbekannten Anbietern auf ein neutrales Symbol zurück', () => {
    const { container, rerender } = render(<AnbieterSymbol slug="gitlab" name="GitLab" />)
    expect(container.querySelector('[data-anbieter="GitLab"]')).not.toBeNull()

    rerender(<AnbieterSymbol slug="firma" name="Zzz Beispiel" />)
    expect(container.querySelector('[data-anbieter="neutral"]')).not.toBeNull()
  })
})
