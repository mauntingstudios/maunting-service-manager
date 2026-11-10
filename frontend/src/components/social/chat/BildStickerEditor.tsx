/**
 * Foto-Sticker bauen: Kamera, lokale Galerie oder Tresor-Galerie.
 *
 * Kamera und lokale Galerie nutzen denselben Weg wie der Chat
 * (`CameraSnapshotModal`, `bildAusDatei`). Die Tresor-Galerie kommt aus
 * `TresorBildWaehler` und wird erst geladen, wenn jemand sie öffnet. Text und
 * weißer Rand werden ins Bild gerechnet; gespeichert wird eine kleine
 * Vorschau und das Vollbild getrennt.
 */

import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, Image as ImageIcon, LockKeyhole } from 'lucide-react'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Spinner,
  type DropdownOption,
} from '@maunting/ui'
import { CameraSnapshotModal } from '@/components/social/CameraSnapshotModal'
import { useVaultStore } from '@/desktop/vault/vaultStore'
import { bildAusDatei } from '@/lib/imageCompression'
import { still } from '@/lib/still'
import { istDesktopApp } from '@/services/appUmgebung'
import {
  BILD_STICKER_STILE,
  BILD_STICKER_TEXT_MAX,
  erstelleBildSticker,
} from '@/services/bildSticker'
import type { BildStickerStil, StickerPack } from '@/services/stickerPacks'

const TresorBildWaehler = lazy(() =>
  import('./TresorBildWaehler').then((modul) => ({ default: modul.TresorBildWaehler })),
)

const NEUES_PACK = '__neu__'

export interface BildStickerDaten {
  bild: string
  miniatur: string
  text: string
  stil: BildStickerStil
}

export interface BildStickerEditorProps {
  open: boolean
  onOpenChange: (offen: boolean) => void
  packs: StickerPack[]
  packId: string | null
  onPack: (id: string) => void
  onNeuesPack: () => Promise<string | null>
  /** Nach der Rückkehr aus dem Tresor direkt dessen Galerie zeigen. */
  startTresor?: boolean
  onSpeichern: (daten: BildStickerDaten, senden: boolean) => Promise<void>
}

export function BildStickerEditor({
  open,
  onOpenChange,
  packs,
  packId,
  onPack,
  onNeuesPack,
  startTresor = false,
  onSpeichern,
}: BildStickerEditorProps) {
  const { t } = useTranslation()
  const dateiRef = useRef<HTMLInputElement>(null)
  const vaultUnlocked = useVaultStore((s) => s.isUnlocked)
  // Die Tresor-Galerie gibt es nur in der Desktop-App; dort liegt die Seite
  // mit der Smartcard. Web und Pontis zeigen die Quelle gar nicht erst.
  const tresorVerfuegbar = istDesktopApp()
  const [bild, setBild] = useState<string | null>(null)
  const [quelle, setQuelle] = useState<'kamera' | 'lokal' | 'tresor' | null>(
    startTresor && tresorVerfuegbar ? 'tresor' : null,
  )
  const [text, setText] = useState('')
  const [stil, setStil] = useState<BildStickerStil>('fett')
  const [vorschau, setVorschau] = useState<BildStickerDaten | null>(null)
  const [erzeugtGerade, setErzeugtGerade] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [arbeitet, setArbeitet] = useState(false)
  const [kameraOffen, setKameraOffen] = useState(false)
  const [tresorOffen, setTresorOffen] = useState(Boolean(startTresor) && tresorVerfuegbar)

  /*
   * Der Tresor gibt seine Bilder nur im entsperrten Zustand her. Sperrt er
   * während des Bearbeitens (Fensterwechsel, Frist), fällt auch das bereits
   * gewählte Bild weg; sonst bliebe ein Tresorbild nach dem Sperren stehen.
   */
  useEffect(() => {
    if (quelle !== 'tresor' || vaultUnlocked || !bild) return
    setBild(null)
    setVorschau(null)
    setQuelle(null)
    setFehler(t('messenger.photoSticker.vaultLockedAt'))
  }, [quelle, vaultUnlocked, bild, t])

  useEffect(() => {
    if (!bild) {
      setVorschau(null)
      return
    }
    let aktiv = true
    setErzeugtGerade(true)
    setFehler(null)
    const timer = setTimeout(() => {
      void erstelleBildSticker(bild, text, stil)
        .then((ergebnis) => {
          if (!aktiv) return
          setVorschau({ ...ergebnis, text: text.trim(), stil })
          setErzeugtGerade(false)
        })
        .catch((grund) => {
          still(grund, 'BildStickerEditor.vorschau')
          if (!aktiv) return
          setVorschau(null)
          setErzeugtGerade(false)
          setFehler(t('messenger.photoSticker.loadFailed'))
        })
    }, 180)
    return () => {
      aktiv = false
      clearTimeout(timer)
    }
  }, [bild, text, stil, t])

  async function lokaleDatei(event: React.ChangeEvent<HTMLInputElement>) {
    const datei = event.target.files?.[0]
    event.target.value = ''
    if (!datei) return
    setFehler(null)
    try {
      const gelesen = await bildAusDatei(datei)
      setBild(gelesen.dataUrl)
      setQuelle('lokal')
      setTresorOffen(false)
    } catch (grund) {
      still(grund, 'BildStickerEditor.datei')
      setFehler(t('messenger.photoSticker.notAnImage'))
    }
  }

  async function packWaehlen(wert: string) {
    if (wert === NEUES_PACK) {
      const neu = await onNeuesPack()
      if (neu) onPack(neu)
      return
    }
    onPack(wert)
  }

  async function abschliessen(senden: boolean) {
    if (!vorschau || !packId || arbeitet) return
    setArbeitet(true)
    setFehler(null)
    try {
      await onSpeichern({ ...vorschau, text: text.trim(), stil }, senden)
      onOpenChange(false)
    } catch (grund) {
      still(grund, 'BildStickerEditor.speichern')
      setFehler(t('messenger.photoSticker.saveFailed'))
    } finally {
      setArbeitet(false)
    }
  }

  const packOptionen: DropdownOption[] = [
    ...packs.map((pack) => ({ value: pack.id, label: pack.name })),
    { value: NEUES_PACK, label: t('messenger.stickerPacks.new') },
  ]
  const bereit = Boolean(vorschau && packId && !arbeitet)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          size="voll"
          aria-labelledby="foto-sticker-titel"
          aria-describedby="foto-sticker-beschreibung"
          className="max-sm:pb-[var(--msm-unten-sicher)] sm:max-w-xl sm:rounded-2xl sm:border sm:border-outline-variant/30"
        >
          <div className="mx-auto flex h-full w-full max-w-xl flex-col">
            <DialogHeader className="pr-14">
              <DialogTitle id="foto-sticker-titel">
                {t('messenger.photoSticker.title')}
              </DialogTitle>
              <DialogDescription id="foto-sticker-beschreibung">
                {t('messenger.photoSticker.description')}
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {tresorOffen ? (
                <Suspense
                  fallback={
                    <div className="flex h-24 items-center justify-center text-primary">
                      <Spinner size="md" />
                    </div>
                  }
                >
                  <TresorBildWaehler
                    onWaehlen={(daten) => {
                      setBild(daten)
                      setQuelle('tresor')
                      setTresorOffen(false)
                    }}
                    onAbbrechen={() => setTresorOffen(false)}
                  />
                </Suspense>
              ) : (
                <>
                  <section className="space-y-2">
                    <h4 className="text-xs font-medium text-on-surface-variant">
                      {t('messenger.photoSticker.sourceTitle')}
                    </h4>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <Button
                        type="button"
                        variant="secondary"
                        fingerziel
                        onClick={() => setKameraOffen(true)}
                        className="justify-start gap-2"
                      >
                        <Camera className="h-4 w-4" aria-hidden="true" />
                        {t('messenger.photoSticker.camera')}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        fingerziel
                        onClick={() => dateiRef.current?.click()}
                        className="justify-start gap-2"
                      >
                        <ImageIcon className="h-4 w-4" aria-hidden="true" />
                        {t('messenger.photoSticker.gallery')}
                      </Button>
                      {tresorVerfuegbar && (
                        <Button
                          type="button"
                          variant="secondary"
                          fingerziel
                          onClick={() => setTresorOffen(true)}
                          className="justify-start gap-2"
                        >
                          <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                          {t('messenger.photoSticker.vault')}
                        </Button>
                      )}
                    </div>
                    <input
                      ref={dateiRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => void lokaleDatei(event)}
                    />
                  </section>

                  {bild ? (
                    <div className="space-y-4">
                      <div className="relative mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-3xl bg-surface-container/60">
                        <img
                          src={vorschau?.bild ?? bild}
                          alt=""
                          className="h-full w-full object-contain"
                          draggable={false}
                        />
                        {erzeugtGerade && (
                          <span className="absolute inset-0 grid place-items-center bg-black/25 text-white">
                            <Spinner size="md" />
                          </span>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        fingerziel
                        onClick={() => dateiRef.current?.click()}
                      >
                        {t('messenger.photoSticker.change')}
                      </Button>

                      <div className="space-y-2">
                        <label htmlFor="foto-sticker-text" className="text-xs font-medium text-on-surface-variant">
                          {t('messenger.photoSticker.textLabel')}
                        </label>
                        <Input
                          id="foto-sticker-text"
                          value={text}
                          maxLength={BILD_STICKER_TEXT_MAX}
                          placeholder={t('messenger.photoSticker.textPlaceholder')}
                          onChange={(event) => setText(event.target.value)}
                        />
                      </div>

                      <div className="space-y-2">
                        <h4 className="text-xs font-medium text-on-surface-variant">
                          {t('messenger.photoSticker.styleLabel')}
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {BILD_STICKER_STILE.map((eintrag) => (
                            <Button
                              key={eintrag.id}
                              type="button"
                              variant={stil === eintrag.id ? 'primary' : 'ghost'}
                              size="sm"
                              fingerziel
                              aria-pressed={stil === eintrag.id}
                              onClick={() => setStil(eintrag.id)}
                              className="rounded-full px-3"
                            >
                              {t(eintrag.labelKey)}
                            </Button>
                          ))}
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h4 className="text-xs font-medium text-on-surface-variant">
                          {t('messenger.photoSticker.packLabel')}
                        </h4>
                        <Dropdown
                          value={packId}
                          onChange={(wert) => void packWaehlen(wert)}
                          options={packOptionen}
                          placeholder={t('messenger.stickerPacks.defaultName')}
                          aria-label={t('messenger.photoSticker.packLabel')}
                          disabled={arbeitet}
                        />
                      </div>

                      {!packId && (
                        <p className="text-xs text-on-surface-variant">
                          {t('messenger.photoSticker.packRequired')}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-on-surface-variant">
                      {t('messenger.photoSticker.noImage')}
                    </p>
                  )}

                  {fehler && (
                    <p role="alert" className="text-xs text-status-destructive">
                      {fehler}
                    </p>
                  )}
                </>
              )}
            </div>

            <DialogFooter className="flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                fingerziel
                onClick={() => onOpenChange(false)}
                disabled={arbeitet}
              >
                {t('common.cancel')}
              </Button>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  fingerziel
                  disabled={!bereit}
                  onClick={() => void abschliessen(false)}
                >
                  {t('messenger.photoSticker.save')}
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  fingerziel
                  disabled={!bereit}
                  onClick={() => void abschliessen(true)}
                >
                  {t('messenger.photoSticker.send')}
                </Button>
              </div>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <CameraSnapshotModal
        open={kameraOffen}
        onOpenChange={setKameraOffen}
        onCapture={(daten) => {
          setBild(daten)
          setQuelle('kamera')
          setKameraOffen(false)
        }}
        titel={t('messenger.photoSticker.camera')}
        bestaetigen={t('messenger.photoSticker.usePhoto')}
        mitStempel={false}
      />
    </>
  )
}
