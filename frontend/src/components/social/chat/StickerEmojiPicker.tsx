import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Button, Kurzinfo, Spinner } from '@maunting/ui'
import { sanitizeSvg } from '@/lib/sanitizeSvg'
import { CATEGORIZED_EMOJIS, IN_HOUSE_STICKERS, type StickerMotiv } from '@/services/stickerCatalog'
import { STANDARD_REZEPT, type MixRezept } from '@/services/stickerMixerTypen'

/**
 * Der Mixer zieht die Emoji-Assets mit. Er wird deshalb erst beim Öffnen
 * geladen; das Startbündel und der Messenger-Chunk bleiben unberührt.
 */
const StickerMixer = lazy(() =>
  import('./StickerMixer').then((modul) => ({ default: modul.StickerMixer })),
)

export type PickerReiter = 'stickers' | 'mixer' | 'emojis'

const REITER: { id: PickerReiter; labelKey: string }[] = [
  { id: 'stickers', labelKey: 'messenger.stickerTabs.sticker' },
  { id: 'mixer', labelKey: 'messenger.stickerTabs.mixer' },
  { id: 'emojis', labelKey: 'messenger.stickerTabs.emojis' },
]

interface StickerEmojiPickerProps {
  /** Bleibt über das Schliessen hinaus stehen, deshalb hält ihn die Seite. */
  reiter: PickerReiter
  onReiter: (reiter: PickerReiter) => void
  /** Ein Sticker geht sofort als eigene Nachricht raus. */
  onSticker: (sticker: StickerMotiv) => void
  /** Ein Emoji landet im Eingabefeld. */
  onEmoji: (emoji: string) => void
  onSchliessen: () => void
}

/** Die Auswahl aus Stickern, Mixer und Emojis über der Eingabe. */
export function StickerEmojiPicker({
  reiter,
  onReiter,
  onSticker,
  onEmoji,
  onSchliessen,
}: StickerEmojiPickerProps) {
  const { t } = useTranslation()
  const [mixerOffen, setMixerOffen] = useState(false)
  // Der Entwurf überlebt das Schließen des Dialogs. Erst wenn die Auswahl
  // selbst zugemacht wird, fällt er mit ihr weg.
  const [mixRezept, setMixRezept] = useState<MixRezept>({ ...STANDARD_REZEPT })

  return (
    <div className="mb-2 p-2.5 rounded-xl bg-surface-container border border-outline-variant/30 shadow-lg animate-slide-up">
      <div className="flex items-center justify-between pb-1.5 mb-1.5 border-b border-outline-variant/20">
        <div className="flex items-center gap-1.5">
          {REITER.map((eintrag) => (
            <Button
              key={eintrag.id}
              type="button"
              variant={reiter === eintrag.id ? 'primary' : 'ghost'}
              size="sm"
              fingerziel
              onClick={() => {
                // Wer den Reiter verlässt, schließt auch den Mixer-Dialog.
                if (eintrag.id !== 'mixer') setMixerOffen(false)
                onReiter(eintrag.id)
              }}
              className="rounded-full px-2.5 text-xs"
            >
              {t(eintrag.labelKey)}
            </Button>
          ))}
        </div>
        <button
          type="button"
          onClick={onSchliessen}
          className="grid h-8 w-8 place-items-center rounded-md text-on-surface-variant hover:text-on-surface max-md:h-11 max-md:w-11"
          aria-label={t('common.close')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {reiter === 'stickers' && (
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 max-h-48 overflow-y-auto p-1.5">
          {IN_HOUSE_STICKERS.map((stk) => (
            // Der Name ist unter dem Sticker oft abgeschnitten; die Kurzinfo zeigt
            // ihn ganz. `ende`, weil eine mittige Blase in der rechten Spalte
            // über den Rand der Rollfläche ragte und eine Querleiste aufschöbe.
            <Kurzinfo key={stk.id} text={stk.label} seite="ende" aussen="min-w-0 w-full">
              <button
                type="button"
                onClick={() => onSticker(stk)}
                className="w-full min-w-0 flex flex-col items-center justify-center p-1.5 rounded-xl hover:bg-surface-container-high transition-transform hover:scale-105"
              >
                <div
                  className="w-11 h-11 flex items-center justify-center [&>svg]:h-full [&>svg]:w-full"
                  dangerouslySetInnerHTML={{ __html: sanitizeSvg(stk.svg) }}
                />
                <span className="text-label-sm text-on-surface-variant/80 truncate w-full text-center mt-1 font-medium">
                  {stk.label}
                </span>
              </button>
            </Kurzinfo>
          ))}
        </div>
      )}

      {reiter === 'mixer' && (
        <div className="flex flex-col items-start gap-3 p-2">
          <p className="text-xs text-on-surface-variant">{t('messenger.mixer.openHint')}</p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            fingerziel
            onClick={() => setMixerOffen(true)}
          >
            {t('messenger.mixer.open')}
          </Button>
          {mixerOffen && (
            <Suspense
              fallback={
                <div className="flex h-16 items-center justify-center text-primary">
                  <Spinner size="md" />
                </div>
              }
            >
              <StickerMixer
                open={mixerOffen}
                onOpenChange={setMixerOffen}
                rezept={mixRezept}
                onRezept={setMixRezept}
                onSticker={onSticker}
              />
            </Suspense>
          )}
        </div>
      )}

      {reiter === 'emojis' && (
        <div className="space-y-3 max-h-52 overflow-y-auto p-1.5">
          {CATEGORIZED_EMOJIS.map((cat) => (
            <div key={cat.category} className="space-y-1">
              <div className="text-label-sm font-bold text-on-surface-variant/70 uppercase tracking-wider px-1">
                {cat.category}
              </div>
              <div className="grid grid-cols-8 sm:grid-cols-12 gap-1">
                {cat.emojis.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => onEmoji(emoji)}
                    className="p-1 text-lg rounded-lg hover:bg-surface-container-high transition-transform hover:scale-125 flex items-center justify-center"
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
