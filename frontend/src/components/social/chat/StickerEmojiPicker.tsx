import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Folder, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button, Kurzinfo, Spinner } from '@maunting/ui'

import { sanitizeSvg } from '@/lib/sanitizeSvg'
import { still } from '@/lib/still'
import { toast } from '@/stores/toastStore'
import { prompt } from '@/stores/promptStore'
import { confirm } from '@/stores/confirmStore'
import { CATEGORIZED_EMOJIS, type StickerMotiv } from '@/services/stickerCatalog'
import { STICKER_THEMES, SYSTEM_STICKERS, type StickerThemeId } from '@/services/systemStickers'
import { rezeptId, STANDARD_REZEPT, type MixRezept } from '@/services/stickerMixerTypen'
import {
  benenneStickerPack,
  erstelleStickerPack,
  ladeStickerBestand,
  ladeStickerBild,
  loescheSticker,
  loescheStickerPack,
  speichereBildSticker,
  speichereMixSticker,
} from '@/services/messengerLocalStore'
import {
  effektivesCover,
  stickerLabel,
  type BildStickerEintrag,
  type EigenSticker,
  type StickerPack,
} from '@/services/stickerPacks'
import { bildStickerMotiv } from '@/services/bildSticker'
import type { BildStickerDaten } from './BildStickerEditor'

const StickerMixer = lazy(() =>
  import('./StickerMixer').then((modul) => ({ default: modul.StickerMixer })),
)
const BildStickerEditor = lazy(() =>
  import('./BildStickerEditor').then((modul) => ({ default: modul.BildStickerEditor })),
)

const SYSTEM_PACK = 'system'

export type PickerReiter = 'stickers' | 'mixer' | 'foto' | 'emojis'

const REITER: { id: PickerReiter; labelKey: string }[] = [
  { id: 'stickers', labelKey: 'messenger.stickerTabs.sticker' },
  { id: 'mixer', labelKey: 'messenger.stickerTabs.mixer' },
  { id: 'foto', labelKey: 'messenger.stickerTabs.foto' },
  { id: 'emojis', labelKey: 'messenger.stickerTabs.emojis' },
]

interface StickerEmojiPickerProps {
  reiter: PickerReiter
  onReiter: (reiter: PickerReiter) => void
  /** Nach der Rückkehr aus dem Tresor direkt die Tresor-Galerie öffnen. */
  startFotoTresor?: boolean
  onSticker: (sticker: StickerMotiv) => void
  onEmoji: (emoji: string) => void
  onSchliessen: () => void
}

function StickerVorschau({
  sticker,
  className = 'h-10 w-10',
}: {
  sticker: EigenSticker
  className?: string
}) {
  if (sticker.art === 'bild') {
    return (
      <img
        src={sticker.miniatur}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className={`${className} object-contain`}
      />
    )
  }
  if (sticker.miniatur) {
    return (
      <span
        aria-hidden="true"
        className={`${className} [&>svg]:h-full [&>svg]:w-full`}
        dangerouslySetInnerHTML={{ __html: sanitizeSvg(sticker.miniatur) }}
      />
    )
  }
  return (
    <span aria-hidden="true" className={`${className} grid place-items-center text-lg`}>
      {sticker.rezept.emojis.join('')}
    </span>
  )
}

export function StickerEmojiPicker({
  reiter,
  onReiter,
  startFotoTresor = false,
  onSticker,
  onEmoji,
  onSchliessen,
}: StickerEmojiPickerProps) {
  const { t } = useTranslation()
  const [mixerOffen, setMixerOffen] = useState(false)
  const [mixRezept, setMixRezept] = useState<MixRezept>({ ...STANDARD_REZEPT })
  const [fotoOffen, setFotoOffen] = useState(false)
  const [fotoStartTresor, setFotoStartTresor] = useState(false)
  const [stickerThema, setStickerThema] = useState<StickerThemeId>('emotes')
  const [packs, setPacks] = useState<StickerPack[]>([])
  const [eigene, setEigene] = useState<EigenSticker[]>([])
  const [laedt, setLaedt] = useState(true)
  const [aktivesPack, setAktivesPack] = useState<string>(SYSTEM_PACK)
  const [zielPack, setZielPack] = useState<string | null>(null)
  const [sendetId, setSendetId] = useState<string | null>(null)

  const systemSticker = useMemo(
    () => SYSTEM_STICKERS.filter((eintrag) => eintrag.theme === stickerThema),
    [stickerThema],
  )

  async function bestandNeuLaden() {
    const bestand = await ladeStickerBestand(t('messenger.stickerPacks.defaultName'))
    setPacks(bestand.packs)
    setEigene(bestand.sticker)
    setZielPack((vorher) =>
      vorher && bestand.packs.some((pack) => pack.id === vorher)
        ? vorher
        : (bestand.packs[0]?.id ?? null),
    )
    setAktivesPack((vorher) =>
      vorher !== SYSTEM_PACK && bestand.packs.some((pack) => pack.id === vorher)
        ? vorher
        : (bestand.packs[0]?.id ?? SYSTEM_PACK),
    )
    return bestand
  }

  useEffect(() => {
    let aktiv = true
    setLaedt(true)
    void ladeStickerBestand(t('messenger.stickerPacks.defaultName'))
      .then((bestand) => {
        if (!aktiv) return
        setPacks(bestand.packs)
        setEigene(bestand.sticker)
        const erstes = bestand.packs[0]?.id ?? null
        setZielPack(erstes)
        setAktivesPack(erstes ?? SYSTEM_PACK)
      })
      .catch((grund) => {
        still(grund, 'StickerEmojiPicker.bestand')
      })
      .finally(() => {
        if (aktiv) setLaedt(false)
      })
    return () => {
      aktiv = false
    }
  }, [t])

  useEffect(() => {
    if (!startFotoTresor) return
    let aktiv = true
    void packSicherStellen().finally(() => {
      if (!aktiv) return
      setFotoStartTresor(true)
      setFotoOffen(true)
    })
    return () => {
      aktiv = false
    }
  }, [startFotoTresor])

  async function packSicherStellen(): Promise<string | null> {
    if (zielPack) return zielPack
    try {
      const pack = await erstelleStickerPack(t('messenger.stickerPacks.defaultName'))
      await bestandNeuLaden()
      setZielPack(pack.id)
      setAktivesPack(pack.id)
      return pack.id
    } catch (grund) {
      still(grund, 'StickerEmojiPicker.pack')
      toast.error(t('messenger.stickerPacks.saveError'))
      return null
    }
  }

  async function neuesPack(): Promise<string | null> {
    const name = await prompt({
      title: t('messenger.stickerPacks.new'),
      message: t('messenger.stickerPacks.namePrompt'),
      placeholder: t('messenger.stickerPacks.namePlaceholder'),
      defaultValue: '',
    })
    if (name === null) return null
    try {
      const pack = await erstelleStickerPack(
        name.trim() || t('messenger.stickerPacks.defaultName'),
      )
      await bestandNeuLaden()
      setZielPack(pack.id)
      setAktivesPack(pack.id)
      return pack.id
    } catch (grund) {
      still(grund, 'StickerEmojiPicker.neuesPack')
      toast.error(t('messenger.stickerPacks.saveError'))
      return null
    }
  }

  async function packUmbenennen(pack: StickerPack) {
    const name = await prompt({
      title: t('messenger.stickerPacks.rename'),
      message: t('messenger.stickerPacks.namePrompt'),
      defaultValue: pack.name,
    })
    if (name === null) return
    try {
      await benenneStickerPack(pack.id, name.trim() || pack.name)
      await bestandNeuLaden()
    } catch (grund) {
      still(grund, 'StickerEmojiPicker.umbenennen')
      toast.error(t('messenger.stickerPacks.saveError'))
    }
  }

  async function packLoeschen(pack: StickerPack) {
    const ok = await confirm({
      title: t('messenger.stickerPacks.delete'),
      message: t('messenger.stickerPacks.deleteConfirm'),
      confirmText: t('messenger.stickerPacks.delete'),
      danger: true,
    })
    if (!ok) return
    try {
      await loescheStickerPack(pack.id)
      await bestandNeuLaden()
      setAktivesPack(SYSTEM_PACK)
    } catch (grund) {
      still(grund, 'StickerEmojiPicker.loeschen')
      toast.error(t('messenger.stickerPacks.saveError'))
    }
  }

  async function sendeEigenen(sticker: EigenSticker) {
    if (sendetId) return
    setSendetId(sticker.id)
    try {
      if (sticker.art === 'bild') {
        const bild = await ladeStickerBild(sticker.id)
        if (!bild) throw new Error('Bild fehlt')
        onSticker(bildStickerMotiv(sticker, bild))
      } else if (sticker.miniatur) {
        onSticker({
          id: sticker.id,
          label: stickerLabel(sticker),
          svg: sticker.miniatur,
          mix: true,
        })
      } else {
        const { baueSticker } = await import('@/services/stickerMixer')
        const motiv = baueSticker(sticker.rezept)
        if (!motiv) throw new Error('Mix fehlt')
        onSticker(motiv)
      }
    } catch (grund) {
      still(grund, 'StickerEmojiPicker.senden')
      toast.error(t('messenger.photoSticker.loadFailed'))
    } finally {
      setSendetId(null)
    }
  }

  async function eigeneLoeschen(sticker: EigenSticker) {
    const ok = await confirm({
      title: t('messenger.stickerPacks.deleteSticker'),
      message: t('messenger.stickerPacks.deleteStickerConfirm'),
      confirmText: t('messenger.stickerPacks.deleteSticker'),
      danger: true,
    })
    if (!ok) return
    try {
      await loescheSticker(sticker.id)
      await bestandNeuLaden()
    } catch (grund) {
      still(grund, 'StickerEmojiPicker.eigeneLoeschen')
      toast.error(t('messenger.stickerPacks.saveError'))
    }
  }

  async function mixFertig(rezept: MixRezept, miniatur: string, senden: boolean) {
    const packId = await packSicherStellen()
    if (!packId) throw new Error('Kein Pack')
    await speichereMixSticker(packId, rezept, miniatur)
    await bestandNeuLaden()
    setAktivesPack(packId)
    if (senden) {
      onSticker({
        id: rezeptId(rezept),
        label: rezept.emojis.join(''),
        svg: miniatur,
        mix: true,
      })
    }
  }

  async function fotoSpeichern(daten: BildStickerDaten, senden: boolean) {
    const packId = await packSicherStellen()
    if (!packId) throw new Error('Kein Pack')
    const eintrag: BildStickerEintrag = await speichereBildSticker(packId, daten)
    await bestandNeuLaden()
    setAktivesPack(packId)
    if (senden) onSticker(bildStickerMotiv(eintrag, daten.bild))
  }

  const aktivesPackDaten = packs.find((pack) => pack.id === aktivesPack)
  const aktiveSticker = eigene.filter((sticker) => sticker.packId === aktivesPack)

  return (
    <div className="mb-2 p-2.5 rounded-xl bg-surface-container border border-outline-variant/30 shadow-lg animate-slide-up">
      <div className="flex items-center justify-between gap-1 pb-1.5 mb-1.5 border-b border-outline-variant/20">
        <div className="flex items-center gap-1 overflow-x-auto msm-ohne-rollbalken">
          {REITER.map((eintrag) => (
            <Button
              key={eintrag.id}
              type="button"
              variant={reiter === eintrag.id ? 'primary' : 'ghost'}
              size="sm"
              fingerziel
              onClick={() => {
                if (eintrag.id !== 'mixer') setMixerOffen(false)
                if (eintrag.id !== 'foto') setFotoOffen(false)
                onReiter(eintrag.id)
              }}
              className="shrink-0 rounded-full px-2.5 text-xs"
            >
              {t(eintrag.labelKey)}
            </Button>
          ))}
        </div>
        <button
          type="button"
          onClick={onSchliessen}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-on-surface-variant hover:text-on-surface max-md:h-11 max-md:w-11"
          aria-label={t('common.close')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {reiter === 'stickers' && (
        <div className="space-y-1.5">
          <div className="msm-ohne-rollbalken flex gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setAktivesPack(SYSTEM_PACK)}
              aria-pressed={aktivesPack === SYSTEM_PACK}
              aria-label={t('messenger.stickerPacks.system')}
              className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 transition-colors ${
                aktivesPack === SYSTEM_PACK
                  ? 'border-primary bg-primary/10'
                  : 'border-outline-variant/40 hover:bg-surface-container-high'
              }`}
            >
              <img
                src={SYSTEM_STICKERS[0]?.bild}
                alt=""
                aria-hidden="true"
                className="h-7 w-7 object-contain"
              />
              <span className="text-xs font-medium">{t('messenger.stickerPacks.system')}</span>
            </button>

            {packs.map((pack) => {
              const cover = effektivesCover(pack, eigene)
              return (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setAktivesPack(pack.id)}
                  aria-pressed={aktivesPack === pack.id}
                  aria-label={pack.name}
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 transition-colors ${
                    aktivesPack === pack.id
                      ? 'border-primary bg-primary/10'
                      : 'border-outline-variant/40 hover:bg-surface-container-high'
                  }`}
                >
                  {cover ? (
                    <StickerVorschau sticker={cover} className="h-7 w-7" />
                  ) : (
                    <span className="grid h-7 w-7 place-items-center text-on-surface-variant">
                      <Folder className="h-4 w-4" aria-hidden="true" />
                    </span>
                  )}
                  <span className="max-w-24 truncate text-xs font-medium">{pack.name}</span>
                </button>
              )
            })}

            <Kurzinfo text={t('messenger.stickerPacks.add')} seite="anfang">
              <button
                type="button"
                onClick={() => void neuesPack()}
                aria-label={t('messenger.stickerPacks.add')}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dashed border-outline-variant/60 text-on-surface-variant hover:bg-surface-container-high"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
          </div>

          {aktivesPackDaten && (
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-semibold text-on-surface">
                {aktivesPackDaten.name}
              </span>
              <div className="flex items-center gap-0.5">
                <Kurzinfo text={t('messenger.stickerPacks.rename')} seite="ende">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    fingerziel
                    aria-label={t('messenger.stickerPacks.rename')}
                    onClick={() => void packUmbenennen(aktivesPackDaten)}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </Kurzinfo>
                <Kurzinfo text={t('messenger.stickerPacks.delete')} seite="ende">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    fingerziel
                    aria-label={t('messenger.stickerPacks.delete')}
                    onClick={() => void packLoeschen(aktivesPackDaten)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                </Kurzinfo>
              </div>
            </div>
          )}

          {laedt ? (
            <div className="flex h-16 items-center justify-center text-primary">
              <Spinner size="md" />
            </div>
          ) : aktivesPack === SYSTEM_PACK ? (
            <>
              <div
                className="msm-ohne-rollbalken flex gap-1.5 overflow-x-auto pb-1"
                role="group"
                aria-label={t('messenger.stickerThemes.label')}
              >
                {STICKER_THEMES.map((eintrag) => (
                  <Button
                    key={eintrag.id}
                    type="button"
                    variant={stickerThema === eintrag.id ? 'primary' : 'ghost'}
                    size="sm"
                    fingerziel
                    aria-pressed={stickerThema === eintrag.id}
                    onClick={() => setStickerThema(eintrag.id)}
                    className="shrink-0 rounded-full px-2.5 text-xs"
                  >
                    {t(eintrag.labelKey)}
                  </Button>
                ))}
              </div>
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 max-h-48 overflow-y-auto p-1.5">
                {systemSticker.map((stk) => {
                  const name = t(stk.nameKey)
                  return (
                    <Kurzinfo key={stk.id} text={name} seite="ende" aussen="min-w-0 w-full">
                      <button
                        type="button"
                        onClick={() => onSticker({ id: stk.id, label: name })}
                        aria-label={name}
                        className="w-full min-w-0 flex flex-col items-center justify-center p-1.5 rounded-xl hover:bg-surface-container-high transition-transform hover:scale-105"
                      >
                        <img
                          src={stk.bild}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          aria-hidden="true"
                          className="h-11 w-11 object-contain"
                        />
                      </button>
                    </Kurzinfo>
                  )
                })}
              </div>
            </>
          ) : aktiveSticker.length === 0 ? (
            <p className="px-1 py-3 text-xs text-on-surface-variant">
              {t('messenger.stickerPacks.empty')}
            </p>
          ) : (
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 max-h-48 overflow-y-auto p-1.5">
              {aktiveSticker.map((sticker) => (
                <div key={sticker.id} className="relative">
                  <button
                    type="button"
                    onClick={() => void sendeEigenen(sticker)}
                    aria-label={stickerLabel(sticker)}
                    className="flex w-full flex-col items-center justify-center rounded-xl p-1.5 transition-transform hover:scale-105 hover:bg-surface-container-high"
                  >
                    <StickerVorschau sticker={sticker} className="h-11 w-11" />
                    {sendetId === sticker.id && (
                      <span className="absolute inset-0 grid place-items-center rounded-xl bg-black/30 text-white">
                        <Spinner size="sm" />
                      </span>
                    )}
                  </button>
                  <Kurzinfo
                    text={t('messenger.stickerPacks.deleteSticker')}
                    seite="ende"
                    aussen="absolute -right-1 -top-1"
                  >
                    <button
                      type="button"
                      onClick={() => void eigeneLoeschen(sticker)}
                      aria-label={t('messenger.stickerPacks.deleteSticker')}
                      className="grid h-6 w-6 place-items-center rounded-full border border-outline-variant/40 bg-surface-container-highest text-on-surface-variant before:absolute before:-inset-3 before:content-[''] hover:text-status-destructive"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </Kurzinfo>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {reiter === 'mixer' && (
        <div className="flex flex-col items-start gap-2 p-2">
          <p className="text-xs text-on-surface-variant">{t('messenger.mixer.openHint')}</p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            fingerziel
            onClick={() => {
              void packSicherStellen().finally(() => setMixerOffen(true))
            }}
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
                packs={packs}
                zielPackId={zielPack}
                onZielPack={setZielPack}
                onNeuesPack={neuesPack}
                onMixFertig={mixFertig}
              />
            </Suspense>
          )}
        </div>
      )}

      {reiter === 'foto' && (
        <div className="flex flex-col items-start gap-2 p-2">
          <p className="text-xs text-on-surface-variant">{t('messenger.photoSticker.description')}</p>
          <Button
            type="button"
            variant="primary"
            size="sm"
            fingerziel
            onClick={() => {
              setFotoStartTresor(false)
              void packSicherStellen().finally(() => setFotoOffen(true))
            }}
          >
            {t('messenger.photoSticker.title')}
          </Button>
          {fotoOffen && (
            <Suspense
              fallback={
                <div className="flex h-16 items-center justify-center text-primary">
                  <Spinner size="md" />
                </div>
              }
            >
              <BildStickerEditor
                open={fotoOffen}
                onOpenChange={setFotoOffen}
                packs={packs}
                packId={zielPack}
                onPack={setZielPack}
                onNeuesPack={neuesPack}
                startTresor={fotoStartTresor}
                onSpeichern={fotoSpeichern}
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
