import { beforeEach, describe, expect, it } from 'vitest'
import { extrahiereDomain, useUebersetzungDomainStore } from './domainStore'

describe('UebersetzungDomainStore', () => {
  beforeEach(() => {
    useUebersetzungDomainStore.setState({ domains: {} })
  })

  it('extrahiert Hostnames sauber aus URLs', () => {
    expect(extrahiereDomain('https://de.wikipedia.org/wiki/Schild')).toBe('de.wikipedia.org')
    expect(extrahiereDomain('http://localhost:3000/test')).toBe('localhost')
    expect(extrahiereDomain('ungueltig')).toBe('')
  })

  it('merkt sich Domains für Sprachpaare und filtert nach Paar', () => {
    const store = useUebersetzungDomainStore.getState()
    store.merkeDomain('https://de.wikipedia.org/wiki/Test', 'de-en', true)
    store.merkeDomain('https://github.com/maunting', 'en-de', false)

    expect(store.getDomainEintrag('https://de.wikipedia.org/foo')).toMatchObject({
      domain: 'de.wikipedia.org',
      paar: 'de-en',
      auto: true,
    })

    const deEn = store.domainsFuerPaar('de-en')
    expect(deEn).toHaveLength(1)
    expect(deEn[0].domain).toBe('de.wikipedia.org')

    const enDe = store.domainsFuerPaar('en-de')
    expect(enDe).toHaveLength(1)
    expect(enDe[0].domain).toBe('github.com')

    store.setAutoUebersetzen('github.com', true)
    expect(store.getDomainEintrag('https://github.com/bar')?.auto).toBe(true)

    store.entfernePaarDomains('de-en')
    expect(store.domainsFuerPaar('de-en')).toHaveLength(0)
    expect(store.domainsFuerPaar('en-de')).toHaveLength(1)
  })
})
