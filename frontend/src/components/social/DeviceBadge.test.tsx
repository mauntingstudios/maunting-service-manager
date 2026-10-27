import { render, screen } from '@testing-library/react'
import { beforeAll, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { DeviceBadge } from './DeviceBadge'

// Die Sprache festlegen: die Behauptungen unten prüfen deutsche Texte, und
// ohne diese Zeile entscheidet navigator.language der Testumgebung.
beforeAll(async () => {
  await i18n.changeLanguage('de')
})

describe('DeviceBadge', () => {
  it('renders web badge by default', () => {
    render(<DeviceBadge showLabel />)
    expect(screen.getByText(i18n.t('social.device.web'))).toBeInTheDocument()
    expect(screen.getByRole('img', { name: i18n.t('social.device.web') })).toBeInTheDocument()
  })

  it('renders desktop badge when type is desktop', () => {
    render(<DeviceBadge deviceType="desktop" showLabel />)
    expect(screen.getByText(i18n.t('social.device.desktop'))).toBeInTheDocument()
    expect(screen.getByRole('img', { name: i18n.t('social.device.desktop') })).toBeInTheDocument()
  })

  it('renders mobile badge when type is mobile', () => {
    render(<DeviceBadge deviceType="mobile" showLabel />)
    expect(screen.getByText(i18n.t('social.device.mobile'))).toBeInTheDocument()
    expect(screen.getByRole('img', { name: i18n.t('social.device.mobile') })).toBeInTheDocument()
  })

  it('setzt kein natives title; ohne sichtbaren Namen bleibt er am Symbol', () => {
    const { container } = render(<DeviceBadge deviceType="mobile" />)
    expect(container.querySelectorAll('[title]')).toHaveLength(0)
    expect(screen.getByRole('img', { name: i18n.t('social.device.mobile') })).toBeInTheDocument()
    expect(container.querySelector(`[data-kurzinfo="${i18n.t('social.device.mobile')}"]`)).not.toBeNull()
  })

  it('nennt die Oberfläche beim Namen, nicht die Plattform', () => {
    // Bis 27.10.2026 meldeten Web-Panel und beide Apps dasselbe „Desktop“.
    const { rerender } = render(<DeviceBadge client="web" showLabel />)
    expect(screen.getByText(i18n.t('presence.client.web'))).toBeInTheDocument()

    rerender(<DeviceBadge client="pontis" showLabel />)
    expect(screen.getByText(i18n.t('presence.client.pontis'))).toBeInTheDocument()

    rerender(<DeviceBadge client="mss" deviceType="desktop" showLabel />)
    expect(screen.getByText(i18n.t('presence.client.mss'))).toBeInTheDocument()
  })
})
