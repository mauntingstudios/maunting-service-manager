/**
 * Der Sticker-Mixer: Emoji wählen, Hintergrund und Sterne einstellen, senden.
 *
 * Der Dialog lebt im Picker und wird nur beim Öffnen geladen. Gesendet wird ein
 * fertiges SVG über denselben `sticker_attachment`-Weg wie die handgezeichneten
 * Sticker; der Empfänger braucht weder Assets noch eine zweite Darstellung.
 */

import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Sparkles, X } from 'lucide-react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Kurzinfo,
  Switch,
  type DropdownOption,
} from '@maunting/ui'
import { EMOJI_KATEGORIEN, type EmojiKategorieId } from '@/assets/twemoji'
import { still } from '@/lib/still'
import { sanitizeSvg } from '@/lib/sanitizeSvg'
import { baueSticker } from '@/services/stickerMixer'
import {
  MAX_MIX_EMOJI,
  MIX_HINTERGRUENDE,
  STANDARD_REZEPT,
  type MixRezept,
} from '@/services/stickerMixerTypen'
import { MIX_PRESETS } from '@/services/stickerMixerPresets'
import type { StickerPack } from '@/services/stickerPacks'

export interface StickerMixerProps {
  open: boolean
  onOpenChange: (offen: boolean) => void
  /** Bleibt beim Schließen des Dialogs erhalten, solange der Picker offen ist. */
  rezept: MixRezept
  onRezept: (rezept: MixRezept) => void
  packs: StickerPack[]
  zielPackId: string | null
  onZielPack: (id: string) => void
  onNeuesPack: () => Promise<string | null>
  /** Legt den Mix ab und sendet ihn, wenn `senden` gilt. */
  onMixFertig: (rezept: MixRezept, miniatur: string, senden: boolean) => Promise<void>
}

const NEUES_PACK = '__neu__'

export function StickerMixer({
  open,
  onOpenChange,
  rezept,
  onRezept,
  packs,
  zielPackId,
  onZielPack,
  onNeuesPack,
  onMixFertig,
}: StickerMixerProps) {
  const { t } = useTranslation()
  const titelId = useId()
  const beschreibungId = useId()
  const sterneId = useId()

  const [kategorie, setKategorie] = useState<EmojiKategorieId>('gesichter')
  const [arbeitet, setArbeitet] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  const voll = rezept.emojis.length >= MAX_MIX_EMOJI
  const vorschau = useMemo(() => baueSticker(rezept), [rezept])
  const vorschauSvg = useMemo(() => (vorschau ? sanitizeSvg(vorschau.svg) : ''), [vorschau])

  const presets = useMemo(
    () =>
      MIX_PRESETS.flatMap((preset) => {
        const sticker = baueSticker(preset.rezept)
        return sticker ? [{ ...preset, vorschau: sanitizeSvg(sticker.svg) }] : []
      }),
    [],
  )

  const packOptionen: DropdownOption[] = [
    ...packs.map((pack) => ({ value: pack.id, label: pack.name })),
    { value: NEUES_PACK, label: t('messenger.mixer.newPack') },
  ]

  const grafiken = EMOJI_KATEGORIEN.find((eintrag) => eintrag.id === kategorie)?.grafiken ?? {}

  function hinzufuegen(emoji: string) {
    if (voll) return
    onRezept({ ...rezept, emojis: [...rezept.emojis, emoji] })
  }

  function entfernen(index: number) {
    onRezept({ ...rezept, emojis: rezept.emojis.filter((_, i) => i !== index) })
  }

  async function abschliessen(quelle: MixRezept, auchSenden: boolean) {
    const sticker = baueSticker(quelle)
    if (!sticker || arbeitet) return
    setArbeitet(true)
    setFehler(null)
    try {
      await onMixFertig(quelle, sticker.svg, auchSenden)
      onOpenChange(false)
    } catch (grund) {
      still(grund, 'StickerMixer.abschliessen')
      setFehler(t('messenger.mixer.packRequired'))
    } finally {
      setArbeitet(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="voll"
        aria-labelledby={titelId}
        aria-describedby={beschreibungId}
        className="max-sm:pb-[var(--msm-unten-sicher)] sm:max-w-xl sm:rounded-2xl sm:border sm:border-outline-variant/30"
      >
        <div className="mx-auto flex h-full w-full max-w-xl flex-col">
          <DialogHeader className="pr-14">
            <DialogTitle id={titelId}>{t('messenger.mixer.title')}</DialogTitle>
            <DialogDescription id={beschreibungId}>
              {t('messenger.mixer.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            <div className="flex flex-col items-center gap-2">
              <div
                role={vorschau ? 'img' : undefined}
                aria-label={vorschau ? vorschau.label : undefined}
                className="grid h-36 w-36 place-items-center rounded-3xl bg-surface-container/60"
              >
                {vorschauSvg ? (
                  <div
                    aria-hidden="true"
                    className="h-32 w-32 [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: vorschauSvg }}
                  />
                ) : (
                  <span className="px-4 text-center text-xs text-on-surface-variant">
                    {t('messenger.mixer.emptyPreview')}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-center gap-2">
                {rezept.emojis.map((emoji, index) => (
                  <Kurzinfo
                    key={`${emoji}-${index}`}
                    text={t('messenger.mixer.remove', { emoji })}
                    seite="mitte"
                  >
                    <button
                      type="button"
                      onClick={() => entfernen(index)}
                      aria-label={t('messenger.mixer.remove', { emoji })}
                      className="flex h-11 items-center gap-1.5 rounded-full bg-surface-container-high px-3 text-lg transition-colors hover:bg-surface-container-highest"
                    >
                      <span aria-hidden="true">{emoji}</span>
                      <X className="h-3.5 w-3.5 text-on-surface-variant" aria-hidden="true" />
                    </button>
                  </Kurzinfo>
                ))}
              </div>
              {voll && (
                <p className="text-xs text-on-surface-variant">{t('messenger.mixer.limit')}</p>
              )}
            </div>

            <section className="space-y-2">
              <h4 className="text-xs font-medium text-on-surface-variant">
                {t('messenger.mixer.presetsLabel')}
              </h4>
              <div className="msm-ohne-rollbalken flex gap-2 overflow-x-auto pb-1">
                {presets.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => void abschliessen(preset.rezept, true)}
                    aria-label={t('messenger.mixer.sendPreset', { name: t(preset.nameKey) })}
                    className="flex w-20 shrink-0 flex-col items-center gap-1 rounded-2xl p-1.5 transition-colors hover:bg-surface-container-high"
                  >
                    <span
                      aria-hidden="true"
                      className="h-14 w-14 [&>svg]:h-full [&>svg]:w-full"
                      dangerouslySetInnerHTML={{ __html: preset.vorschau }}
                    />
                    <span className="w-full truncate text-center text-label-sm text-on-surface-variant">
                      {t(preset.nameKey)}
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h4 className="text-xs font-medium text-on-surface-variant">
                {t('messenger.mixer.backgroundsLabel')}
              </h4>
              <div className="flex flex-wrap gap-2">
                {MIX_HINTERGRUENDE.map((hintergrund) => {
                  const gewaehlt = rezept.hintergrund === hintergrund.id
                  return (
                    <Kurzinfo key={hintergrund.id} text={t(hintergrund.labelKey)} seite="mitte">
                      <button
                        type="button"
                        aria-label={t(hintergrund.labelKey)}
                        aria-pressed={gewaehlt}
                        onClick={() => onRezept({ ...rezept, hintergrund: hintergrund.id })}
                        className={`relative grid h-11 w-11 place-items-center rounded-full border-2 transition-all ${
                          gewaehlt
                            ? 'border-primary'
                            : 'border-transparent hover:border-outline-variant'
                        }`}
                      >
                        {hintergrund.id === 'ohne' ? (
                          <span
                            aria-hidden="true"
                            className="h-7 w-7 rounded-full border border-dashed border-on-surface-variant/60"
                          />
                        ) : (
                          <span
                            aria-hidden="true"
                            className="h-8 w-8 rounded-full"
                            style={{ backgroundColor: hintergrund.ton }}
                          />
                        )}
                        {gewaehlt && (
                          <Check
                            aria-hidden="true"
                            className={`absolute h-4 w-4 drop-shadow ${
                              hintergrund.id === 'ohne' ? 'text-on-surface' : 'text-white'
                            }`}
                          />
                        )}
                      </button>
                    </Kurzinfo>
                  )
                })}
              </div>
            </section>

            <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-container/60 px-3 py-2">
              <span id={sterneId} className="flex items-center gap-2 text-sm text-on-surface">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                {t('messenger.mixer.sparkles')}
              </span>
              <Switch
                checked={rezept.sterne}
                aria-labelledby={sterneId}
                onCheckedChange={(geprueft) => onRezept({ ...rezept, sterne: geprueft })}
              />
            </div>

            <section className="space-y-2">
              <div className="msm-ohne-rollbalken flex gap-1.5 overflow-x-auto pb-1">
                {EMOJI_KATEGORIEN.map((eintrag) => (
                  <Button
                    key={eintrag.id}
                    type="button"
                    variant={kategorie === eintrag.id ? 'primary' : 'ghost'}
                    size="sm"
                    fingerziel
                    aria-pressed={kategorie === eintrag.id}
                    onClick={() => setKategorie(eintrag.id)}
                    className="shrink-0 rounded-full px-3"
                  >
                    {t(eintrag.labelKey)}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-6 gap-1 sm:grid-cols-10">
                {Object.entries(grafiken).map(([emoji, markierung]) => (
                  <button
                    key={emoji}
                    type="button"
                    disabled={voll}
                    onClick={() => hinzufuegen(emoji)}
                    aria-label={t('messenger.mixer.add', { emoji })}
                    className="grid h-10 w-10 place-items-center rounded-lg transition-colors hover:bg-surface-container-high disabled:cursor-not-allowed disabled:opacity-35 max-md:h-11 max-md:w-11"
                  >
                    <span
                      aria-hidden="true"
                      className="h-7 w-7 [&>svg]:h-full [&>svg]:w-full"
                      // Die Asset-Module tragen nur den Innenraum (Pfade ohne
                      // Wurzel), damit der Mixer sie in seine Gruppen setzen
                      // kann. Die Kachel braucht deshalb ihre eigene Hülle.
                      dangerouslySetInnerHTML={{
                        __html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">${markierung}</svg>`,
                      }}
                    />
                  </button>
                ))}
              </div>
            </section>
          </div>

          <DialogFooter className="flex-wrap gap-3">
            <div className="mr-auto flex min-w-0 flex-col items-start gap-1">
              <span className="text-label-sm font-medium text-on-surface-variant">
                {t('messenger.mixer.packLabel')}
              </span>
              <div className="min-w-44">
                <Dropdown
                  value={zielPackId}
                  onChange={(wert) => {
                    if (wert === NEUES_PACK) {
                      void onNeuesPack().then((id) => {
                        if (id) onZielPack(id)
                      })
                      return
                    }
                    onZielPack(wert)
                  }}
                  options={packOptionen}
                  placeholder={t('messenger.stickerPacks.defaultName')}
                  aria-label={t('messenger.mixer.packLabel')}
                  disabled={arbeitet}
                />
              </div>
              {fehler && (
                <p role="alert" className="text-label-sm text-status-destructive">
                  {fehler}
                </p>
              )}
              <a
                href="https://github.com/jdecked/twemoji"
                target="_blank"
                rel="noopener noreferrer"
                className="text-label-sm text-on-surface-variant/70 underline-offset-2 hover:text-primary hover:underline"
              >
                {t('messenger.mixer.attribution')}
              </a>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                fingerziel
                disabled={
                  rezept.emojis.length === 0 &&
                  rezept.hintergrund === STANDARD_REZEPT.hintergrund &&
                  !rezept.sterne
                }
                onClick={() => onRezept({ ...STANDARD_REZEPT })}
              >
                {t('messenger.mixer.reset')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                fingerziel
                disabled={!vorschau || arbeitet}
                onClick={() => void abschliessen(rezept, false)}
              >
                {t('messenger.mixer.save')}
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                fingerziel
                disabled={!vorschau || arbeitet}
                onClick={() => void abschliessen(rezept, true)}
              >
                {t('messenger.mixer.send')}
              </Button>
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
