import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Pencil, Plus, RotateCcw, Trash2, Upload } from 'lucide-react'
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
  Zustandsflaeche,
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
import { confirm } from '@/stores/confirmStore'
import { toast } from '@/stores/toastStore'
import type { GameInfo } from '@/types'
import { formatCpuLabel, formatEuro } from '@/shop/preis'

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
}

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

export function ShopPlansEditor() {
  const { t, i18n } = useTranslation()
  const sprache = i18n.language.startsWith('de') ? 'de' : 'en'
  const canWriteSettings = useHasPermission('panel.settings.write')
  const canWriteShop = useHasPermission('shop.write')
  const canWrite = canWriteSettings || canWriteShop
  const [plans, setPlans] = useState<ShopPlan[] | null>(null)
  const [games, setGames] = useState<GameInfo[]>([])
  const [dialogOffen, setDialogOffen] = useState(false)
  const [editing, setEditing] = useState<ShopPlan | null>(null)
  const [draft, setDraft] = useState<Draft>(LEER)
  const [busy, setBusy] = useState(false)
  const [uploadPlan, setUploadPlan] = useState<ShopPlan | null>(null)
  const [galerie, setGalerie] = useState<ShopGalleryItem[]>([])
  const [galerieBusy, setGalerieBusy] = useState(false)
  const dateiRef = useRef<HTMLInputElement>(null)

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
      .then(setPlans)
      .catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t('settings.shop.plans.fehler'))
        setPlans([])
      })
    void api<GameInfo[]>('/system/games')
      .then(setGames)
      .catch(() => setGames([]))
  }

  useEffect(() => {
    laden()
  }, [])

  const gameName = (id: string) => games.find((game) => game.id === id)?.name ?? id

  const artworkLabel = (mode: ShopArtworkMode) => {
    if (mode === 'steam') return t('settings.shop.plans.artworkSteam')
    if (mode === 'custom') return t('settings.shop.plans.artworkCustom')
    return t('settings.shop.plans.artworkNone')
  }

  const oeffneNeu = () => {
    setEditing(null)
    setDraft({ ...LEER, gameType: games[0]?.id ?? '' })
    setDialogOffen(true)
  }

  const oeffneBearbeiten = (plan: ShopPlan) => {
    setEditing(plan)
    setDraft(planZuDraft(plan))
    setDialogOffen(true)
  }

  const speichern = async () => {
    const problem = prüfeDraft(draft)
    if (problem === 'game' || problem === 'name') {
      toast.error(t('settings.shop.plans.pflichtfelder'))
      return
    }
    if (problem === 'max') {
      toast.error(t('settings.shop.plans.maxFehler'))
      return
    }
    if (problem === 'tax') {
      toast.error(t('settings.shop.plans.steuerFehler'))
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

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface">
            {t('settings.shop.plans.titel')}
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {t('settings.shop.plans.untertitel')}
          </p>
        </div>
        <Button variant="primary" size="sm" className="gap-2" onClick={oeffneNeu} disabled={!canWrite}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('settings.shop.plans.neu')}
        </Button>
      </div>

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
        />
      ) : (
        <div className="space-y-2">
          {plans.map((plan) => (
            <div
              key={plan.id}
              className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-headline text-sm font-semibold text-on-surface">
                      {plan.name}
                    </h3>
                    <Badge variant={plan.active ? 'success' : 'default'}>
                      {plan.active
                        ? t('settings.shop.plans.aktiv')
                        : t('settings.shop.plans.inaktiv')}
                    </Badge>
                    <Badge variant="info">{artworkLabel(plan.artwork_mode)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {gameName(plan.game_type)} · {formatEuro(plan.price_cents)} / Monat
                    {plan.cpu_included !== null
                      ? ` · ${formatCpuLabel(plan.cpu_included, sprache)}`
                      : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
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
                    size="sm"
                    className="gap-1.5"
                    onClick={() => bildWaehlen(plan)}
                    disabled={!canWrite}
                  >
                    <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('settings.shop.plans.bildHochladen')}
                  </Button>
                  {plan.artwork_mode === 'custom' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void bildZuruecksetzen(plan)}
                      disabled={!canWrite}
                    >
                      <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('settings.shop.plans.bildZuruecksetzen')}
                    </Button>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => void loeschen(plan)}
                    disabled={!canWrite}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('settings.shop.plans.loeschen')}
                  </Button>
                </div>
              </div>
            </div>
          ))}
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

          <div className="flex-1 space-y-5 overflow-y-auto p-6">
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
              <div>
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

            <div className="space-y-3 rounded-xl border border-outline-variant/30 bg-surface-container/60 p-4">
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

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
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
              <label className="flex items-center justify-between gap-4 self-end rounded-xl border border-outline-variant/30 bg-surface-container p-3">
                <span className="text-sm font-medium text-on-surface">
                  {t('settings.shop.plans.aktiv')}
                </span>
                <Switch
                  checked={draft.active}
                  onCheckedChange={(wert) => setze('active', wert)}
                  aria-label={t('settings.shop.plans.aktiv')}
                />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-xl border border-outline-variant/30 bg-surface-container p-3 sm:col-span-2">
                <span className="text-sm font-medium text-on-surface">
                  {t('settings.shop.plans.allowGameSwitch')}
                </span>
                <Switch
                  checked={draft.allowGameSwitch}
                  onCheckedChange={(wert) => setze('allowGameSwitch', wert)}
                  aria-label={t('settings.shop.plans.allowGameSwitch')}
                />
              </label>
            </div>

            {editing && (
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
                                <button
                                  type="button"
                                  onClick={() => void galerieBildAktivieren(editing, item.wallpaper_id!)}
                                  disabled={!canWrite || galerieBusy}
                                  aria-label={t('settings.shop.plans.alsCoverSetzen')}
                                  className="grid h-6 w-6 place-items-center rounded-md border border-outline-variant/30 bg-surface-container text-on-surface hover:border-primary hover:text-primary"
                                >
                                  <Check className="h-3 w-3" aria-hidden="true" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => void galerieBildLoeschen(editing, item.wallpaper_id!)}
                                disabled={!canWrite || galerieBusy}
                                aria-label={t('settings.shop.plans.bildEntfernen')}
                                className="grid h-6 w-6 place-items-center rounded-md border border-outline-variant/30 bg-surface-container text-on-surface hover:border-status-destructive/50 hover:text-status-destructive"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <p className="text-xs leading-relaxed text-on-surface-variant">
              {t('settings.shop.plans.bildHinweis')}
            </p>
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
