import { useEffect, useMemo, useState } from 'react'
import { apiUrl } from '@/config/api'
import { still } from '@/lib/still'
import {
  shopCatalogApi,
  type ShopCatalogAddon,
  type ShopCatalogPlan,
} from '@/api/shop'
import type { ShopSpiel } from './typen'

export interface ShopTarif {
  plan: ShopCatalogPlan
  spiel: ShopSpiel
}

export interface ShopKatalog {
  spiele: ShopSpiel[]
  addons: ShopCatalogAddon[]
  tarifeFuer: (gameType: string) => ShopTarif[]
  addonFuer: (addonId: number) => ShopCatalogAddon | null
  loading: boolean
  fehler: boolean
}

function motivFuerKategorie(kategorie: string): string {
  const k = (kategorie || '').toLowerCase()
  if (k.includes('survival')) return 'wald'
  if (k.includes('sandbox')) return 'insel'
  if (k.includes('simulation')) return 'fabrik'
  if (k.includes('pvp')) return 'wueste'
  return 'weltraum'
}

function stufen(
  inklusive: number | null,
  maximum: number | null,
  schritt: number | null,
  fallback: number[],
): number[] {
  const start = inklusive ?? fallback[0]
  const ende = maximum ?? Math.max(start, fallback[fallback.length - 1] ?? start)
  const schrittweite = schritt && schritt > 0 ? schritt : 1
  const werte: number[] = []
  for (let wert = start; wert <= ende && werte.length < 12; wert += schrittweite) {
    werte.push(wert)
  }
  if (werte.length === 0) werte.push(start)
  return werte
}

function spielAusPlan(plan: ShopCatalogPlan): ShopSpiel {
  const ramIncludedGb =
    plan.ram_included_mb === null ? null : Math.max(1, Math.round(plan.ram_included_mb / 1024))
  const ramMaxGb =
    plan.ram_max_mb === null ? null : Math.max(1, Math.round(plan.ram_max_mb / 1024))
  const ramStepGb =
    plan.ram_step_mb === null ? null : Math.max(1, Math.round(plan.ram_step_mb / 1024))
  const ramStufen = stufen(ramIncludedGb, ramMaxGb, ramStepGb, [4, 8, 16])
  const cpuStufen = stufen(plan.cpu_included, plan.cpu_max, plan.cpu_step, [1, 2, 4])
  const slotStufen = stufen(plan.slots_included, plan.slots_max, plan.slots_step, [4, 8, 16])
  const text = plan.game_description || plan.description || plan.name
  const tags: string[] = []
  if (plan.supports_mods) tags.push('Mods')
  if (plan.supports_workshop) tags.push('Workshop')

  return {
    id: plan.game_type,
    name: plan.game_name || plan.game_type,
    game: plan.game_type,
    category: plan.game_category || 'Server',
    beschreibung: { de: text, en: text },
    tags,
    unterstuetztMods: plan.supports_mods,
    unterstuetztWorkshop: plan.supports_workshop,
    motiv: motivFuerKategorie(plan.game_category),
    bildUrl: plan.artwork.url ? apiUrl(plan.artwork.url) : undefined,
    grundpreisCent: plan.price_cents,
    ramStufenGb: ramStufen,
    standardRamGb: ramIncludedGb ?? ramStufen[0],
    preisProGbCent: plan.price_per_ram_step_cents,
    cpuStufen,
    standardCpu: plan.cpu_included ?? cpuStufen[0],
    preisProKernCent: plan.price_per_cpu_step_cents,
    slotStufen,
    standardSlots: plan.slots_included ?? slotStufen[0],
    preisProSlotCent: plan.price_per_slot_step_cents,
    kiZugangCent: 0,
  }
}

function ausPlans(plans: ShopCatalogPlan[]): Pick<ShopKatalog, 'spiele' | 'tarifeFuer'> {
  const nachSpiel = new Map<string, ShopCatalogPlan[]>()
  for (const plan of plans) {
    const liste = nachSpiel.get(plan.game_type) ?? []
    liste.push(plan)
    nachSpiel.set(plan.game_type, liste)
  }
  const tarife = new Map<string, ShopTarif[]>()
  for (const [gameType, gamePlans] of nachSpiel) {
    const sortiert = [...gamePlans].sort(
      (a, b) => a.price_cents - b.price_cents || a.name.localeCompare(b.name),
    )
    tarife.set(
      gameType,
      sortiert.map((plan) => ({ plan, spiel: spielAusPlan(plan) })),
    )
  }
  return {
    spiele: [...tarife.values()].map((liste) => liste[0].spiel),
    tarifeFuer: (gameType) => tarife.get(gameType) ?? [],
  }
}

export function useShopKatalog(): ShopKatalog {
  const [plans, setPlans] = useState<ShopCatalogPlan[]>([])
  const [addons, setAddons] = useState<ShopCatalogAddon[]>([])
  const [loading, setLoading] = useState(true)
  const [fehler, setFehler] = useState(false)

  useEffect(() => {
    let aktiv = true
    const plansPromise = shopCatalogApi.getCatalog()
    const addonsPromise = shopCatalogApi.listAddons
      ? shopCatalogApi.listAddons().catch((err: unknown) => {
          still(err, 'useShopKatalog.addons')
          return [] as ShopCatalogAddon[]
        })
      : Promise.resolve([] as ShopCatalogAddon[])

    void Promise.all([plansPromise, addonsPromise])
      .then(([planRows, addonRows]) => {
        if (!aktiv) return
        setPlans(planRows)
        setAddons(addonRows)
        setFehler(false)
        setLoading(false)
      })
      .catch((err: unknown) => {
        still(err, 'useShopKatalog.catalog')
        if (!aktiv) return
        setPlans([])
        setAddons([])
        setFehler(true)
        setLoading(false)
      })

    return () => {
      aktiv = false
    }
  }, [])

  return useMemo(() => {
    const katalog = ausPlans(plans)
    return {
      ...katalog,
      addons,
      addonFuer: (addonId: number) => addons.find((item) => item.id === addonId) ?? null,
      loading,
      fehler,
    }
  }, [plans, addons, loading, fehler])
}
