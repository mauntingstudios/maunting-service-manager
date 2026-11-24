import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Gamepad2,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
} from 'lucide-react'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Input,
  Spinner,
  Switch,
  TabBar,
  Zustandsflaeche,
  type TabDef,
} from '@maunting/ui'
import { api } from '@/api/client'
import {
  apiUrl,
  shopAdminApi,
  shopCatalogApi,
  type ShopArtworkMode,
  type ShopGalleryItem,
  type ShopPlan,
  type ShopPlanWrite,
} from '@/api/shop'
import { useHasPermission } from '@/hooks/useHasPermission'
import { still } from '@/lib/still'
import { formatCpuLabel, formatEuro } from '@/shop/preis'
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import type { GameInfo } from '@/types'

interface Draft {
  gameType: string
  name: string
  priceEuro: string
  ramIncludedGb: string
  ramMaxGb: string
  pricePerRamGbEuro: string
  cpuIncluded: string
  cpuMax: string
  pricePerCpuEuro: string
  slotsIncluded: string
  slotsMax: string
  pricePerSlotEuro: string
  taxRate: string
  lifetimeEuro: string
  allowGameSwitch: boolean
  artworkMode: ShopArtworkMode
  active: boolean
  isFeatured: boolean
  isBestseller: boolean
  isNew: boolean
  pinnedInHero: boolean
  promoHighlightText: string
}

type DialogTabId = 'basis' | 'ressourcen' | 'bilder'
type AnsichtModus = 'regal' | 'liste'
type StatusFilter = 'alle' | 'aktiv' | 'inaktiv'

type Ressource = {
  id: 'ram' | 'cpu' | 'slots'
  includedKey: string
  maxKey: string
  preisKey: string
  includedFeld: 'ramIncludedGb' | 'cpuIncluded' | 'slotsIncluded'
  maxFeld: 'ramMaxGb' | 'cpuMax' | 'slotsMax'
  preisFeld: 'pricePerRamGbEuro' | 'pricePerCpuEuro' | 'pricePerSlotEuro'
}

const RESSOURCEN: Ressource[] = [
  {
    id: 'ram',
    includedKey: 'settings.shop.plans.ramIncluded',
    maxKey: 'settings.shop.plans.ramMax',
    preisKey: 'settings.shop.plans.preisRam',
    includedFeld: 'ramIncludedGb',
    maxFeld: 'ramMaxGb',
    preisFeld: 'pricePerRamGbEuro',
  },
  {
    id: 'cpu',
    includedKey: 'settings.shop.plans.cpuIncluded',
    maxKey: 'settings.shop.plans.cpuMax',
    preisKey: 'settings.shop.plans.preisCpu',
    includedFeld: 'cpuIncluded',
    maxFeld: 'cpuMax',
    preisFeld: 'pricePerCpuEuro',
  },
  {
    id: 'slots',
    includedKey: 'settings.shop.plans.slotsIncluded',
    maxKey: 'settings.shop.plans.slotsMax',
    preisKey: 'settings.shop.plans.preisSlots',
    includedFeld: 'slotsIncluded',
    maxFeld: 'slotsMax',
    preisFeld: 'pricePerSlotEuro',
  },
]

const DIALOG_TABS: TabDef<DialogTabId>[] = [
  { id: 'basis', labelKey: 'settings.shop.plans.tabBasis' },
  { id: 'ressourcen', labelKey: 'settings.shop.plans.tabRessourcen' },
  { id: 'bilder', labelKey: 'settings.shop.plans.tabBilder' },
]

const LEER: Draft = {
  gameType: '',
  name: '',
  priceEuro: '6.99',
  ramIncludedGb: '4',
  ramMaxGb: '16',
  pricePerRamGbEuro: '0.90',
  cpuIncluded: '150',
  cpuMax: '400',
  pricePerCpuEuro: '1.50',
  slotsIncluded: '8',
  slotsMax: '32',
  pricePerSlotEuro: '0.30',
  taxRate: '19',
  lifetimeEuro: '',
  allowGameSwitch: true,
  artworkMode: 'steam',
  active: true,
  isFeatured: false,
  isBestseller: false,
  isNew: false,
  pinnedInHero: false,
  promoHighlightText: '',
}

function zahl(wert: string): number | null {
  const sauber = wert.trim().replace(',', '.')
  if (!sauber) return null
  const parsed = Number(sauber)
  return Number.isFinite(parsed) ? parsed : null
}

function euroInCent(wert: string): number {
  const parsed = zahl(wert)
  return parsed === null ? 0 : Math.max(0, Math.round(parsed * 100))
}

function centInEuro(wert: number): string {
  return (wert / 100).toFixed(2)
}

function mbInGb(mb: number | null): string {
  return mb === null ? '' : String(Math.round(mb / 1024))
}

function gbInMb(wert: string): number | null {
  const parsed = zahl(wert)
  return parsed === null ? null : Math.max(0, Math.round(parsed * 1024))
}

function planZuDraft(plan: ShopPlan): Draft {
  return {
    gameType: plan.game_type,
    name: plan.name,
    priceEuro: centInEuro(plan.price_cents),
    ramIncludedGb: mbInGb(plan.ram_included_mb),
    ramMaxGb: mbInGb(plan.ram_max_mb),
    pricePerRamGbEuro: centInEuro(plan.price_per_ram_step_cents),
    cpuIncluded: plan.cpu_included === null ? '' : String(plan.cpu_included),
    cpuMax: plan.cpu_max === null ? '' : String(plan.cpu_max),
    pricePerCpuEuro: centInEuro(plan.price_per_cpu_step_cents),
    slotsIncluded: plan.slots_included === null ? '' : String(plan.slots_included),
    slotsMax: plan.slots_max === null ? '' : String(plan.slots_max),
    pricePerSlotEuro: centInEuro(plan.price_per_slot_step_cents),
    taxRate: String(plan.tax_rate_percent),
    lifetimeEuro:
      plan.lifetime_price_cents != null && plan.lifetime_price_cents > 0
        ? centInEuro(plan.lifetime_price_cents)
        : '',
    allowGameSwitch: plan.allow_game_switch ?? true,
    artworkMode: plan.artwork_mode,
    active: plan.active,
    isFeatured: Boolean(plan.is_featured),
    isBestseller: Boolean(plan.is_bestseller),
    isNew: Boolean(plan.is_new),
    pinnedInHero: Boolean(plan.pinned_in_hero),
    promoHighlightText: plan.promo_highlight_text ?? '',
  }
}

function berechneCpuSchritt(
  cpuIncluded: number | null,
  cpuMax: number | null,
  vorherigerSchritt?: number,
): number {
  const prozentModus =
    (cpuIncluded !== null && cpuIncluded > 32) || (cpuMax !== null && cpuMax > 32)
  if (!prozentModus) return 1
  if (vorherigerSchritt && vorherigerSchritt > 1) return vorherigerSchritt
  const diff = cpuIncluded !== null && cpuMax !== null ? Math.max(0, cpuMax - cpuIncluded) : 0
  if (diff === 0 || diff % 50 === 0) return 50
  if (diff % 25 === 0) return 25
  if (diff % 10 === 0) return 10
  return 1
}

function draftZuPayload(draft: Draft, editing: ShopPlan | null): ShopPlanWrite {
  const ramIncluded = gbInMb(draft.ramIncludedGb)
  const ramMax = gbInMb(draft.ramMaxGb)
  const ramStep = ramIncluded === null && ramMax === null ? null : 1024
  const cpuIncluded = zahl(draft.cpuIncluded)
  const cpuMax = zahl(draft.cpuMax)
  const cpuStep = berechneCpuSchritt(cpuIncluded, cpuMax, editing?.cpu_step)
  const slotsIncluded = zahl(draft.slotsIncluded)
  const slotsMax = zahl(draft.slotsMax)

  return {
    game_type: draft.gameType,
    name: draft.name.trim(),
    description: null,
    price_cents: euroInCent(draft.priceEuro),
    currency: 'EUR',
    billing_interval: 'month',
    tax_rate_percent: zahl(draft.taxRate) ?? 19,
    ram_included_mb: ramIncluded,
    ram_max_mb: ramMax,
    ram_step_mb: ramStep,
    price_per_ram_step_cents: euroInCent(draft.pricePerRamGbEuro),
    cpu_included: cpuIncluded,
    cpu_max: cpuMax,
    cpu_step: cpuStep,
    price_per_cpu_step_cents: euroInCent(draft.pricePerCpuEuro),
    slots_included: slotsIncluded,
    slots_max: slotsMax,
    slots_step: 1,
    price_per_slot_step_cents: euroInCent(draft.pricePerSlotEuro),
    lifetime_price_cents: draft.lifetimeEuro.trim() ? euroInCent(draft.lifetimeEuro) : null,
    allow_game_switch: draft.allowGameSwitch,
    node_id: null,
    role_id: null,
    artwork_mode: draft.artworkMode,
    active: draft.active,
    sort_order: 0,
    is_featured: draft.isFeatured,
    is_bestseller: draft.isBestseller,
    is_new: draft.isNew,
    pinned_in_hero: draft.pinnedInHero,
    promo_highlight_text: draft.promoHighlightText.trim() || null,
  }
}

function prüfeDraft(draft: Draft): string | null {
  if (!draft.gameType) return 'game'
  if (!draft.name.trim()) return 'name'
  if (zahl(draft.priceEuro) === null) return 'price'
  if (draft.lifetimeEuro.trim()) {
    const lp = zahl(draft.lifetimeEuro)
    if (lp === null || lp <= 0) return 'price'
  }
  if ((zahl(draft.taxRate) ?? -1) < 0 || (zahl(draft.taxRate) ?? 101) > 100) return 'tax'
  const paare: Array<[string, string]> = [
    [draft.ramIncludedGb, draft.ramMaxGb],
    [draft.cpuIncluded, draft.cpuMax],
    [draft.slotsIncluded, draft.slotsMax],
  ]
  for (const [inkl, max] of paare) {
    const a = zahl(inkl)
    const b = zahl(max)
    if (a !== null && b !== null && b < a) return 'max'
  }
  return null
}

function ressourceChips(plan: ShopPlan, sprache: 'de' | 'en'): string[] {
  const teile: string[] = []
  if (plan.ram_included_mb !== null) {
    const minGb = Math.round(plan.ram_included_mb / 1024)
    const maxGb = plan.ram_max_mb !== null ? Math.round(plan.ram_max_mb / 1024) : null
    teile.push(maxGb && maxGb > minGb ? `${minGb}–${maxGb} GB RAM` : `${minGb} GB RAM`)
  }
  if (plan.cpu_included !== null) {
    teile.push(formatCpuLabel(plan.cpu_included, sprache))
  }
  if (plan.slots_included !== null) {
    const maxSlots = plan.slots_max !== null && plan.slots_max > plan.slots_included
      ? `–${plan.slots_max}`
      : ''
    teile.push(`${plan.slots_included}${maxSlots} Slots`)
  }
  return teile
}

export interface ShopPlansEditorProps {
  onPlansLoaded?: (plans: ShopPlan[]) => void
}

export function ShopPlansEditor({ onPlansLoaded }: ShopPlansEditorProps = {}) {
  const { t, i18n } = useTranslation()
  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'
  const canWriteSettings = useHasPermission('panel.settings.write')
  const canWriteShop = useHasPermission('shop.write')
  const canWrite = canWriteSettings || canWriteShop
  const [plans, setPlans] = useState<ShopPlan[] | null>(null)
  const [games, setGames] = useState<GameInfo[]>([])
  const [suche, setSuche] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('alle')
  const [ansicht, setAnsicht] = useState<AnsichtModus>('regal')
  const [togglingId, setTogglingId] = useState<number | null>(null)
  const [bildFehler, setBildFehler] = useState<Record<number, boolean>>({})
  const [dialogOffen, setDialogOffen] = useState(false)
  const [dialogTab, setDialogTab] = useState<DialogTabId>('basis')
  const [editing, setEditing] = useState<ShopPlan | null>(null)
  const [draft, setDraft] = useState<Draft>(LEER)
  const [busy, setBusy] = useState(false)
  const [uploadPlan, setUploadPlan] = useState<ShopPlan | null>(null)
  const [galerie, setGalerie] = useState<ShopGalleryItem[]>([])
  const [galerieBusy, setGalerieBusy] = useState(false)
  const dateiRef = useRef<HTMLInputElement>(null)
  const onPlansLoadedRef = useRef(onPlansLoaded)
  onPlansLoadedRef.current = onPlansLoaded

  const galerieLaden = (gameType: string) => {
    setGalerieBusy(true)
    void shopCatalogApi
      .getGallery(gameType)
      .then(setGalerie)
      .catch((error: unknown) => {
        still(error, 'shop.plans.galerie')
        setGalerie([])
      })
      .finally(() => setGalerieBusy(false))
  }

  useEffect(() => {
    if (dialogOffen && editing) {
      galerieLaden(editing.game_type)
    } else {
      setGalerie([])
    }
  }, [dialogOffen, editing])

  const laden = () => {
    void shopAdminApi
      .listPlans()
      .then((liste) => {
        const sicher = Array.isArray(liste) ? liste : []
        setPlans(sicher)
        setBildFehler({})
        onPlansLoadedRef.current?.(sicher)
      })
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t('settings.shop.plans.fehler'))
        setPlans([])
      })
    void api<GameInfo[]>('/system/games')
      .then((g) => setGames(Array.isArray(g) ? g : []))
      .catch(() => setGames([]))
  }

  useEffect(() => {
    laden()
  }, [])

  const gameName = (id: string) => games.find((game) => game.id === id)?.name ?? id

  const gefiltertePlans = useMemo(() => {
    if (!plans) return []
    const q = suche.trim().toLowerCase()
    return plans.filter((plan) => {
      if (statusFilter === 'aktiv' && !plan.active) return false
      if (statusFilter === 'inaktiv' && plan.active) return false
      if (!q) return true
      const spielTitel = (games.find((g) => g.id === plan.game_type)?.name ?? plan.game_type).toLowerCase()
      return (
        plan.name.toLowerCase().includes(q) ||
        plan.game_type.toLowerCase().includes(q) ||
        spielTitel.includes(q)
      )
    })
  }, [plans, suche, statusFilter, games])

  const artworkLabel = (mode: ShopArtworkMode) => {
    if (mode === 'steam') return t('settings.shop.plans.artworkSteam')
    if (mode === 'custom') return t('settings.shop.plans.artworkCustom')
    return t('settings.shop.plans.artworkNone')
  }

  const oeffneNeu = () => {
    setEditing(null)
    setDraft({ ...LEER, gameType: games[0]?.id ?? '' })
    setDialogTab('basis')
    setDialogOffen(true)
  }

  const oeffneBearbeiten = (plan: ShopPlan) => {
    setEditing(plan)
    setDraft(planZuDraft(plan))
    setDialogTab('basis')
    setDialogOffen(true)
  }

  const toggleAktiv = async (plan: ShopPlan) => {
    if (!canWrite || togglingId === plan.id) return
    const naechsterStatus = !plan.active
    setTogglingId(plan.id)
    try {
      const aktualisiert = await shopAdminApi.updatePlan(plan.id, { active: naechsterStatus })
      setPlans((alt) => {
        if (!alt) return alt
        const neu = alt.map((eintrag) =>
          eintrag.id === plan.id
            ? {
                ...eintrag,
                ...(aktualisiert && typeof aktualisiert === 'object' ? aktualisiert : {}),
                active: naechsterStatus,
              }
            : eintrag,
        )
        onPlansLoadedRef.current?.(neu)
        return neu
      })
      toast.success(t('settings.shop.plans.statusAktualisiert'))
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('settings.shop.plans.fehler'))
    } finally {
      setTogglingId(null)
    }
  }

  const speichern = async () => {
    const problem = prüfeDraft(draft)
    if (problem === 'game' || problem === 'name') {
      toast.error(t('settings.shop.plans.pflichtfelder'))
      setDialogTab('basis')
      return
    }
    if (problem === 'max') {
      toast.error(t('settings.shop.plans.maxFehler'))
      setDialogTab('ressourcen')
      return
    }
    if (problem === 'tax') {
      toast.error(t('settings.shop.plans.steuerFehler'))
      setDialogTab('basis')
      return
    }
    setBusy(true)
    try {
      const payload = draftZuPayload(draft, editing)
      if (editing) {
        await shopAdminApi.updatePlan(editing.id, payload)
      } else {
        await shopAdminApi.createPlan(payload)
      }
      toast.success(t('settings.shop.plans.gespeichert'))
      setDialogOffen(false)
      laden()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('settings.shop.plans.fehler'))
    } finally {
      setBusy(false)
    }
  }

  const loeschen = async (plan: ShopPlan) => {
    if (
      !(await confirm({
        title: t('settings.shop.plans.loeschen'),
        message: t('settings.shop.plans.loeschenFrage', { name: plan.name }),
        danger: true,
      }))
    ) {
      return
    }
    try {
      await shopAdminApi.deletePlan(plan.id)
      toast.success(t('settings.shop.plans.geloescht'))
      laden()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('settings.shop.plans.fehler'))
    }
  }

  const bildWaehlen = (plan: ShopPlan) => {
    setUploadPlan(plan)
    dateiRef.current?.click()
  }

  const dateiGewaehlt = async (event: ChangeEvent<HTMLInputElement>) => {
    const dateien = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (dateien.length === 0 || !uploadPlan) return
    const zielPlan = uploadPlan
    try {
      for (let i = dateien.length - 1; i >= 0; i -= 1) {
        await shopAdminApi.uploadArtwork(zielPlan.id, dateien[i])
      }
      toast.success(t('settings.shop.plans.bildGespeichert'))
      laden()
      if (dialogOffen && editing?.game_type === zielPlan.game_type) {
        galerieLaden(zielPlan.game_type)
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('settings.shop.plans.fehler'))
    } finally {
      setUploadPlan(null)
    }
  }

  const galerieBildAktivieren = async (plan: ShopPlan, wallpaperId: number) => {
    setGalerieBusy(true)
    try {
      await shopAdminApi.activateArtworkItem(plan.id, wallpaperId)
      toast.success(t('settings.shop.plans.bildGespeichert'))
      laden()
      galerieLaden(plan.game_type)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('settings.shop.plans.fehler'))
    } finally {
      setGalerieBusy(false)
    }
  }

  const galerieBildLoeschen = async (plan: ShopPlan, wallpaperId: number) => {
    setGalerieBusy(true)
    try {
      await shopAdminApi.deleteArtworkItem(plan.id, wallpaperId)
      toast.success(t('settings.shop.plans.galerieBildGeloescht'))
      laden()
      galerieLaden(plan.game_type)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('settings.shop.plans.fehler'))
    } finally {
      setGalerieBusy(false)
    }
  }

  const bildZuruecksetzen = async (plan: ShopPlan) => {
    try {
      await shopAdminApi.resetArtwork(plan.id)
      toast.success(t('settings.shop.plans.bildZurueckgesetzt'))
      laden()
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('settings.shop.plans.fehler'))
    }
  }

  const setze = <K extends keyof Draft>(feld: K, wert: Draft[K]) => {
    setDraft((alt) => ({ ...alt, [feld]: wert }))
  }

  const spielOptionen = games.map((game) => ({ value: game.id, label: game.name }))
  if (editing && !spielOptionen.some((option) => option.value === editing.game_type)) {
    spielOptionen.unshift({ value: editing.game_type, label: editing.game_type })
  }

  const zeigeRegalHinzufuegen =
    canWrite && statusFilter === 'alle' && suche.trim() === ''

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-headline text-base font-bold text-on-surface">
            {t('settings.shop.plans.titel')}
          </h3>
          <p className="mt-1 text-sm text-on-surface-variant">
            {t('settings.shop.plans.untertitel')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-lg border border-outline-variant/35 bg-surface-container-low/60 p-0.5">
            <Button
              type="button"
              variant={ansicht === 'regal' ? 'secondary' : 'ghost'}
              size="icon"
              aria-pressed={ansicht === 'regal'}
              aria-label={t('settings.shop.plans.ansichtRegal')}
              onClick={() => setAnsicht('regal')}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant={ansicht === 'liste' ? 'secondary' : 'ghost'}
              size="icon"
              aria-pressed={ansicht === 'liste'}
              aria-label={t('settings.shop.plans.ansichtListe')}
              onClick={() => setAnsicht('liste')}
            >
              <List className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <Button
            variant="primary"
            size="sm"
            className="gap-2"
            onClick={oeffneNeu}
            disabled={!canWrite}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('settings.shop.plans.neu')}
          </Button>
        </div>
      </div>

      {plans && plans.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full sm:max-w-xs">
            <Input
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder={t('settings.shop.plans.suchePlatzhalter')}
              aria-label={t('settings.shop.plans.suchePlatzhalter')}
            />
          </div>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label={t('settings.shop.plans.titel')}
          >
            {(
              [
                ['alle', t('settings.shop.plans.filterAlle')],
                ['aktiv', t('settings.shop.plans.filterAktiv')],
                ['inaktiv', t('settings.shop.plans.filterInaktiv')],
              ] as const
            ).map(([wert, label]) => (
              <Button
                key={wert}
                type="button"
                variant={statusFilter === wert ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setStatusFilter(wert)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {plans === null ? (
        <div className="flex items-center gap-3 text-sm text-on-surface-variant">
          <Spinner size="sm" />
          {t('settings.shop.plans.laedt')}
        </div>
      ) : plans.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          titel={t('settings.shop.plans.leer')}
          text={t('settings.shop.plans.leerText')}
        >
          {canWrite && (
            <Button variant="primary" size="sm" onClick={oeffneNeu}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('settings.shop.plans.neu')}
            </Button>
          )}
        </Zustandsflaeche>
      ) : gefiltertePlans.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          ansagen
          titel={t('settings.shop.plans.keineTreffer')}
          text={t('settings.shop.plans.keineTrefferText')}
        />
      ) : ansicht === 'regal' ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {gefiltertePlans.map((plan) => {
            const hatBild = Boolean(plan.artwork?.url) && !bildFehler[plan.id]
            const chips = ressourceChips(plan, sprache)
            return (
              <article
                key={plan.id}
                style={{ containerType: 'inline-size' }}
                className="group relative flex min-h-[250px] flex-col justify-between overflow-hidden rounded-2xl border border-outline-variant/35 bg-surface-container-low shadow-md transition-all hover:border-primary/45"
              >
                <div className="pointer-events-none absolute inset-0" aria-hidden="true">
                  {hatBild ? (
                    <img
                      src={apiUrl(plan.artwork.url!)}
                      alt=""
                      width={460}
                      height={215}
                      loading="lazy"
                      onError={() =>
                        setBildFehler((alt) => ({ ...alt, [plan.id]: true }))
                      }
                      className={`block h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] ${
                        plan.active ? 'opacity-90' : 'opacity-45 grayscale-[40%]'
                      }`}
                    />
                  ) : (
                    <div
                      className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/15 via-surface-container to-surface-container-high ${
                        plan.active ? '' : 'opacity-55'
                      }`}
                    >
                      <Gamepad2 className="h-16 w-16 text-on-surface-variant/25" />
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/40" />
                </div>

                <div className="relative z-10 flex flex-1 flex-col justify-between gap-4 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 truncate rounded-full border border-outline-variant/50 bg-background/95 px-2.5 py-1 text-label-sm font-medium text-on-surface shadow-md backdrop-blur-md">
                      {gameName(plan.game_type)}
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center rounded-full border bg-background/95 px-2.5 py-1 text-label-sm font-bold shadow-md backdrop-blur-md ${
                        plan.active
                          ? 'border-status-success/65 text-status-success'
                          : 'border-outline-variant/60 text-on-surface-variant'
                      }`}
                    >
                      {plan.active
                        ? t('settings.shop.plans.imRegal')
                        : t('settings.shop.plans.ausgeblendet')}
                    </span>
                  </div>

                  <div className="mt-auto space-y-3">
                    <header className="space-y-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <h4 className="min-w-0 truncate font-headline text-base font-bold text-on-surface">
                          {plan.name}
                        </h4>
                        <span className="shrink-0 font-headline text-sm font-bold tabular-nums text-primary">
                          {formatEuro(plan.price_cents)}{' '}
                          <span className="text-xs font-normal text-on-surface-variant">
                            / {t('settings.shop.addons.monat')}
                          </span>
                        </span>
                      </div>
                      {plan.lifetime_price_cents != null && plan.lifetime_price_cents > 0 && (
                        <div>
                          <span className="inline-flex items-center rounded-full border border-primary/50 bg-background/90 px-2 py-0.5 text-label-sm font-bold text-primary backdrop-blur-md">
                            {t('settings.shop.plans.lifetimeKurz')} ·{' '}
                            {formatEuro(plan.lifetime_price_cents)}
                          </span>
                        </div>
                      )}
                    </header>

                    <div className="flex flex-wrap gap-1.5">
                      {chips.map((chip) => (
                        <span
                          key={chip}
                          className="inline-flex items-center rounded-md border border-outline-variant/40 bg-background/80 px-2 py-0.5 text-xs text-on-surface-variant backdrop-blur-sm"
                        >
                          {chip}
                        </span>
                      ))}
                      {plan.allow_game_switch && (
                        <span className="inline-flex items-center rounded-md border border-outline-variant/40 bg-background/80 px-2 py-0.5 text-xs text-on-surface-variant backdrop-blur-sm">
                          {t('settings.shop.plans.gameSwitchKurz')}
                        </span>
                      )}
                      {plan.is_featured && (
                        <span className="inline-flex items-center rounded-md border border-primary/45 bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary backdrop-blur-sm">
                          {t('settings.shop.plans.badgeFeatured')}
                        </span>
                      )}
                      {plan.is_bestseller && (
                        <span className="inline-flex items-center rounded-md border border-status-running/45 bg-status-running/15 px-2 py-0.5 text-xs font-medium text-status-running backdrop-blur-sm">
                          {t('settings.shop.plans.badgeBestseller')}
                        </span>
                      )}
                      {plan.is_new && (
                        <span className="inline-flex items-center rounded-md border border-status-warning/45 bg-status-warning/15 px-2 py-0.5 text-xs font-medium text-status-warning backdrop-blur-sm">
                          {t('settings.shop.plans.badgeNeu')}
                        </span>
                      )}
                      {plan.pinned_in_hero && (
                        <span className="inline-flex items-center rounded-md border border-primary/45 bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary backdrop-blur-sm">
                          {t('settings.shop.plans.badgePinned')}
                        </span>
                      )}
                      <span className="inline-flex items-center rounded-md border border-outline-variant/30 bg-background/75 px-2 py-0.5 text-xs text-on-surface-variant backdrop-blur-sm">
                        {artworkLabel(plan.artwork_mode)}
                      </span>
                    </div>

                    <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3">
                      <div className="flex shrink-0 items-center gap-2">
                        <Switch
                          checked={plan.active}
                          onCheckedChange={() => void toggleAktiv(plan)}
                          disabled={!canWrite || togglingId === plan.id}
                          aria-label={`${plan.name}: ${
                            plan.active
                              ? t('settings.shop.plans.imRegal')
                              : t('settings.shop.plans.ausgeblendet')
                          }`}
                        />
                        <span className="text-xs font-medium text-on-surface">
                          {plan.active
                            ? t('settings.shop.plans.imRegal')
                            : t('settings.shop.plans.ausgeblendet')}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="gap-1.5"
                          onClick={() => oeffneBearbeiten(plan)}
                          disabled={!canWrite}
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          {t('settings.shop.plans.bearbeiten')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={t('settings.shop.plans.bildHochladen')}
                          onClick={() => bildWaehlen(plan)}
                          disabled={!canWrite}
                        >
                          <Upload className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        {plan.artwork_mode === 'custom' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={t('settings.shop.plans.bildZuruecksetzen')}
                            onClick={() => void bildZuruecksetzen(plan)}
                            disabled={!canWrite}
                          >
                            <RotateCcw className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          size="icon"
                          aria-label={t('settings.shop.plans.loeschen')}
                          onClick={() => void loeschen(plan)}
                          disabled={!canWrite}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </footer>
                  </div>
                </div>
              </article>
            )
          })}

          {zeigeRegalHinzufuegen && (
            <button
              type="button"
              onClick={oeffneNeu}
              className="flex min-h-[250px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-outline-variant/50 bg-surface-container-low/30 p-6 text-center transition-colors hover:border-primary/60 hover:bg-primary/5"
            >
              <span className="grid h-10 w-10 place-items-center rounded-full border border-outline-variant/40 bg-surface-container text-primary">
                <Plus className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="font-headline text-sm font-semibold text-on-surface">
                {t('settings.shop.plans.regalNeuTitel')}
              </span>
              <span className="max-w-[16rem] text-xs text-on-surface-variant">
                {t('settings.shop.plans.regalNeuText')}
              </span>
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-outline-variant/25 rounded-2xl border border-outline-variant/30 bg-surface-container-low/50">
          {gefiltertePlans.map((plan) => {
            const hatBild = Boolean(plan.artwork?.url) && !bildFehler[plan.id]
            return (
              <div
                key={plan.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="aspect-[16/9] w-24 shrink-0 overflow-hidden rounded-lg border border-outline-variant/30 bg-surface-container">
                    {hatBild ? (
                      <img
                        src={apiUrl(plan.artwork.url!)}
                        alt=""
                        width={160}
                        height={90}
                        loading="lazy"
                        onError={() =>
                          setBildFehler((alt) => ({ ...alt, [plan.id]: true }))
                        }
                        className={`block h-full w-full object-cover ${
                          plan.active ? '' : 'opacity-60 grayscale-[35%]'
                        }`}
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Gamepad2
                          className="h-5 w-5 text-on-surface-variant/50"
                          aria-hidden="true"
                        />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-headline text-sm font-semibold text-on-surface">
                        {plan.name}
                      </h4>
                      <Badge variant={plan.active ? 'success' : 'default'}>
                        {plan.active
                          ? t('settings.shop.plans.imRegal')
                          : t('settings.shop.plans.ausgeblendet')}
                      </Badge>
                      <Badge variant="info">{artworkLabel(plan.artwork_mode)}</Badge>
                      {plan.is_featured && (
                        <Badge variant="info">{t('settings.shop.plans.badgeFeatured')}</Badge>
                      )}
                      {plan.is_bestseller && (
                        <Badge variant="success">{t('settings.shop.plans.badgeBestseller')}</Badge>
                      )}
                      {plan.is_new && (
                        <Badge variant="warning">{t('settings.shop.plans.badgeNeu')}</Badge>
                      )}
                      {plan.pinned_in_hero && (
                        <Badge variant="info">{t('settings.shop.plans.badgePinned')}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {gameName(plan.game_type)} · {formatEuro(plan.price_cents)} /{' '}
                      {t('settings.shop.addons.monat')}
                      {plan.cpu_included !== null
                        ? ` · ${formatCpuLabel(plan.cpu_included, sprache)}`
                        : ''}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    checked={plan.active}
                    onCheckedChange={() => void toggleAktiv(plan)}
                    disabled={!canWrite || togglingId === plan.id}
                    aria-label={`${plan.name}: ${
                      plan.active
                        ? t('settings.shop.plans.imRegal')
                        : t('settings.shop.plans.ausgeblendet')
                    }`}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => oeffneBearbeiten(plan)}
                    disabled={!canWrite}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('settings.shop.plans.bearbeiten')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('settings.shop.plans.bildHochladen')}
                    onClick={() => bildWaehlen(plan)}
                    disabled={!canWrite}
                  >
                    <Upload className="h-4 w-4" aria-hidden="true" />
                  </Button>
                  {plan.artwork_mode === 'custom' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t('settings.shop.plans.bildZuruecksetzen')}
                      onClick={() => void bildZuruecksetzen(plan)}
                      disabled={!canWrite}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="icon"
                    aria-label={t('settings.shop.plans.loeschen')}
                    onClick={() => void loeschen(plan)}
                    disabled={!canWrite}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <input
        ref={dateiRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(event) => void dateiGewaehlt(event)}
      />

      <Dialog open={dialogOffen} onOpenChange={setDialogOffen}>
        <DialogContent className="max-w-3xl max-h-[90dvh]">
          <DialogHeader>
            <DialogTitle>
              {editing ? t('settings.shop.plans.bearbeiten') : t('settings.shop.plans.neu')}
            </DialogTitle>
          </DialogHeader>

          <div className="border-b border-outline-variant/25 px-6 pt-2">
            <TabBar
              tabs={DIALOG_TABS}
              active={dialogTab}
              onChange={setDialogTab}
              variante="underline"
              kompakt
              einzeilig
              embedded
              ariaLabel={
                editing ? t('settings.shop.plans.bearbeiten') : t('settings.shop.plans.neu')
              }
            />
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div
              role="tabpanel"
              aria-label={t('settings.shop.plans.tabBasis')}
              hidden={dialogTab !== 'basis'}
            >
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5">
                    <span className="block text-sm font-medium text-on-surface">
                      {t('settings.shop.plans.spiel')}
                    </span>
                    <Dropdown
                      value={draft.gameType}
                      onChange={(wert) => setze('gameType', wert)}
                      options={spielOptionen}
                      aria-label={t('settings.shop.plans.spiel')}
                    />
                  </label>
                  <Input
                    label={t('settings.shop.plans.name')}
                    value={draft.name}
                    onChange={(event) => setze('name', event.target.value)}
                    maxLength={128}
                  />
                  <Input
                    label={t('settings.shop.plans.preis')}
                    type="number"
                    min="0"
                    step="0.01"
                    inputMode="decimal"
                    value={draft.priceEuro}
                    onChange={(event) => setze('priceEuro', event.target.value)}
                  />
                  <Input
                    label={t('settings.shop.plans.steuer')}
                    type="number"
                    min="0"
                    max="100"
                    inputMode="numeric"
                    value={draft.taxRate}
                    onChange={(event) => setze('taxRate', event.target.value)}
                  />
                  <div className="sm:col-span-2">
                    <Input
                      label={t('settings.shop.plans.lifetimePreis')}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      placeholder={t('settings.shop.plans.lifetimePreisPlatzhalter')}
                      value={draft.lifetimeEuro}
                      onChange={(event) => setze('lifetimeEuro', event.target.value)}
                    />
                    <p className="mt-1 text-xs text-on-surface-variant">
                      {t('settings.shop.plans.lifetimePreisHinweis')}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                    <span className="text-sm font-medium text-on-surface">
                      {t('settings.shop.plans.aktiv')}
                    </span>
                    <Switch
                      checked={draft.active}
                      onCheckedChange={(wert) => setze('active', wert)}
                      aria-label={t('settings.shop.plans.aktiv')}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                    <span className="text-sm font-medium text-on-surface">
                      {t('settings.shop.plans.allowGameSwitch')}
                    </span>
                    <Switch
                      checked={draft.allowGameSwitch}
                      onCheckedChange={(wert) => setze('allowGameSwitch', wert)}
                      aria-label={t('settings.shop.plans.allowGameSwitch')}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                    <span className="text-sm font-medium text-on-surface">
                      {t('settings.shop.plans.isFeatured')}
                    </span>
                    <Switch
                      checked={draft.isFeatured}
                      onCheckedChange={(wert) => setze('isFeatured', wert)}
                      aria-label={t('settings.shop.plans.isFeatured')}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                    <span className="text-sm font-medium text-on-surface">
                      {t('settings.shop.plans.isBestseller')}
                    </span>
                    <Switch
                      checked={draft.isBestseller}
                      onCheckedChange={(wert) => setze('isBestseller', wert)}
                      aria-label={t('settings.shop.plans.isBestseller')}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                    <span className="text-sm font-medium text-on-surface">
                      {t('settings.shop.plans.isNew')}
                    </span>
                    <Switch
                      checked={draft.isNew}
                      onCheckedChange={(wert) => setze('isNew', wert)}
                      aria-label={t('settings.shop.plans.isNew')}
                    />
                  </label>
                  <label className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                    <span className="text-sm font-medium text-on-surface">
                      {t('settings.shop.plans.pinnedInHero')}
                    </span>
                    <Switch
                      checked={draft.pinnedInHero}
                      onCheckedChange={(wert) => setze('pinnedInHero', wert)}
                      aria-label={t('settings.shop.plans.pinnedInHero')}
                    />
                  </label>
                  <div className="sm:col-span-2">
                    <Input
                      label={t('settings.shop.plans.promoHighlightText')}
                      value={draft.promoHighlightText}
                      onChange={(event) => setze('promoHighlightText', event.target.value)}
                      placeholder={t('settings.shop.plans.promoHighlightPlaceholder')}
                      maxLength={80}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div
              role="tabpanel"
              aria-label={t('settings.shop.plans.tabRessourcen')}
              hidden={dialogTab !== 'ressourcen'}
            >
              <div className="space-y-4 rounded-xl border border-outline-variant/30 bg-surface-container/60 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">
                  {t('settings.shop.plans.ressourcenGrenzen')}
                </p>
                {RESSOURCEN.map((ressource) => (
                  <div key={ressource.id} className="space-y-1.5">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Input
                        label={t(ressource.includedKey)}
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={draft[ressource.includedFeld]}
                        onChange={(event) => setze(ressource.includedFeld, event.target.value)}
                      />
                      <Input
                        label={t(ressource.maxKey)}
                        type="number"
                        min="0"
                        inputMode="numeric"
                        value={draft[ressource.maxFeld]}
                        onChange={(event) => setze(ressource.maxFeld, event.target.value)}
                      />
                      <Input
                        label={t(ressource.preisKey)}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={draft[ressource.preisFeld]}
                        onChange={(event) => setze(ressource.preisFeld, event.target.value)}
                      />
                    </div>
                    {ressource.id === 'cpu' && (
                      <p className="text-label-sm text-on-surface-variant">
                        {t('settings.shop.plans.cpuProzentHinweis', {
                          vorschau: draft.cpuIncluded
                            ? formatCpuLabel(Number(draft.cpuIncluded) || 0, sprache)
                            : '—',
                          schritt: berechneCpuSchritt(
                            zahl(draft.cpuIncluded),
                            zahl(draft.cpuMax),
                            editing?.cpu_step,
                          ),
                        })}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div
              role="tabpanel"
              aria-label={t('settings.shop.plans.tabBilder')}
              hidden={dialogTab !== 'bilder'}
            >
              <div className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="block text-sm font-medium text-on-surface">
                    {t('settings.shop.plans.artwork')}
                  </span>
                  <Dropdown
                    value={draft.artworkMode}
                    onChange={(wert) => setze('artworkMode', wert as ShopArtworkMode)}
                    options={[
                      { value: 'steam', label: t('settings.shop.plans.artworkSteam') },
                      { value: 'custom', label: t('settings.shop.plans.artworkCustom') },
                      { value: 'none', label: t('settings.shop.plans.artworkNone') },
                    ]}
                    aria-label={t('settings.shop.plans.artwork')}
                  />
                </label>

                {editing ? (
                  <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container/60 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-medium uppercase tracking-wider text-on-surface-variant">
                        {t('settings.shop.plans.galerieTitel')}
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => bildWaehlen(editing)}
                        disabled={!canWrite || galerieBusy}
                      >
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('settings.shop.plans.bilderHinzufuegen')}
                      </Button>
                    </div>

                    {galerieBusy && galerie.length === 0 ? (
                      <div className="flex items-center gap-2 py-2 text-xs text-on-surface-variant">
                        <Spinner className="h-3.5 w-3.5" />
                        <span>{t('settings.shop.plans.galerieLaedt')}</span>
                      </div>
                    ) : galerie.length === 0 ? (
                      <p className="text-xs text-on-surface-variant">
                        {t('settings.shop.plans.galerieLeer')}
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        {galerie.map((item) => (
                          <div
                            key={item.id}
                            className={`group relative overflow-hidden rounded-lg border ${
                              item.is_primary
                                ? 'border-primary ring-1 ring-primary/40'
                                : 'border-outline-variant/30'
                            } bg-surface-container-low`}
                          >
                            <img
                              src={apiUrl(item.url)}
                              alt=""
                              width={320}
                              height={180}
                              loading="lazy"
                              className="aspect-[16/9] w-full object-cover"
                            />
                            <div className="flex items-center justify-between gap-1 px-2 py-1.5 text-xs">
                              <Badge variant={item.source === 'custom' ? 'info' : 'default'}>
                                {item.source === 'custom'
                                  ? t('settings.shop.plans.quelleCustom')
                                  : t('settings.shop.plans.quelleSteam')}
                              </Badge>
                              {item.wallpaper_id != null && (
                                <div className="flex items-center gap-1">
                                  {!item.is_primary && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      onClick={() =>
                                        void galerieBildAktivieren(editing, item.wallpaper_id!)
                                      }
                                      disabled={!canWrite || galerieBusy}
                                      aria-label={t('settings.shop.plans.alsCoverSetzen')}
                                    >
                                      <Check className="h-3.5 w-3.5" aria-hidden="true" />
                                    </Button>
                                  )}
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="icon"
                                    onClick={() =>
                                      void galerieBildLoeschen(editing, item.wallpaper_id!)
                                    }
                                    disabled={!canWrite || galerieBusy}
                                    aria-label={t('settings.shop.plans.bildEntfernen')}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="rounded-xl border border-outline-variant/30 bg-surface-container-low/50 p-3.5 text-xs leading-relaxed text-on-surface-variant">
                    {t('settings.shop.plans.galerieErstNachSpeichern')}
                  </p>
                )}

                <p className="text-xs leading-relaxed text-on-surface-variant">
                  {t('settings.shop.plans.bildHinweis')}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setDialogOffen(false)} disabled={busy}>
              {t('settings.shop.plans.abbrechen')}
            </Button>
            <Button variant="primary" onClick={() => void speichern()} disabled={busy || !canWrite}>
              {t('settings.shop.plans.speichern')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
