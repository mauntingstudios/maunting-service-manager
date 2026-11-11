/**
 * Die geladenen Sprachdaten der Übersetzung unter Einstellungen › Allgemein:
 * welche, wie groß, entfernen.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@maunting/ui'
import { formatBytes } from '@/lib/format'

import { Abschnitt, Aktionszeile } from '../einstellungen/bausteine'
import { useUebersetzungDomainStore } from './domainStore'
import { engineBeenden } from './engine'
import { entfernen, geladen } from './modelle'

export function UebersetzungEinstellungen() {
  const { t, i18n } = useTranslation()
  const [liste, setListe] = useState<{ paar: string; groesse: number }[] | null>(null)
  const neu = () => void geladen().then(setListe, () => setListe([]))
  useEffect(neu, [])

  const namen = new Intl.DisplayNames([i18n.language], { type: 'language' })
  const paarName = (paar: string) => {
    const [von, nach] = paar.split(/-(?=[^-]+$)/)
    return t('browser.uebersetzung.paar', { von: namen.of(von) ?? von, nach: namen.of(nach) ?? nach })
  }
  const weg = async (paar?: string) => {
    await entfernen(paar)
    if (paar) {
      useUebersetzungDomainStore.getState().entfernePaarDomains(paar)
    } else {
      useUebersetzungDomainStore.setState({ domains: {} })
    }
    // Die Engine hält geladene Modelle im Speicher; sie fängt beim nächsten Mal neu an.
    engineBeenden()
    neu()
  }

  const domainsFuer = useUebersetzungDomainStore((s) => s.domains)

  return (
    <Abschnitt titel={t('browser.uebersetzung.name')}>
      <p className="text-body-sm text-on-surface-variant">{t('browser.uebersetzung.erklaerung')}</p>
      {liste?.length === 0 && <p className="text-body-sm text-on-surface-variant">{t('browser.uebersetzung.keine')}</p>}
      {liste?.map(({ paar, groesse }) => {
        const doms = Object.values(domainsFuer).filter((d) => d.paar === paar)
        const hinweis = doms.length > 0
          ? `${formatBytes(groesse)} · ${doms.map((d) => d.domain + (d.auto ? ` (${t('browser.uebersetzung.auto', { defaultValue: 'Auto' })})` : '')).join(', ')}`
          : formatBytes(groesse)
        return (
          <Aktionszeile
            key={paar}
            name={paarName(paar)}
            hinweis={hinweis}
          >
            <Button variant="secondary" size="sm" onClick={() => void weg(paar)} aria-label={t('browser.uebersetzung.entfernenName', { paar: paarName(paar) })}>
              {t('common.remove')}
            </Button>
          </Aktionszeile>
        )
      })}
      {!!liste?.length && (
        <Aktionszeile name={t('browser.uebersetzung.alle')}>
          <Button variant="secondary" size="sm" onClick={() => void weg()}>
            {t('browser.uebersetzung.alleEntfernen')}
          </Button>
        </Aktionszeile>
      )}
    </Abschnitt>
  )
}
