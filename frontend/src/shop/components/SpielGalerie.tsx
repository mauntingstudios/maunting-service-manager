import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { apiUrl, shopCatalogApi, type ShopGalleryItem } from '@/api/shop'
import { still } from '@/lib/still'
import { SpielArtwork } from './SpielArtwork'
import type { ShopSpiel } from '../typen'

interface SpielGalerieProps {
  spiel: ShopSpiel
  priority?: boolean
  className?: string
}

export function SpielGalerie({
  spiel,
  priority = false,
  className = '',
}: SpielGalerieProps) {
  const { t } = useTranslation()
  const [items, setItems] = useState<ShopGalleryItem[]>([])
  const [laden, setLaden] = useState(true)
  const [aktivId, setAktivId] = useState<string | null>(null)
  const [fehlerIds, setFehlerIds] = useState<Record<string, true>>({})

  useEffect(() => {
    let abgebrochen = false
    setLaden(true)
    setItems([])
    setAktivId(null)
    setFehlerIds({})

    if (typeof shopCatalogApi?.getGallery !== 'function') {
      setLaden(false)
      return () => {
        abgebrochen = true
      }
    }

    shopCatalogApi
      .getGallery(spiel.id)
      .then((res) => {
        if (abgebrochen) return
        setItems(res)
        const primaer = res.find((e) => e.is_primary) ?? res[0]
        setAktivId(primaer ? primaer.id : null)
      })
      .catch((err: unknown) => {
        if (!abgebrochen) {
          still(err, 'shop.galerie.laden')
        }
      })
      .finally(() => {
        if (!abgebrochen) setLaden(false)
      })

    return () => {
      abgebrochen = true
    }
  }, [spiel.id])

  const sichtbare = useMemo(
    () => items.filter((eintrag) => !fehlerIds[eintrag.id]),
    [items, fehlerIds],
  )

  const aktivIndex = useMemo(() => {
    if (sichtbare.length === 0) return 0
    const idx = sichtbare.findIndex((e) => e.id === aktivId)
    return idx >= 0 ? idx : 0
  }, [sichtbare, aktivId])

  if (laden || sichtbare.length === 0) {
    return <SpielArtwork spiel={spiel} priority={priority} className={className} />
  }

  const aktuellesBild = sichtbare[aktivIndex]
  const hatMehrere = sichtbare.length > 1

  const vor = () => {
    if (!hatMehrere) return
    const nextIdx = (aktivIndex + 1) % sichtbare.length
    setAktivId(sichtbare[nextIdx].id)
  }

  const zurueck = () => {
    if (!hatMehrere) return
    const prevIdx = (aktivIndex - 1 + sichtbare.length) % sichtbare.length
    setAktivId(sichtbare[prevIdx].id)
  }

  const beiTaste = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!hatMehrere) return
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      vor()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      zurueck()
    }
  }

  const bildAlsDefektMarkieren = (id: string) => {
    setFehlerIds((alt) => ({ ...alt, [id]: true }))
  }

  const heroPrioritaet = priority
    ? ({ fetchpriority: 'high' } as Record<string, string>)
    : ({ loading: 'lazy' } as const)

  return (
    <div
      className={`overflow-hidden bg-surface-container-low ${className}`}
      onKeyDown={beiTaste}
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-surface-container">
        <img
          key={aktuellesBild.id}
          src={apiUrl(aktuellesBild.url)}
          alt={t('shop.galerie.bildAlt', {
            name: spiel.name,
            index: aktivIndex + 1,
          })}
          width={960}
          height={540}
          {...heroPrioritaet}
          className="block h-full w-full object-cover"
          onError={() => bildAlsDefektMarkieren(aktuellesBild.id)}
        />
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent"
          aria-hidden="true"
        />

        {hatMehrere && (
          <>
            <button
              type="button"
              onClick={zurueck}
              aria-label={t('shop.galerie.zurueck')}
              className="absolute left-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-outline-variant/40 bg-surface-container-high/85 text-on-surface backdrop-blur-md shadow-sm transition-all hover:bg-surface-container-high hover:text-primary active:scale-95"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={vor}
              aria-label={t('shop.galerie.weiter')}
              className="absolute right-3 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-outline-variant/40 bg-surface-container-high/85 text-on-surface backdrop-blur-md shadow-sm transition-all hover:bg-surface-container-high hover:text-primary active:scale-95"
            >
              <ChevronRight className="h-5 w-5" aria-hidden="true" />
            </button>
            <div className="pointer-events-none absolute bottom-3 right-3 rounded-full border border-outline-variant/40 bg-surface-container-high/85 px-2.5 py-0.5 text-xs font-medium text-on-surface backdrop-blur-md">
              {aktivIndex + 1} / {sichtbare.length}
            </div>
          </>
        )}
      </div>

      {hatMehrere && (
        <div
          className="flex gap-2 overflow-x-auto border-t border-outline-variant/25 bg-surface-container/60 p-2.5"
          role="region"
          aria-label={t('shop.galerie.vorschauLeiste')}
        >
          {sichtbare.map((eintrag, index) => {
            const ausgewaehlt = eintrag.id === aktuellesBild.id
            return (
              <button
                key={eintrag.id}
                type="button"
                onClick={() => setAktivId(eintrag.id)}
                aria-label={t('shop.galerie.bildAuswaehlen', {
                  index: index + 1,
                })}
                aria-current={ausgewaehlt ? 'true' : undefined}
                className={`relative aspect-[16/9] w-24 shrink-0 overflow-hidden rounded-lg border transition-all ${
                  ausgewaehlt
                    ? 'border-primary ring-2 ring-primary/40 opacity-100'
                    : 'border-outline-variant/30 opacity-70 hover:opacity-100'
                }`}
              >
                <img
                  src={apiUrl(eintrag.url)}
                  alt=""
                  width={160}
                  height={90}
                  loading="lazy"
                  decoding="async"
                  className="block h-full w-full object-cover"
                  onError={() => bildAlsDefektMarkieren(eintrag.id)}
                />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
