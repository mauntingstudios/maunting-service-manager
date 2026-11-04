/**
 * TresorNotizDialog & TresorNotizKarte — Dieselbe Notizen-Logik wie unter
 * „Notizen“ (`Notes.tsx`), jedoch im Tresor mit dem Tresor-Schlüssel (ohne
 * KI-Zugriff) verschlüsselt.
 *
 * Unterstützt dieselben Kategorien (`personal`, `shopping`, `todo`, `work`,
 * `idea`, `meeting`), die Farbpalette (`FARB_PALETTE`), Anheften (`isFavorite`),
 * Markdown-Vorschau (`ReactMarkdown` + `remarkGfm`) sowie direkt anklickbare
 * Checklisten- und Einkaufsposten auf den Notizkarten und im Editor.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  ArchiveRestore,
  CheckSquare,
  Edit3,
  Eye,
  Lock,
  Pin,
  Plus,
  Square,
  StickyNote,
  Trash2,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MarkdownBild, MarkdownLink } from '@/components/viewer/Markdownansicht'
import { FARB_PALETTE, farbwahl } from '@/config/farbpalette'
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Dropdown,
  Kurzinfo,
  Spinner,
  Switch,
  type DropdownOption,
} from '@maunting/ui'
import type { VaultItem } from './vaultEintrag'

export interface TresorNotizDaten {
  titel: string
  inhalt: string
  ordner?: string
  notizKategorie: string
  farbe: string
  angepinnt: boolean
}

export interface TresorNotizDialogProps {
  offen: boolean
  initialNotiz?: VaultItem | null
  ordnerOptionen: { value: string; label: string }[]
  standardOrdner?: string
  busy?: boolean
  onSchliessen: () => void
  onSpeichern: (daten: TresorNotizDaten) => Promise<void> | void
}

export function notizMetadaten(item?: VaultItem | null): {
  notizKategorie: string
  farbe: string
} {
  const extra = item?.extra ?? {}
  const notizKategorie =
    typeof extra.noteCategory === 'string' && extra.noteCategory.trim().length > 0
      ? extra.noteCategory
      : 'personal'
  const farbe =
    typeof extra.color === 'string' && extra.color.trim().length > 0
      ? extra.color
      : 'primary'
  return { notizKategorie, farbe }
}

/** Schaltet das `itemIndex`-te Checklisten-Element (`- [ ]` / `- [x]`) im Markdown-Text um. */
export function umschaltenChecklistenEintrag(inhalt: string, itemIndex: number): string {
  const zeilen = inhalt.split('\n')
  let zaehler = 0
  const aktualisiert = zeilen.map((zeile) => {
    const offen = zeile.trimStart().startsWith('- [ ]')
    const erledigt = zeile.trimStart().startsWith('- [x]') || zeile.trimStart().startsWith('- [X]')
    if (!offen && !erledigt) return zeile
    if (zaehler++ !== itemIndex) return zeile
    return offen ? zeile.replace('- [ ]', '- [x]') : zeile.replace(/- \[[xX]\]/, '- [ ]')
  })
  return aktualisiert.join('\n')
}

export function InlineNotizMarkdown({ text, strikethrough }: { text: string; strikethrough?: boolean }) {
  return (
    <span className={`inline-block ${strikethrough ? 'line-through text-on-surface-variant/60' : 'text-on-surface'}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <span className="m-0 inline">{children}</span>,
          img: MarkdownBild,
          a: MarkdownLink,
          strong: ({ children }) => <strong className="font-semibold text-on-surface">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => (
            <code className="px-1 py-0.5 rounded bg-surface-container-highest font-mono text-[0.85em]">
              {children}
            </code>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </span>
  )
}

export interface TresorNotizKarteProps {
  item: VaultItem
  onBearbeiten: (item: VaultItem) => void
  onPinUmschalten: (item: VaultItem) => void
  onArchivUmschalten: (item: VaultItem) => void
  onPapierkorb: (item: VaultItem) => void
  onChecklisteUmschalten: (item: VaultItem, itemIndex: number) => void
}

export function TresorNotizKarte({
  item,
  onBearbeiten,
  onPinUmschalten,
  onArchivUmschalten,
  onPapierkorb,
  onChecklisteUmschalten,
}: TresorNotizKarteProps) {
  const { t } = useTranslation()
  const { notizKategorie, farbe } = notizMetadaten(item)
  const theme = farbwahl(farbe)
  const zeilen = (item.notes || '').split('\n')
  let checkCounter = 0

  const kategorieName =
    notizKategorie === 'shopping'
      ? t('notes.categories.shopping')
      : notizKategorie === 'todo'
        ? t('notes.categories.todo')
        : notizKategorie === 'work'
          ? t('notes.categories.work')
          : notizKategorie === 'idea'
            ? t('notes.categories.idea')
            : notizKategorie === 'meeting'
              ? t('notes.categories.meeting')
              : t('notes.categories.personal')

  return (
    <div
      onClick={() => onBearbeiten(item)}
      className={`group relative flex flex-col justify-between rounded-2xl border transition-all duration-200 cursor-pointer overflow-hidden p-3.5 sm:p-4 ${theme.flaeche} ${theme.rand} hover:shadow-md hover:border-outline/50 active:scale-[0.99]`}
    >
      <div>
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className={`text-label-sm font-semibold px-2 py-0.5 rounded-full border truncate ${theme.pille}`}>
              {kategorieName}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Kurzinfo text={item.isFavorite ? t('notes.unpin') : t('notes.pin')} seite="ende" portal>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onPinUmschalten(item)
                }}
                aria-label={item.isFavorite ? t('notes.unpin') : t('notes.pin')}
                className={`p-1.5 rounded-lg transition-colors ${
                  item.isFavorite
                    ? 'text-primary bg-primary/20 hover:bg-primary/30'
                    : 'text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-container-high'
                }`}
              >
                {item.isFavorite ? <Pin className="w-3.5 h-3.5 fill-primary" /> : <Pin className="w-3.5 h-3.5" />}
              </button>
            </Kurzinfo>
          </div>
        </div>

        <h4 className="font-headline text-sm sm:text-base font-semibold text-on-surface mb-2 line-clamp-2 leading-snug">
          {item.service}
        </h4>

        <div className="space-y-1 text-xs text-on-surface-variant line-clamp-6 mb-3">
          {zeilen.map((zeile, idx) => {
            const isUnchecked = zeile.trimStart().startsWith('- [ ]')
            const isChecked = zeile.trimStart().startsWith('- [x]') || zeile.trimStart().startsWith('- [X]')

            if (isUnchecked || isChecked) {
              const itemIdx = checkCounter++
              const itemText = zeile.replace(/^[ \t]*- \[[ xX]\][ \t]*/, '')
              return (
                <div
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChecklisteUmschalten(item, itemIdx)
                  }}
                  className="flex items-start gap-2 py-1 px-1.5 rounded-lg hover:bg-surface-container-high/50 active:bg-surface-container-high/70 transition-colors cursor-pointer min-h-[26px]"
                >
                  {isChecked ? (
                    <CheckSquare className="w-3.5 h-3.5 text-status-success shrink-0 mt-0.5" />
                  ) : (
                    <Square className="w-3.5 h-3.5 text-on-surface-variant shrink-0 mt-0.5" />
                  )}
                  <InlineNotizMarkdown text={itemText} strikethrough={isChecked} />
                </div>
              )
            }

            if (!zeile.trim()) return <div key={idx} className="h-1.5" />

            return (
              <div key={idx} className="line-clamp-2 text-on-surface-variant leading-relaxed">
                <InlineNotizMarkdown text={zeile} />
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-outline-variant/20 text-label-sm text-on-surface-variant/80 mt-auto">
        <span>
          {new Date(item.updatedAt || item.createdAt).toLocaleDateString('de-DE', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>

        <div className="flex items-center gap-1">
          <Kurzinfo text={item.archivedAt ? t('notes.unarchive') : t('notes.archive')} portal>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onArchivUmschalten(item)
              }}
              aria-label={item.archivedAt ? t('notes.unarchive') : t('notes.archive')}
              className="p-1.5 text-on-surface-variant hover:text-on-surface rounded-lg hover:bg-surface-container-high transition-colors"
            >
              {item.archivedAt ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />}
            </button>
          </Kurzinfo>

          <Kurzinfo text={t('common.delete')} seite="ende" portal>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onPapierkorb(item)
              }}
              aria-label={t('common.delete')}
              className="p-1.5 text-status-destructive hover:text-status-destructive/80 rounded-lg hover:bg-status-destructive/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Kurzinfo>
        </div>
      </div>
    </div>
  )
}

export function TresorNotizDialog({
  offen,
  initialNotiz,
  ordnerOptionen,
  standardOrdner = '',
  busy = false,
  onSchliessen,
  onSpeichern,
}: TresorNotizDialogProps) {
  const { t } = useTranslation()
  const [titel, setTitel] = useState('')
  const [inhalt, setInhalt] = useState('')
  const [ordner, setOrdner] = useState('')
  const [notizKategorie, setNotizKategorie] = useState('personal')
  const [farbe, setFarbe] = useState('primary')
  const [angepinnt, setAngepinnt] = useState(false)
  const [modalTab, setModalTab] = useState<'edit' | 'preview'>('edit')

  useEffect(() => {
    if (!offen) return
    const meta = notizMetadaten(initialNotiz)
    setTitel(initialNotiz?.service ?? '')
    setInhalt(initialNotiz?.notes ?? '')
    setOrdner(initialNotiz?.ordner ?? standardOrdner)
    setNotizKategorie(meta.notizKategorie)
    setFarbe(meta.farbe)
    setAngepinnt(Boolean(initialNotiz?.isFavorite))
    setModalTab('edit')
  }, [offen, initialNotiz, standardOrdner])

  const modalCategoryOptions: DropdownOption[] = [
    { value: 'personal', label: t('notes.categories.personal') },
    { value: 'shopping', label: t('notes.categories.shopping') },
    { value: 'todo', label: t('notes.categories.todo') },
    { value: 'work', label: t('notes.categories.work') },
    { value: 'idea', label: t('notes.categories.idea') },
    { value: 'meeting', label: t('notes.categories.meeting') },
  ]

  const absenden = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!titel.trim() || busy) return
    await onSpeichern({
      titel: titel.trim(),
      inhalt,
      ordner: ordner || undefined,
      notizKategorie,
      farbe,
      angepinnt,
    })
  }

  return (
    <Dialog
      open={offen}
      onOpenChange={(open) => {
        if (!open) onSchliessen()
      }}
    >
      <DialogContent className="max-w-xl max-h-[90dvh]">
        <DialogHeader className="px-6 py-4 pr-14">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 border border-primary/25 text-primary">
              <StickyNote className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <DialogTitle className="text-sm">
                {initialNotiz ? t('notes.editNote') : t('notes.createNote')}
              </DialogTitle>
              <p className="text-label-sm text-on-surface-variant">
                {t('mss.vault.dashboard.notizDialog.hinweisLokal')}
              </p>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={absenden} className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
              {t('notes.formTitle')} *
            </label>
            <input
              type="text"
              required
              autoFocus
              value={titel}
              onChange={(e) => setTitel(e.target.value)}
              placeholder={t('notes.formTitlePlaceholder')}
              className="msm-input"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                {t('notes.formCategory')}
              </label>
              <Dropdown
                value={notizKategorie}
                onChange={setNotizKategorie}
                options={modalCategoryOptions}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
                {t('mss.vault.dateien.ordner')}
              </label>
              <Dropdown
                value={ordner}
                onChange={setOrdner}
                options={ordnerOptionen}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-on-surface-variant mb-1.5">
              {t('notes.formColor')}
            </label>
            <div className="flex items-center gap-1.5 flex-wrap">
              {FARB_PALETTE.map((theme) => (
                <button
                  key={theme.id}
                  type="button"
                  onClick={() => setFarbe(theme.id)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-all ${
                    farbe === theme.id
                      ? `${theme.flaeche} ${theme.rand} ${theme.text} ring-2 ring-primary/40`
                      : 'bg-surface-container border-outline-variant/25 text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${theme.flaeche} border ${theme.rand}`} />
                  {t(theme.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between bg-surface-container/50 border border-outline-variant/25 rounded-xl p-3">
            <span className="text-xs font-semibold text-on-surface flex items-center gap-1.5">
              <Pin className="w-3.5 h-3.5 text-primary" />
              {t('notes.pinToTop')}
            </span>
            <Switch
              checked={angepinnt}
              onCheckedChange={setAngepinnt}
              aria-label={t('notes.pinToTop')}
            />
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="text-xs font-semibold text-on-surface-variant">
                {t('notes.formContent')}
              </label>
              <div className="flex items-center bg-surface-container rounded-lg p-0.5 border border-outline-variant/25 text-label-sm">
                <button
                  type="button"
                  onClick={() => setModalTab('edit')}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-colors ${
                    modalTab === 'edit'
                      ? 'bg-primary/20 text-primary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <Edit3 className="w-3 h-3" />
                  {t('notes.tabEditor')}
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab('preview')}
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-md font-medium transition-colors ${
                    modalTab === 'preview'
                      ? 'bg-primary/20 text-primary'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  {t('common.preview')}
                </button>
              </div>
            </div>

            {modalTab === 'edit' && (
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setInhalt((prev) => (prev ? `${prev}\n- [ ] ` : '- [ ] '))}
                  className="inline-flex items-center gap-1 text-label-sm px-2.5 py-1 rounded-lg bg-surface-container text-on-surface-variant hover:text-primary hover:bg-surface-container-high border border-outline-variant/25 transition-colors"
                >
                  <Plus className="w-3 h-3 text-primary" />
                  <span>Checkliste</span>
                </button>
                <button
                  type="button"
                  onClick={() => setInhalt((prev) => (prev ? `${prev}\n- [ ] 1x  (~0,00 €)` : '- [ ] 1x  (~0,00 €)'))}
                  className="inline-flex items-center gap-1 text-label-sm px-2.5 py-1 rounded-lg bg-surface-container text-on-surface-variant hover:text-status-success hover:bg-surface-container-high border border-outline-variant/25 transition-colors"
                >
                  <Plus className="w-3 h-3 text-status-success" />
                  <span>Einkaufsposten</span>
                </button>
              </div>
            )}

            {modalTab === 'edit' ? (
              <textarea
                rows={8}
                value={inhalt}
                onChange={(e) => setInhalt(e.target.value)}
                placeholder={t('notes.contentPlaceholder')}
                className="msm-input font-mono leading-relaxed resize-y"
              />
            ) : (
              <div className="w-full min-h-[190px] max-h-[300px] overflow-y-auto bg-surface-container/60 border border-outline-variant/25 rounded-xl p-3.5 text-xs space-y-1.5">
                {inhalt.trim() ? (
                  inhalt.split('\n').map((zeile, idx) => {
                    const isUnchecked = zeile.trimStart().startsWith('- [ ]')
                    const isChecked = zeile.trimStart().startsWith('- [x]') || zeile.trimStart().startsWith('- [X]')

                    if (isUnchecked || isChecked) {
                      const itemText = zeile.replace(/^[ \t]*- \[[ xX]\][ \t]*/, '')
                      const toggleCheckInModal = () => {
                        const zeilen = inhalt.split('\n')
                        zeilen[idx] = isUnchecked
                          ? zeile.replace('- [ ]', '- [x]')
                          : zeile.replace(/- \[[xX]\]/, '- [ ]')
                        setInhalt(zeilen.join('\n'))
                      }
                      return (
                        <div
                          key={idx}
                          onClick={toggleCheckInModal}
                          className="flex items-start gap-2 py-0.5 px-1.5 rounded hover:bg-surface-container-high/60 transition-colors cursor-pointer"
                        >
                          {isChecked ? (
                            <CheckSquare className="w-3.5 h-3.5 text-status-success shrink-0 mt-0.5" />
                          ) : (
                            <Square className="w-3.5 h-3.5 text-on-surface-variant shrink-0 mt-0.5" />
                          )}
                          <InlineNotizMarkdown text={itemText} strikethrough={isChecked} />
                        </div>
                      )
                    }

                    if (!zeile.trim()) return <div key={idx} className="h-1.5" />

                    return (
                      <div key={idx} className="text-on-surface leading-relaxed">
                        <InlineNotizMarkdown text={zeile} />
                      </div>
                    )
                  })
                ) : (
                  <p className="text-xs text-on-surface-variant/60 italic py-6 text-center">
                    {t('notes.previewEmpty')}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 pt-4 border-t border-outline-variant/25">
            <span className="inline-flex items-center gap-1.5 text-label-sm text-on-surface-variant">
              <Lock className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span>{t('mss.vault.dashboard.notizDialog.hinweisLokal')}</span>
            </span>
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" onClick={onSchliessen}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? <Spinner className="mr-1.5" /> : null}
                {initialNotiz ? t('common.save') : t('notes.createAction')}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
