/**
 * Der geteilte Hintergrund einer Gruppe — im Reiter „Hintergrund".
 *
 * Anders als ein persönlicher Chat-Hintergrund gehört er der Gruppe: was hier
 * gespeichert wird, sehen alle Mitglieder. Deshalb liegt er verschlüsselt beim
 * Server (`chat_group_backgrounds`) und nicht in der Ablage dieses Geräts, und
 * ändern darf ihn nur, wer `set_group_background` trägt.
 */

import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ImagePlus, Layers, Sliders, Trash2 } from 'lucide-react'

import { Button } from '@/Singra/UI'
import type { GruppenKontext } from '@/services/gruppenSchluessel'
import { aendereGruppenHintergrund, ladeGruppenHintergrund } from '@/services/gruppenInfo'
import { toast } from '@/stores/toastStore'

import { bildAlsHintergrund } from './bild'
import { HintergrundFlaeche } from './ChatHintergrund'
import { HINTERGRUND_VORLAGEN, STANDARD_VORLAGE, type HintergrundId } from './vorlagen'

interface Props {
  kontext: GruppenKontext | null
  kannAendern: boolean
}

export function GruppenHintergrundFeld({ kontext, kannAendern }: Props) {
  const { t } = useTranslation()
  const [preset, setPreset] = useState<HintergrundId | null>(null)
  const [bild, setBild] = useState<string | null>(null)
  const [dim, setDim] = useState(25)
  const [laedt, setLaedt] = useState(false)
  const [speichert, setSpeichert] = useState(false)
  const dateiFeld = useRef<HTMLInputElement>(null)
  const gruppeId = kontext?.groupId ?? 0

  useEffect(() => {
    if (!kontext || !gruppeId) return
    let abgebrochen = false
    setLaedt(true)
    void ladeGruppenHintergrund(kontext)
      .then((lesung) => {
        if (abgebrochen) return
        if (lesung.art === 'hintergrund') {
          const roh = lesung.hintergrund
          const bekannt = HINTERGRUND_VORLAGEN.some((v) => v.id === roh.preset)
          setPreset(bildOder(roh.bild, roh.preset, bekannt))
          setBild(roh.bild)
          setDim(roh.dim)
        } else {
          setPreset(null)
          setBild(null)
          setDim(25)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!abgebrochen) setLaedt(false)
      })
    return () => {
      abgebrochen = true
    }
    // Der Kontext wird bei jedem Rendern neu gebaut; entscheidend sind die
    // beiden Werte, aus denen er für diesen Block besteht.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gruppeId, kontext?.blindMailboxId])

  const nimmDatei = async (datei: File | undefined) => {
    if (!datei || !kannAendern) return
    if (!datei.type.startsWith('image/')) {
      toast.error(t('social.wallpaper.badType'))
      return
    }
    // Der Gruppenblock fasst 1 MiB Zeichen; das Chiffrat bläht Base64 um 4/3.
    const dataUrl = await bildAlsHintergrund(datei, 600_000)
    if (!dataUrl) {
      toast.error(t('social.wallpaper.tooLarge'))
      return
    }
    setBild(dataUrl)
    setPreset('custom')
  }

  const speichern = async () => {
    if (!kontext || !kannAendern || speichert) return
    setSpeichert(true)
    try {
      const ergebnis = await aendereGruppenHintergrund(
        kontext,
        () => true,
        () => ({
          v: 1,
          preset,
          dim,
          bild: preset === 'custom' ? bild : null,
        }),
        preset === 'custom' && bild ? 'image/webp' : null,
      )
      if (ergebnis.art !== 'gespeichert') {
        toast.error(t('social.groupRoles.backgroundSaveFailed'))
        return
      }
      toast.success(t('social.groupRoles.backgroundSaved'))
    } catch {
      toast.error(t('social.groupRoles.backgroundSaveFailed'))
    } finally {
      setSpeichert(false)
    }
  }

  const zuruecksetzen = () => {
    setPreset(null)
    setBild(null)
    setDim(25)
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-on-surface-variant/80">
        {kannAendern
          ? t('social.groupRoles.backgroundHint')
          : t('social.groupRoles.backgroundNoRight')}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <button
          type="button"
          disabled={!kannAendern || laedt}
          onClick={zuruecksetzen}
          aria-pressed={preset === null}
          className={`relative p-3 rounded-xl border text-left min-h-20 overflow-hidden transition-all disabled:opacity-60 ${
            preset === null
              ? 'border-primary ring-2 ring-primary/40 bg-primary/10'
              : 'border-outline-variant/30 bg-surface-container-low'
          }`}
        >
          <Trash2 className="w-4 h-4 text-on-surface-variant" />
          <p className="text-xs font-bold text-on-surface mt-2">
            {t('social.groupRoles.backgroundNone')}
          </p>
          <p className="text-label-sm text-on-surface-variant/80">
            {t('social.groupRoles.backgroundNoneHint')}
          </p>
        </button>

        {HINTERGRUND_VORLAGEN.map((vorlage) => {
          const aktiv = preset === vorlage.id
          const Zeichen = vorlage.icon
          return (
            <button
              key={vorlage.id}
              type="button"
              disabled={!kannAendern || laedt}
              onClick={() => setPreset(vorlage.id)}
              aria-pressed={aktiv}
              className={`relative p-3 rounded-xl border text-left min-h-20 overflow-hidden transition-all disabled:opacity-60 ${
                aktiv
                  ? 'border-primary ring-2 ring-primary/40'
                  : 'border-outline-variant/30 hover:border-outline-variant/60'
              }`}
            >
              <div className="absolute inset-0 pointer-events-none">
                <HintergrundFlaeche vorlage={vorlage.id} />
              </div>
              <div className="relative z-10 flex items-center justify-between">
                <span className={`p-1 rounded-md ${vorlage.iconKlassen ?? 'bg-primary/15 text-primary'}`}>
                  <Zeichen className="w-3.5 h-3.5" />
                </span>
                {aktiv && (
                  <span className="w-4 h-4 rounded-full bg-primary text-on-primary flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 stroke-[3]" />
                  </span>
                )}
              </div>
              <p className="relative z-10 text-xs font-bold text-on-surface mt-2">
                {t(vorlage.nameKey)}
              </p>
            </button>
          )
        })}
      </div>

      <div className="rounded-2xl border border-outline-variant/30 bg-surface-container/70 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-on-surface flex items-center gap-1.5">
            <ImagePlus className="w-3.5 h-3.5 text-primary" />
            {t('social.groupRoles.backgroundOwn')}
          </span>
          {bild && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!kannAendern}
              onClick={() => {
                setBild(null)
                setPreset(null)
              }}
            >
              {t('social.groupRoles.backgroundRemove')}
            </Button>
          )}
        </div>

        <input
          ref={dateiFeld}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(e) => {
            void nimmDatei(e.target.files?.[0])
            e.currentTarget.value = ''
          }}
        />
        <Button
          type="button"
          variant={preset === 'custom' ? 'primary' : 'secondary'}
          size="sm"
          disabled={!kannAendern || laedt}
          onClick={() => dateiFeld.current?.click()}
          className="gap-1.5"
        >
          <ImagePlus className="w-4 h-4" />
          {bild ? t('social.groupRoles.backgroundReplace') : t('social.groupRoles.backgroundChoose')}
        </Button>

        {bild && preset === 'custom' && (
          <div className="relative h-24 w-full rounded-xl overflow-hidden border border-outline-variant/40">
            <HintergrundFlaeche vorlage="custom" eigenesBild={bild} />
            <div
              className="absolute inset-0 bg-black"
              style={{ opacity: dim / 100 }}
              aria-hidden="true"
            />
          </div>
        )}

        <div className="space-y-1.5 pt-1 border-t border-outline-variant/20">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-on-surface flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-primary" />
              {t('social.wallpaper.dim')}
            </span>
            <span className="font-mono text-label-sm text-primary">{dim}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="75"
            step="5"
            value={dim}
            disabled={!kannAendern}
            onChange={(e) => setDim(Number(e.target.value))}
            aria-label={t('social.wallpaper.dim')}
            className="w-full accent-primary h-1.5 bg-surface-container-highest rounded-lg cursor-pointer"
          />
        </div>

        <p className="text-label-sm text-on-surface-variant/80 flex items-center gap-1.5">
          <Layers className="w-3.5 h-3.5" />
          {t('social.groupRoles.backgroundShared')}
        </p>

        {kannAendern && (
          <div className="flex justify-end pt-1">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={speichert || laedt}
              onClick={() => void speichern()}
              className="gap-2 rounded-xl px-4 py-2"
            >
              <Check className="w-4 h-4" />
              {speichert ? t('common.saving') : t('social.groupRoles.backgroundSave')}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

function bildOder(
  bild: string | null,
  preset: string | null,
  bekannt: boolean,
): HintergrundId | null {
  if (bild) return 'custom'
  if (preset && bekannt) return preset as HintergrundId
  if (preset === STANDARD_VORLAGE) return STANDARD_VORLAGE
  return null
}
