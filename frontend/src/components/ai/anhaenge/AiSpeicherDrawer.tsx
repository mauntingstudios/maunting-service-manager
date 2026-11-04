import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CheckSquare,
  File,
  FileCode,
  FileText,
  HardDrive,
  Image as ImageIcon,
  MessageSquarePlus,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react'

import type { AiAttachment } from '@/api/ai'
import { Button, Checkbox, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Kurzinfo } from '@maunting/ui'
import { anhangArt, lesbareGroesse } from '@/lib/aiAnhangTypen'

export interface AiSpeicherDrawerProps {
  offen: boolean
  onSchliessen: () => void
  anhaenge: AiAttachment[]
  onLoeschen: (anhang: AiAttachment, auchAusTresor: boolean) => Promise<void>
  onInPromptEinfuegen?: (anhang: AiAttachment) => void
  tresorSpiegelungAktiv?: boolean
}

type FilterArt = 'alle' | 'bilder' | 'dokumente' | 'texte'

export function AiSpeicherDrawer({
  offen,
  onSchliessen,
  anhaenge,
  onLoeschen,
  onInPromptEinfuegen,
  tresorSpiegelungAktiv = false,
}: AiSpeicherDrawerProps) {
  const { t, i18n } = useTranslation()
  const [suchbegriff, setSuchbegriff] = useState('')
  const [filter, setFilter] = useState<FilterArt>('alle')
  const [ausgewaehlteIds, setAusgewaehlteIds] = useState<Set<string>>(new Set())
  const [zuLoeschendeAnhaenge, setZuLoeschendeAnhaenge] = useState<AiAttachment[]>([])
  const [auchAusTresor, setAuchAusTresor] = useState(false)
  const [wirdGeloescht, setWirdGeloescht] = useState(false)

  const gesamtGroesse = useMemo(
    () => anhaenge.reduce((sum, item) => sum + (item.size_bytes || 0), 0),
    [anhaenge],
  )

  const gefilterteAnhaenge = useMemo(() => {
    return anhaenge.filter((item) => {
      const art = anhangArt(item.media_type, item.original_name)
      if (filter === 'bilder' && art !== 'image') return false
      if (filter === 'dokumente' && art !== 'document') return false
      if (filter === 'texte' && art !== 'text') return false

      if (suchbegriff.trim()) {
        const query = suchbegriff.toLowerCase()
        const name = (item.original_name || '').toLowerCase()
        if (!name.includes(query)) return false
      }
      return true
    })
  }, [anhaenge, filter, suchbegriff])

  const formatiereDatum = (isoString: string) => {
    try {
      const d = new Date(isoString)
      return new Intl.DateTimeFormat(i18n.language || 'de', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(d)
    } catch {
      return isoString
    }
  }

  const toggleSelect = (id: string) => {
    setAusgewaehlteIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (ausgewaehlteIds.size === gefilterteAnhaenge.length) {
      setAusgewaehlteIds(new Set())
    } else {
      setAusgewaehlteIds(new Set(gefilterteAnhaenge.map((a) => a.id)))
    }
  }

  const handleOpenDelete = (items: AiAttachment[]) => {
    setZuLoeschendeAnhaenge(items)
    setAuchAusTresor(false)
  }

  const handleDeleteConfirm = async () => {
    if (zuLoeschendeAnhaenge.length === 0) return
    setWirdGeloescht(true)
    try {
      for (const anhang of zuLoeschendeAnhaenge) {
        await onLoeschen(anhang, auchAusTresor)
      }
      setAusgewaehlteIds((prev) => {
        const next = new Set(prev)
        zuLoeschendeAnhaenge.forEach((a) => next.delete(a.id))
        return next
      })
      setZuLoeschendeAnhaenge([])
      setAuchAusTresor(false)
    } finally {
      setWirdGeloescht(false)
    }
  }

  return (
    <>
      <Dialog open={offen} onOpenChange={(auf) => { if (!auf) onSchliessen() }}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
          <DialogHeader className="p-4 sm:p-6 pb-3 border-b border-outline-variant/20">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <HardDrive className="h-5 w-5" aria-hidden="true" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold text-on-surface">
                    {t('ai.attachments.storageTitle')}
                  </DialogTitle>
                  <p className="text-xs text-on-surface-variant">
                    {anhaenge.length} {t('ai.attachments.list')} · {t('ai.attachments.totalSize')}: {lesbareGroesse(gesamtGroesse)}
                  </p>
                </div>
              </div>
            </div>

            {/* Filter- & Suchleiste */}
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-on-surface-variant pointer-events-none" aria-hidden="true" />
                <Input
                  value={suchbegriff}
                  onChange={(e) => setSuchbegriff(e.target.value)}
                  placeholder={t('ai.attachments.searchPlaceholder')}
                  className="pl-8 h-9 text-sm"
                  aria-label={t('ai.attachments.searchPlaceholder')}
                />
                {suchbegriff && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-on-surface-variant hover:text-on-surface"
                    onClick={() => setSuchbegriff('')}
                    aria-label="Suche leeren"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
                {(['alle', 'bilder', 'dokumente', 'texte'] as FilterArt[]).map((f) => (
                  <Button
                    key={f}
                    type="button"
                    variant={filter === f ? 'primary' : 'ghost'}
                    size="sm"
                    className="h-8 text-xs shrink-0"
                    onClick={() => setFilter(f)}
                  >
                    {f === 'alle' && t('ai.attachments.filterAll')}
                    {f === 'bilder' && t('ai.attachments.filterImages')}
                    {f === 'dokumente' && t('ai.attachments.filterDocuments')}
                    {f === 'texte' && t('ai.attachments.filterText')}
                  </Button>
                ))}
              </div>
            </div>

            {/* Sammel-Aktionsleiste bei Auswahl */}
            {gefilterteAnhaenge.length > 0 && (
              <div className="mt-2.5 pt-2 border-t border-outline-variant/15 flex items-center justify-between text-xs text-on-surface-variant">
                <button
                  type="button"
                  onClick={toggleSelectAll}
                  className="flex items-center gap-2 hover:text-on-surface transition-colors select-none font-medium"
                >
                  {ausgewaehlteIds.size === gefilterteAnhaenge.length ? (
                    <CheckSquare className="h-4 w-4 text-primary" />
                  ) : (
                    <Square className="h-4 w-4 text-outline" />
                  )}
                  <span>{t('ai.attachments.selectAll')}</span>
                </button>

                {ausgewaehlteIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-primary">
                      {t('ai.attachments.selectedCount', { count: ausgewaehlteIds.size })}
                    </span>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      className="h-7 px-2.5 text-xs"
                      onClick={() => {
                        const gewaehlt = gefilterteAnhaenge.filter((a) => ausgewaehlteIds.has(a.id))
                        handleOpenDelete(gewaehlt)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      {t('ai.attachments.deleteSelected', { count: ausgewaehlteIds.size })}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </DialogHeader>

          {/* Dateiliste */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2 min-h-[220px]">
            {gefilterteAnhaenge.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-center text-on-surface-variant">
                <HardDrive className="h-10 w-10 opacity-30 mb-2" aria-hidden="true" />
                <p className="text-sm font-medium">{t('ai.attachments.emptyStorage')}</p>
                <p className="text-xs text-on-surface-variant/70 mt-1 max-w-sm">
                  {t('ai.attachments.storageDescription')}
                </p>
              </div>
            ) : (
              <ul className="space-y-1.5" aria-label={t('ai.attachments.list')}>
                {gefilterteAnhaenge.map((item) => {
                  const art = anhangArt(item.media_type, item.original_name)
                  const istAusgewaehlt = ausgewaehlteIds.has(item.id)
                  return (
                    <li
                      key={item.id}
                      className={`group flex items-center justify-between p-2.5 rounded-xl border transition-colors gap-3 ${
                        istAusgewaehlt
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-outline-variant/30 bg-surface-container hover:bg-surface-container-high'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <Checkbox
                          id={`select-${item.id}`}
                          checked={istAusgewaehlt}
                          onCheckedChange={() => toggleSelect(item.id)}
                          aria-label={`${t('common.select', 'Auswählen')}: ${item.original_name}`}
                        />
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface border border-outline-variant/30 text-on-surface-variant">
                          {art === 'image' ? (
                            <ImageIcon className="h-4 w-4" aria-hidden="true" />
                          ) : art === 'document' ? (
                            <FileText className="h-4 w-4" aria-hidden="true" />
                          ) : art === 'text' ? (
                            <FileCode className="h-4 w-4" aria-hidden="true" />
                          ) : (
                            <File className="h-4 w-4" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-on-surface truncate">
                            {item.original_name}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                            <span>{lesbareGroesse(item.size_bytes)}</span>
                            <span>·</span>
                            <span>{formatiereDatum(item.created_at)}</span>
                            {item.redacted_spans ? (
                              <span className="rounded-full bg-warning/10 text-warning border border-warning/20 px-1.5 py-0.5 text-xs">
                                {t('ai.attachments.redacted', { count: item.redacted_spans })}
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {onInPromptEinfuegen && (
                          <Kurzinfo text={t('ai.attachments.insertIntoPrompt')} lage="oben" seite="mitte">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-on-surface-variant hover:text-primary"
                              aria-label={`${t('ai.attachments.insertIntoPrompt')}: ${item.original_name}`}
                              onClick={() => {
                                onInPromptEinfuegen(item)
                                onSchliessen()
                              }}
                            >
                              <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </Kurzinfo>
                        )}
                        <Kurzinfo text={t('ai.attachments.remove')} lage="oben" seite="ende">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-on-surface-variant hover:text-error"
                            aria-label={`${t('ai.attachments.remove')}: ${item.original_name}`}
                            onClick={() => handleOpenDelete([item])}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </Kurzinfo>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <DialogFooter variant="plain" className="p-3 sm:p-4 border-t border-outline-variant/20 flex justify-end">
            <Button type="button" variant="ghost" onClick={onSchliessen}>
              {t('common.close', 'Schließen')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bestätigungsdialog zum Löschen (luftig, ohne dunklen Balken) */}
      <Dialog
        open={zuLoeschendeAnhaenge.length > 0}
        onOpenChange={(auf) => { if (!auf && !wirdGeloescht) setZuLoeschendeAnhaenge([]) }}
      >
        <DialogContent className="max-w-md p-6">
          <DialogHeader className="p-0 pb-3">
            <DialogTitle className="text-base font-semibold text-on-surface">
              {t('ai.attachments.deleteConfirmTitle')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <p className="text-sm text-on-surface-variant leading-relaxed">
              {t('ai.attachments.deleteConfirmMessage')}
            </p>

            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {zuLoeschendeAnhaenge.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-outline-variant/30 bg-surface-container text-xs text-on-surface"
                >
                  <span className="font-medium truncate flex-1 mr-2">{item.original_name}</span>
                  <span className="text-on-surface-variant shrink-0">{lesbareGroesse(item.size_bytes)}</span>
                </div>
              ))}
            </div>

            {tresorSpiegelungAktiv && (
              <div className="flex items-center gap-2.5 pt-2 border-t border-outline-variant/15">
                <Checkbox
                  id="auch-aus-tresor-loeschen"
                  checked={auchAusTresor}
                  onCheckedChange={(checked) => setAuchAusTresor(Boolean(checked))}
                />
                <label
                  htmlFor="auch-aus-tresor-loeschen"
                  className="text-xs text-on-surface cursor-pointer select-none leading-normal"
                >
                  {t('ai.attachments.deleteAlsoFromVault')}
                </label>
              </div>
            )}
          </div>

          <DialogFooter variant="plain" className="mt-5 p-0 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={wirdGeloescht}
              onClick={() => setZuLoeschendeAnhaenge([])}
            >
              {t('common.cancel', 'Abbrechen')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={wirdGeloescht}
              onClick={() => void handleDeleteConfirm()}
            >
              {t('ai.attachments.remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
