import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/pages/Docs', () => ({ Docs: () => <div data-testid="hilfe-index" /> }))
vi.mock('@/pages/docs/BlueprintsDocs', () => ({ BlueprintsDocs: () => <div data-testid="hilfe-blueprints" /> }))
vi.mock('@/pages/docs/OAuthDocs', () => ({ OAuthDocs: () => <div data-testid="hilfe-oauth" /> }))
vi.mock('@/pages/docs/SelfHostingDocs', () => ({ SelfHostingDocs: () => <div data-testid="hilfe-self-hosting" /> }))
vi.mock('@/pages/docs/HosterApiDocs', () => ({ HosterApiDocs: () => <div data-testid="hilfe-hoster-api" /> }))

import { HilfeBereich, istHilfeRoute } from './HilfeBereich'

function zeige(pfad: string) {
  return render(
    <MemoryRouter initialEntries={[pfad]}>
      <Routes>
        <Route path="/*" element={<HilfeBereich />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('HilfeBereich', () => {
  it.each([
    ['/docs', 'hilfe-index'],
    ['/docs/blueprints', 'hilfe-blueprints'],
    ['/docs/oauth', 'hilfe-oauth'],
    ['/docs/self-hosting', 'hilfe-self-hosting'],
    ['/docs/hoster-api', 'hilfe-hoster-api'],
  ])('zeigt unter %s die Dokumentationsseite %s', async (pfad, testid) => {
    zeige(pfad)
    expect(await screen.findByTestId(testid)).toBeInTheDocument()
  })

  it('führt einen unbekannten Hilfe-Pfad zur Übersicht der Hilfe', async () => {
    zeige('/docs/gibt-es-nicht')
    expect(await screen.findByTestId('hilfe-index')).toBeInTheDocument()
  })

  it('erkennt die Hilfe-Pfade für Wiederherstellung und Navigation', () => {
    for (const pfad of ['/docs', '/docs/blueprints', '/docs/self-hosting']) {
      expect(istHilfeRoute(pfad), pfad).toBe(true)
    }
    for (const pfad of ['/', '/dokumente', '/einstellungen', '/docsx']) {
      expect(istHilfeRoute(pfad), pfad).toBe(false)
    }
  })
})
