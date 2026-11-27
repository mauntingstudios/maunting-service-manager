/**
 * Einheitliche Vorschau für Tresor-Einträge (Dashboard, Dateiliste, Archiv, Papierkorb):
 * zeigt bei Medien die entschlüsselte Miniatur und sonst das passende Kategorie- oder
 * Markensymbol.
 */

import { CreditCard, Folder, Images, Landmark, Lock } from 'lucide-react'
import { BrandIcon } from '@maunting/ui'
import { cx } from '@/utils/classNames'
import { dateiIcon } from './TresorDateiAnsicht'
import { useMiniatur } from './tresorMiniaturen'
import { type VaultItem } from './vaultEintrag'

export interface TresorVorschauProps {
  item: VaultItem
  aktiv?: boolean
  groesse?: 'sm' | 'md' | 'lg'
  className?: string
}

const GROESSEN = {
  sm: { box: 'h-8 w-8 rounded-lg', icon: 'h-4 w-4' },
  md: { box: 'h-9 w-9 rounded-xl', icon: 'h-4 w-4' },
  lg: { box: 'h-11 w-11 rounded-xl', icon: 'h-5 w-5' },
} as const

export function TresorVorschau({ item, aktiv = true, groesse = 'md', className }: TresorVorschauProps) {
  const url = useMiniatur(item.datei?.miniatur, item.id, aktiv)
  const mass = GROESSEN[groesse]

  if (url) {
    return (
      <img
        src={url}
        alt=""
        draggable={false}
        className={cx(mass.box, 'shrink-0 object-cover border border-outline-variant/20', className)}
      />
    )
  }

  if (item.category === 'ordner') {
    return (
      <span className={cx(mass.box, 'flex shrink-0 items-center justify-center border border-outline-variant/20 bg-surface-container text-primary', className)}>
        <Folder className={mass.icon} aria-hidden="true" />
      </span>
    )
  }

  if (item.category === 'album') {
    return (
      <span className={cx(mass.box, 'flex shrink-0 items-center justify-center border border-outline-variant/20 bg-surface-container text-primary', className)}>
        <Images className={mass.icon} aria-hidden="true" />
      </span>
    )
  }

  if (item.category === 'secure_note') {
    return (
      <span className={cx(mass.box, 'flex shrink-0 items-center justify-center border border-outline-variant/20 bg-surface-container text-primary', className)}>
        <Lock className={mass.icon} aria-hidden="true" />
      </span>
    )
  }

  if (item.zahlung) {
    const ZahlungSymbol = item.zahlung.art === 'konto' ? Landmark : CreditCard
    return (
      <span className={cx(mass.box, 'flex shrink-0 items-center justify-center border border-outline-variant/20 bg-surface-container text-primary', className)}>
        <ZahlungSymbol className={mass.icon} aria-hidden="true" />
      </span>
    )
  }

  if (item.category === 'datei' || item.datei) {
    const DateiTypIcon = dateiIcon(item.datei?.typ ?? '', item.service)
    return (
      <span className={cx(mass.box, 'flex shrink-0 items-center justify-center border border-outline-variant/20 bg-surface-container text-on-surface-variant', className)}>
        <DateiTypIcon className={mass.icon} aria-hidden="true" />
      </span>
    )
  }

  return <BrandIcon name={item.service} domainOrUrl={item.url} size={groesse === 'lg' ? 'lg' : 'md'} />
}
