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
    expect(anbieterMarke('chatgpt', 'ChatGPT')).toBe('OpenAI')
    expect(anbieterMarke('mein-sso', 'Firmen-KI', 'openai')).toBe('OpenAI')
    expect(anbieterMarke('slack', 'Slack')).toBe('Slack')
    expect(anbieterMarke('huggingface', 'Hugging Face')).toBe('HuggingFace')
    expect(anbieterMarke('linkedin', 'LinkedIn')).toBe('LinkedIn')
    expect(anbieterMarke('spotify', 'Spotify')).toBe('Spotify')
    expect(anbieterMarke('bitbucket', 'Bitbucket')).toBe('Bitbucket')
    expect(anbieterMarke('patreon', 'Patreon')).toBe('Patreon')
    expect(anbieterMarke('reddit', 'Reddit')).toBe('Reddit')
    expect(anbieterMarke('facebook', 'Facebook')).toBe('Facebook')
    expect(anbieterMarke('zoom', 'Zoom')).toBe('Zoom')
    expect(anbieterMarke('atlassian', 'Atlassian')).toBe('Atlassian')
    expect(anbieterMarke('figma', 'Figma')).toBe('Figma')
    expect(anbieterMarke('yahoo', 'Yahoo')).toBe('Yahoo')
    expect(anbieterMarke('paypal', 'PayPal')).toBe('PayPal')
    expect(anbieterMarke('vercel', 'Vercel')).toBe('Vercel')
  })

  it('fällt bei unbekannten Anbietern auf ein neutrales Symbol zurück', () => {
    const { container, rerender } = render(<AnbieterSymbol slug="gitlab" name="GitLab" />)
    expect(container.querySelector('[data-anbieter="GitLab"]')).not.toBeNull()

    rerender(<AnbieterSymbol slug="firma" name="Zzz Beispiel" />)
    expect(container.querySelector('[data-anbieter="neutral"]')).not.toBeNull()
  })
})
