import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Slider } from '@maunting/ui'
import { normalizePanelLanguage, panelLanguageCodes, type PanelLanguageCode } from '@/config/panelLocales'
import {
  DUCKING_PROZENT_MAX,
  DUCKING_PROZENT_MIN,
  DUCKING_SCHRITT,
  getAudioSettings,
  saveAudioSettings,
  subscribeAudioSettings,
} from '@/lib/audioSettings'
import { still } from '@/lib/still'

import { useEinstellungenStore } from '../services/einstellungenStore'
import { useGeraetKonfig } from '../services/geraetKonfig'
import { istTauri } from '../services/nativ'
import { Abschnitt, Auswahlzeile, Schalterzeile } from './bausteine'
import { Standardbrowser } from './Standardbrowser'
import { UebersetzungEinstellungen } from '../uebersetzung/UebersetzungEinstellungen'

export function Allgemein() {
  const { t, i18n } = useTranslation()
  const beimStart = useEinstellungenStore((s) => s.beimStart)
  const setzen = useEinstellungenStore((s) => s.setzen)
  const [duckingAktiv, setDuckingAktiv] = useState(() => getAudioSettings().audioDuckingEnabled)
  const [duckingProzent, setDuckingProzent] = useState(() => getAudioSettings().audioDuckingPercent)
  const duckingTimer = useRef<number | null>(null)

  useEffect(() => {
    const uebernehmen = () => {
      const aktuell = getAudioSettings()
      setDuckingAktiv(aktuell.audioDuckingEnabled)
      setDuckingProzent(aktuell.audioDuckingPercent)
    }
    uebernehmen()
    return subscribeAudioSettings(uebernehmen)
  }, [])

  function duckingUmschalten(an: boolean) {
    setDuckingAktiv(an)
    saveAudioSettings({ audioDuckingEnabled: an })
    if (istTauri()) {
      void useGeraetKonfig
        .getState()
        .aendern({ audio_ducking_aktiv: an })
        .catch((err) => still(err, 'browser.allgemein.duckingAktiv'))
    }
  }

  function duckingProzentSetzen(prozent: number) {
    setDuckingProzent(prozent)
    saveAudioSettings({ audioDuckingPercent: prozent })
    if (istTauri()) {
      if (duckingTimer.current !== null) window.clearTimeout(duckingTimer.current)
      duckingTimer.current = window.setTimeout(() => {
        duckingTimer.current = null
        void useGeraetKonfig
          .getState()
          .aendern({ audio_ducking_prozent: prozent })
          .catch((err) => still(err, 'browser.allgemein.duckingProzent'))
      }, 150)
    }
  }

  return (
    <>
      <Abschnitt titel={t('browser.einstellungen.kategorie.allgemein')}>
        <Auswahlzeile
          name={t('browser.einstellungen.beimStart')}
          wert={beimStart}
          optionen={[
            { value: 'letzte', label: t('browser.einstellungen.start.letzte') },
            { value: 'startseite', label: t('browser.einstellungen.start.startseite') },
          ]}
          aendern={(v) => setzen({ beimStart: v })}
        />
        <Auswahlzeile<PanelLanguageCode>
          name={t('browser.einstellungen.sprache')}
          wert={normalizePanelLanguage(i18n.language)}
          optionen={panelLanguageCodes.map((code) => ({ value: code, label: t(`browser.einstellungen.spracheName.${code}`) }))}
          aendern={(code) => void i18n.changeLanguage(code)}
        />
        {istTauri() && <Standardbrowser />}
      </Abschnitt>
      <Abschnitt titel={t('mss.audio.titel')}>
        <Schalterzeile
          name={t('mss.audio.ducking')}
          hinweis={t('mss.audio.duckingHinweis')}
          an={duckingAktiv}
          aendern={duckingUmschalten}
        />
        <Slider
          value={duckingProzent}
          min={DUCKING_PROZENT_MIN}
          max={DUCKING_PROZENT_MAX}
          step={DUCKING_SCHRITT}
          disabled={!duckingAktiv}
          onValueChange={duckingProzentSetzen}
          label={t('mss.audio.duckingProzent')}
          hint={`-${duckingProzent} %`}
        />
        <p className="text-label-sm text-on-surface-variant">{t('mss.audio.duckingProzentHinweis')}</p>
      </Abschnitt>
      <UebersetzungEinstellungen />
    </>
  )
}
