/**
 * TresorImportExportDialog — Lokaler JSON/CSV-Export und JSON-Import für den
 * geöffneten Tresor.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, FileSpreadsheet, FileJson, Upload } from 'lucide-react'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle } from '@maunting/ui'
import { istBekannteKategorie, type VaultKategorie, type VaultItem } from './vaultEintrag'

export interface ImportierterEintrag {
  service: string
  username: string
  password: string
  url?: string
  notes?: string
  category?: VaultKategorie
}

export interface TresorImportExportDialogProps {
  offen: boolean
  items: VaultItem[]
  onSchliessen: () => void
  onImportieren: (eintraege: ImportierterEintrag[]) => Promise<number>
  onErfolgMeldung?: (text: string) => void
  onFehlerMeldung?: (text: string) => void
}

function csvZelle(wert: string | undefined): string {
  const text = String(wert ?? '').replace(/"/g, '""')
  return `"${text}"`
}

export function TresorImportExportDialog({
  offen,
  items,
  onSchliessen,
  onImportieren,
  onErfolgMeldung,
  onFehlerMeldung,
}: TresorImportExportDialogProps) {
  const { t } = useTranslation()
  const dateiRef = useRef<HTMLInputElement | null>(null)
  const [importLaeuft, setImportLaeuft] = useState(false)

  const sichtbareEintraege = items.filter(
    (item) => istBekannteKategorie(item.category) && !item.trashedAt,
  )

  const herunterladen = (inhalt: string, dateiname: string, mime: string) => {
    const blob = new Blob([inhalt], { type: mime })
    const url = URL.createObjectURL(blob)
    const anker = document.createElement('a')
    anker.href = url
    anker.download = dateiname
    document.body.appendChild(anker)
    anker.click()
    document.body.removeChild(anker)
    URL.revokeObjectURL(url)
    onErfolgMeldung?.(t('mss.vault.dashboard.importExportDialog.exportErfolg'))
  }

  const exportiereJson = () => {
    const daten = {
      format: 'msm-vault-export-v1',
      exportedAt: new Date().toISOString(),
      items: sichtbareEintraege.map((item) => ({
        service: item.service,
        username: item.username,
        password: item.password,
        url: item.url ?? '',
        notes: item.notes ?? '',
        category: item.category ?? 'login',
      })),
    }
    const datum = new Date().toISOString().slice(0, 10)
    herunterladen(JSON.stringify(daten, null, 2), `msm-tresor-${datum}.json`, 'application/json')
  }

  const exportiereCsv = () => {
    const kopf = ['service', 'username', 'password', 'url', 'notes', 'category'].join(',')
    const zeilen = sichtbareEintraege.map((item) =>
      [
        csvZelle(item.service),
        csvZelle(item.username),
        csvZelle(item.password),
        csvZelle(item.url),
        csvZelle(item.notes),
        csvZelle(item.category ?? 'login'),
      ].join(','),
    )
    const datum = new Date().toISOString().slice(0, 10)
    herunterladen([kopf, ...zeilen].join('\n'), `msm-tresor-${datum}.csv`, 'text/csv;charset=utf-8')
  }

  const dateiImportieren = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const datei = event.target.files?.[0]
    event.target.value = ''
    if (!datei) return
    setImportLaeuft(true)
    try {
      const text = await datei.text()
      const roh = JSON.parse(text) as unknown
      const liste = Array.isArray(roh)
        ? roh
        : roh && typeof roh === 'object' && Array.isArray((roh as { items?: unknown[] }).items)
          ? (roh as { items: unknown[] }).items
          : []

      const vorbereitet: ImportierterEintrag[] = []
      for (const element of liste) {
        if (!element || typeof element !== 'object') continue
        const satz = element as Record<string, unknown>
        const service = String(satz.service ?? satz.name ?? satz.title ?? '').trim()
        if (!service) continue
        const rohKategorie = String(satz.category ?? 'login')
        const category: VaultKategorie = istBekannteKategorie(rohKategorie) ? (rohKategorie as VaultKategorie) : 'login'
        vorbereitet.push({
          service,
          username: String(satz.username ?? satz.login ?? ''),
          password: String(satz.password ?? ''),
          url: satz.url ? String(satz.url) : undefined,
          notes: satz.notes ? String(satz.notes) : undefined,
          category,
        })
      }

      if (vorbereitet.length === 0) {
        onFehlerMeldung?.(t('mss.vault.dashboard.importExportDialog.importLeer'))
        return
      }

      const anzahl = await onImportieren(vorbereitet)
      onErfolgMeldung?.(t('mss.vault.dashboard.importExportDialog.importErfolg', { count: anzahl }))
      onSchliessen()
    } catch {
      onFehlerMeldung?.(t('mss.vault.dashboard.importExportDialog.importFehler'))
    } finally {
      setImportLaeuft(false)
    }
  }

  return (
    <Dialog
      open={offen}
      onOpenChange={(open) => {
        if (!open) onSchliessen()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader className="px-5 py-4 pr-14">
          <DialogTitle className="text-sm">
            {t('mss.vault.dashboard.importExportDialog.titel')}
          </DialogTitle>
          <p className="text-xs text-on-surface-variant">
            {t('mss.vault.dashboard.importExportDialog.beschreibung')}
          </p>
        </DialogHeader>
        <div className="space-y-4 p-5">
          <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low/70 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
              <Download className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>{t('mss.vault.dashboard.importExportDialog.exportBereich')}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={exportiereJson}
              >
                <FileJson className="h-4 w-4" aria-hidden="true" />
                {t('mss.vault.dashboard.importExportDialog.exportJson')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={exportiereCsv}
              >
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                {t('mss.vault.dashboard.importExportDialog.exportCsv')}
              </Button>
            </div>
          </div>

          <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low/70 p-4 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
              <Upload className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>{t('mss.vault.dashboard.importExportDialog.importBereich')}</span>
            </div>
            <p className="text-xs text-on-surface-variant">
              {t('mss.vault.dashboard.importExportDialog.importHinweis')}
            </p>
            <input
              ref={dateiRef}
              type="file"
              accept=".json,application/json"
              onChange={dateiImportieren}
              className="hidden"
            />
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={importLaeuft}
              onClick={() => dateiRef.current?.click()}
            >
              <Upload className="h-4 w-4" aria-hidden="true" />
              {t('mss.vault.dashboard.importExportDialog.importJson')}
            </Button>
          </div>

          <div className="flex justify-end pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={onSchliessen}>
              {t('common.close')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
