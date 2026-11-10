/**
 * Bilder aus dem Tresor für den Foto-Sticker.
 *
 * Es gibt keine zweite Tresor-Logik: Entsperren, Miniaturen und das Lesen des
 * Originals kommen aus `vaultStore`, `tresorMiniaturen` und `tresorDateien`.
 * Der Tresor muss vor der Auswahl entsperrt sein; der Schlüssel bleibt im
 * Speicher und das ausgewählte Bild wird lokal weiterverarbeitet.
 */

import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Spinner } from '@maunting/ui'

import { still } from '@/lib/still'
import { tresorRoute, zurueckZumSticker } from '@/services/stickerTresor'
import { useVaultStore } from '@/desktop/vault/vaultStore'
import { blobLesen } from '@/desktop/vault/tresorDateien'
import { useMiniatur } from '@/desktop/vault/tresorMiniaturen'
import { sichtbareEintraege } from '@/desktop/vault/tresorOrdner'
import type { VaultItem } from '@/desktop/vault/vaultEintrag'
import { blobAlsDatenUrl } from '@/services/bildSticker'

interface TresorBildWaehlerProps {
  onWaehlen: (bild: string) => void
  onAbbrechen: () => void
}

function istBild(item: VaultItem): boolean {
  return item.category === 'datei' && !!item.datei?.typ?.startsWith('image/')
}

function TresorBildKachel({
  item,
  userKey,
  gesperrt,
  onWaehlen,
}: {
  item: VaultItem
  userKey: CryptoKey
  gesperrt: boolean
  onWaehlen: (item: VaultItem) => void
}) {
  const url = useMiniatur(item.datei?.miniatur, item.id, true, userKey)
  return (
    <button
      type="button"
      disabled={gesperrt}
      onClick={() => onWaehlen(item)}
      aria-label={item.service}
      className="relative aspect-square overflow-hidden rounded-xl border border-outline-variant/40 bg-surface-container-low transition-transform hover:scale-[1.02] disabled:opacity-50"
    >
      {url ? (
        <img
          src={url}
          alt=""
          aria-hidden="true"
          className="h-full w-full object-cover"
          draggable={false}
        />
      ) : (
        <span className="grid h-full w-full place-items-center text-primary">
          <Spinner size="sm" />
        </span>
      )}
    </button>
  )
}

export function TresorBildWaehler({ onWaehlen, onAbbrechen }: TresorBildWaehlerProps) {
  const { t } = useTranslation()
  const isInitialized = useVaultStore((s) => s.isInitialized)
  const isUnlocked = useVaultStore((s) => s.isUnlocked)
  const items = useVaultStore((s) => s.items)
  const userKey = useVaultStore((s) => s.userKey)
  const navigate = useNavigate()
  const location = useLocation()

  const [fehler, setFehler] = useState<string | null>(null)
  const [ladenId, setLadenId] = useState<string | null>(null)

  const bilder = useMemo(
    () => sichtbareEintraege(items).filter(istBild),
    [items],
  )

  /**
   * Der Tresor wird auf seiner Seite entsperrt: Dort steht die Smartcard mit
   * dem Master-Passwort, und dort greifen Biometrie und die automatische
   * Sperre. Der Messenger merkt sich nur den Rückweg.
   */
  function tresorOeffnen() {
    const zurueck = zurueckZumSticker(location.pathname, location.search)
    navigate(tresorRoute(zurueck))
  }

  async function waehlen(item: VaultItem) {
    const datei = item.datei
    if (!datei || !userKey || ladenId) return
    setLadenId(item.id)
    setFehler(null)
    try {
      const blob = await blobLesen(datei.original, item.id, userKey, datei.typ)
      const bild = await blobAlsDatenUrl(blob)
      onWaehlen(bild)
    } catch (grund) {
      still(grund, 'TresorBildWaehler')
      setFehler(t('messenger.photoSticker.vaultLoadFailed'))
    } finally {
      setLadenId(null)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-on-surface">
          {t('messenger.photoSticker.vaultTitle')}
        </h4>
        <Button type="button" variant="ghost" size="sm" fingerziel onClick={onAbbrechen}>
          {t('messenger.photoSticker.changeSource')}
        </Button>
      </div>

      {!isInitialized && (
        <p className="text-xs text-on-surface-variant">
          {t('messenger.photoSticker.vaultNotReady')}
        </p>
      )}

      {isInitialized && !isUnlocked && (
        <div className="space-y-2">
          <p className="text-xs text-on-surface-variant">
            {t('messenger.photoSticker.vaultOpenHint')}
          </p>
          <Button type="button" size="sm" fingerziel onClick={tresorOeffnen}>
            {t('messenger.photoSticker.vaultOpen')}
          </Button>
          {fehler && (
            <p role="alert" className="text-xs text-status-destructive">
              {fehler}
            </p>
          )}
        </div>
      )}

      {isInitialized && isUnlocked && (
        <>
          {bilder.length === 0 ? (
            <p className="text-xs text-on-surface-variant">
              {t('messenger.photoSticker.vaultEmpty')}
            </p>
          ) : (
            <div className="grid max-h-64 grid-cols-4 gap-2 overflow-y-auto p-0.5">
              {bilder.map((item) => (
                <TresorBildKachel
                  key={item.id}
                  item={item}
                  userKey={userKey!}
                  gesperrt={Boolean(ladenId)}
                  onWaehlen={waehlen}
                />
              ))}
            </div>
          )}
          {fehler && (
            <p role="alert" className="text-xs text-status-destructive">
              {fehler}
            </p>
          )}
          {ladenId && (
            <div className="flex items-center gap-2 text-xs text-on-surface-variant">
              <Spinner size="sm" />
              {t('messenger.photoSticker.loadingVault')}
            </div>
          )}
        </>
      )}
    </div>
  )
}
