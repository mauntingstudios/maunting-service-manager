import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Megaphone,
  Plus,
  Edit2,
  Trash2,
  Eye,
  Calendar,
  CheckCircle,
  Clock,
  ExternalLink,
  Save,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import {
  listAdminPopups,
  createAdminPopup,
  updateAdminPopup,
  deleteAdminPopup,
  POPUP_CONTENT_MAX_LENGTH,
  type PanelPopup,
  type PanelPopupCreateInput,
  type PopupAudience,
  type PopupTone,
} from '@/api/popups'
import { Button, Dropdown, Switch, DateTimePicker, Kurzinfo, Spinner } from '@maunting/ui'
import { toast } from '@/stores/toastStore'
import { confirm } from '@/stores/confirmStore'
import { useHasPermission } from '@/hooks/useHasPermission'
import { AiMarkdown } from '@/components/ai/AiMarkdown'
import { MarkdownFormatLeiste } from '@/components/editor/MarkdownFormatLeiste'
import { PanelPopupModal } from '@/components/popups/PanelPopupModal'
export function PopupTab() {
  const { t, i18n } = useTranslation()
  const canWrite = useHasPermission('panel.settings.write')

  const [popups, setPopups] = useState<PanelPopup[]>([])
  const [loading, setLoading] = useState(true)
  const [editingPopup, setEditingPopup] = useState<PanelPopup | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [editorMode, setEditorMode] = useState<'write' | 'preview'>('write')
  const [previewPopup, setPreviewPopup] = useState<PanelPopup | null>(null)

  // Form State
  const [title, setTitle] = useState('')
  const [contentMarkdown, setContentMarkdown] = useState('')
  const [audience, setAudience] = useState<PopupAudience>('all')
  const [tone, setTone] = useState<PopupTone>('info')
  const [isActive, setIsActive] = useState(true)
  const [startAt, setStartAt] = useState('')
  const [endAt, setEndAt] = useState('')
  const [buttonText, setButtonText] = useState('')
  const [buttonUrl, setButtonUrl] = useState('')
  const [saving, setSaving] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const loadPopups = async () => {
    try {
      setLoading(true)
      const data = await listAdminPopups()
      setPopups(data)
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Laden der Pop-ups')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadPopups()
  }, [])

  const startCreate = () => {
    setEditingPopup(null)
    setTitle('')
    setContentMarkdown('')
    setAudience('all')
    setTone('info')
    setIsActive(true)
    setStartAt('')
    setEndAt('')
    setButtonText('')
    setButtonUrl('')
    setEditorMode('write')
    setIsCreating(true)
  }

  const startEdit = (p: PanelPopup) => {
    setEditingPopup(p)
    setTitle(p.title)
    setContentMarkdown(p.content_markdown)
    setAudience(p.audience ?? 'all')
    setTone(p.tone ?? 'info')
    setIsActive(p.is_active)
    setStartAt(p.start_at ? p.start_at.substring(0, 16) : '')
    setEndAt(p.end_at ? p.end_at.substring(0, 16) : '')
    setButtonText(p.button_text || '')
    setButtonUrl(p.button_url || '')
    setEditorMode('write')
    setIsCreating(false)
  }

  const cancelEdit = () => {
    setEditingPopup(null)
    setEditorMode('write')
    setIsCreating(false)
  }

  const insertMarkdown = (prefix: string, suffix: string = '') => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const currentVal = textarea.value
    const selectedText = currentVal.substring(start, end)
    const replacement = `${prefix}${selectedText || 'Text'}${suffix}`

    const newVal = currentVal.substring(0, start) + replacement + currentVal.substring(end)
    setContentMarkdown(newVal)

    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + prefix.length, start + replacement.length - suffix.length)
    }, 0)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !contentMarkdown.trim()) {
      toast.error(t('popups.validationRequired'))
      return
    }
    if (contentMarkdown.trim().length > POPUP_CONTENT_MAX_LENGTH) {
      toast.error(t('popups.contentTooLong', { max: POPUP_CONTENT_MAX_LENGTH }))
      return
    }

    setSaving(true)
    try {
      const payload: PanelPopupCreateInput = {
        title: title.trim(),
        content_markdown: contentMarkdown.trim(),
        audience,
        tone,
        is_active: isActive,
        start_at: startAt ? new Date(startAt).toISOString() : null,
        end_at: endAt ? new Date(endAt).toISOString() : null,
        button_text: buttonText.trim() || null,
        button_url: buttonUrl.trim() || null,
      }

      if (editingPopup) {
        await updateAdminPopup(editingPopup.id, payload)
        toast.success(t('popups.saved'))
      } else {
        await createAdminPopup(payload)
        toast.success(t('popups.created'))
      }

      cancelEdit()
      await loadPopups()
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Speichern des Pop-ups')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (popup: PanelPopup) => {
    const ok = await confirm({
      title: t('popups.deleteTitle'),
      message: t('popups.deleteConfirm'),
      danger: true,
      confirmText: t('common.delete'),
    })
    if (!ok) return

    try {
      await deleteAdminPopup(popup.id)
      toast.success(t('popups.deleted'))
      if (editingPopup?.id === popup.id) {
        cancelEdit()
      }
      await loadPopups()
    } catch (err: any) {
      toast.error(err.message || 'Fehler beim Löschen des Pop-ups')
    }
  }

  const openPreview = () => {
    setPreviewPopup({
      id: editingPopup?.id || 999999,
      title: title || 'Beispiel-Ankündigung',
      content_markdown: contentMarkdown || 'Hier steht der formatierte Textinhalt der Ankündigung.',
      audience,
      tone,
      is_active: isActive,
      start_at: startAt ? new Date(startAt).toISOString() : null,
      end_at: endAt ? new Date(endAt).toISOString() : null,
      button_text: buttonText || null,
      button_url: buttonUrl || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
  }

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-headline text-headline-sm text-primary">
            {t('popups.title')}
          </h2>
          <p className="font-body-md text-body-md text-on-surface-variant mt-1">
            {t('popups.subtitle')}
          </p>
        </div>
        {canWrite && !isCreating && !editingPopup && (
          <Button variant="primary" onClick={startCreate} className="shrink-0">
            <Plus className="w-4 h-4 mr-1.5" />
            {t('popups.newPopup')}
          </Button>
        )}
      </div>

      {/* Editor Form */}
      {(isCreating || editingPopup) && (
        <form onSubmit={handleSave} className="msm-card p-6 border-primary/40 space-y-5">
          <div className="flex items-center justify-between border-b border-outline-variant/30 pb-4">
            <h3 className="font-headline text-title-lg text-on-surface flex items-center gap-2">
              <Megaphone className="w-5 h-5 text-primary" />
              {isCreating ? t('popups.createHeader') : t('popups.editHeader')}
            </h3>
            <button
              type="button"
              onClick={cancelEdit}
              className="p-1 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="space-y-4">
            {/* Titel */}
            <div>
              <label htmlFor="popup-title-input" className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                {t('popups.fieldTitle')} *
              </label>
              <input
                id="popup-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z. B. Geplante Wartungsarbeiten am Samstag"
                required
                maxLength={255}
                className="msm-input"
              />
            </div>

            {/* Zielbereich & Darstellung */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="popup-audience-select" className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  {t('popups.fieldAudience')}
                </label>
                <Dropdown
                  id="popup-audience-select"
                  value={audience}
                  onChange={(value) => setAudience(value as PopupAudience)}
                  aria-label={t('popups.fieldAudience')}
                  options={[
                    { value: 'all', label: t('popups.audienceAll') },
                    { value: 'shop', label: t('popups.audienceShop') },
                    { value: 'panel', label: t('popups.audiencePanel') },
                  ]}
                />
              </div>
              <div>
                <label htmlFor="popup-tone-select" className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  {t('popups.fieldTone')}
                </label>
                <Dropdown
                  id="popup-tone-select"
                  value={tone}
                  onChange={(value) => setTone(value as PopupTone)}
                  aria-label={t('popups.fieldTone')}
                  options={[
                    { value: 'info', label: t('popups.toneInfo') },
                    { value: 'promo', label: t('popups.tonePromo') },
                    { value: 'maintenance', label: t('popups.toneMaintenance') },
                  ]}
                />
              </div>
            </div>

            {/* Markdown Toolbar, Content & Live-Vorschau */}
            <MarkdownFormatLeiste
              label={t('popups.fieldContent')}
              htmlFor="popup-content-input"
              required
              mode={editorMode}
              onModeChange={setEditorMode}
              onInsert={insertMarkdown}
              headingPrefix="### "
              headingLabel={t('popups.markdownHeading')}
              preview={
                <div
                  className={`mx-auto max-w-md rounded-2xl border bg-surface-container-high/95 p-4 shadow-xl backdrop-blur-xl ${
                    tone === 'promo'
                      ? 'border-primary/45 ring-1 ring-primary/20'
                      : tone === 'maintenance'
                        ? 'border-status-warning/45'
                        : 'border-primary/35'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
                        tone === 'maintenance'
                          ? 'bg-status-warning/15 text-status-warning'
                          : 'bg-primary/15 text-primary'
                      }`}
                    >
                      {tone === 'promo' ? (
                        <Sparkles className="h-4 w-4" aria-hidden="true" />
                      ) : tone === 'maintenance' ? (
                        <Wrench className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Megaphone className="h-4 w-4" aria-hidden="true" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-label-sm font-semibold ${
                            tone === 'maintenance'
                              ? 'border-status-warning/35 bg-status-warning/10 text-status-warning'
                              : 'border-primary/30 bg-primary/10 text-primary'
                          }`}
                        >
                          {tone === 'promo'
                            ? t('popups.tonePromo')
                            : tone === 'maintenance'
                              ? t('popups.toneMaintenance')
                              : t('popups.toneInfo')}
                        </span>
                        <span className="text-label-sm text-on-surface-variant">
                          {audience === 'shop'
                            ? t('popups.audienceShop')
                            : audience === 'panel'
                              ? t('popups.audiencePanel')
                              : t('popups.audienceAll')}
                        </span>
                      </div>
                      <h4 className="font-headline text-sm font-bold text-on-surface">
                        {title.trim() || t('popups.fieldTitle')}
                      </h4>
                      <div className="text-xs leading-relaxed text-on-surface-variant">
                        {contentMarkdown.trim() ? (
                          <AiMarkdown content={contentMarkdown} />
                        ) : (
                          <p>{t('popups.vorschauLeer')}</p>
                        )}
                      </div>
                      {buttonText.trim() && (
                        <div className="pt-1">
                          <span className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary">
                            <span>{buttonText.trim()}</span>
                            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              }
              footer={
                <div
                  id="popup-content-meta"
                  className="flex items-center justify-between gap-3 text-xs"
                >
                  <span className="text-on-surface-variant">
                    {t('popups.contentLengthHint')}
                  </span>
                  <span
                    className={
                      contentMarkdown.length > POPUP_CONTENT_MAX_LENGTH
                        ? 'font-medium text-status-destructive shrink-0'
                        : contentMarkdown.length >= POPUP_CONTENT_MAX_LENGTH - 60
                          ? 'font-medium text-status-warning shrink-0'
                          : 'text-on-surface-variant shrink-0'
                    }
                  >
                    {contentMarkdown.length} / {POPUP_CONTENT_MAX_LENGTH}
                  </span>
                </div>
              }
            >
              <textarea
                id="popup-content-input"
                ref={textareaRef}
                value={contentMarkdown}
                onChange={(e) => setContentMarkdown(e.target.value)}
                placeholder={t('popups.bodyPlaceholder')}
                rows={5}
                maxLength={POPUP_CONTENT_MAX_LENGTH}
                required
                aria-describedby="popup-content-meta"
                className="w-full bg-transparent px-3.5 py-3 font-mono text-sm leading-relaxed text-on-surface focus:outline-none"
              />
            </MarkdownFormatLeiste>

            {/* Zeitraum (Start / Ende) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  {t('popups.fieldStartAt')}
                </label>
                <DateTimePicker
                  value={startAt}
                  onChange={setStartAt}
                  locale={i18n.language.startsWith('de') ? 'de' : 'en'}
                  placeholder={t('popups.noStartAt')}
                  aria-label={t('popups.fieldStartAt')}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  {t('popups.fieldEndAt')}
                </label>
                <DateTimePicker
                  value={endAt}
                  onChange={setEndAt}
                  locale={i18n.language.startsWith('de') ? 'de' : 'en'}
                  placeholder={t('popups.noEndAt')}
                  aria-label={t('popups.fieldEndAt')}
                  className="w-full"
                />
              </div>
            </div>

            {/* Optionaler Aktions-Button */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  {t('popups.fieldButtonText')}
                </label>
                <input
                  type="text"
                  value={buttonText}
                  onChange={(e) => setButtonText(e.target.value)}
                  placeholder={t('popups.buttonTextPlaceholder')}
                  maxLength={100}
                  className="msm-input"
                />
              </div>
              <div>
                <label htmlFor="popup-button-url-input" className="block font-label-md text-label-md text-on-surface-variant mb-1.5 uppercase tracking-wider">
                  {t('popups.fieldButtonUrl')}
                </label>
                <input
                  id="popup-button-url-input"
                  type="text"
                  value={buttonUrl}
                  onChange={(e) => setButtonUrl(e.target.value)}
                  placeholder="/shop oder https://status.example.com"
                  maxLength={2048}
                  className="msm-input"
                />
                <p className="text-xs text-on-surface-variant mt-1">
                  {t('popups.buttonUrlHint')}
                </p>
              </div>
            </div>

            {/* Aktiv-Schalter */}
            <div className="flex items-center justify-between pt-2">
              <div>
                <span id="popup-aktiv-name" className="font-label-lg text-label-lg text-on-surface font-medium block">
                  {t('popups.fieldIsActive')}
                </span>
                <span id="popup-aktiv-hinweis" className="text-body-sm text-on-surface-variant block">
                  {t('popups.fieldIsActiveHint')}
                </span>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} aria-labelledby="popup-aktiv-name" aria-describedby="popup-aktiv-hinweis" />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-outline-variant/30">
            <Button type="button" variant="secondary" onClick={openPreview}>
              <Eye className="w-4 h-4 mr-1.5" />
              {t('popups.alsModalTesten')}
            </Button>
            <Button type="button" variant="ghost" onClick={cancelEdit}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="primary" disabled={saving}>
              <Save className="w-4 h-4 mr-1.5" />
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      )}

      {/* Liste bestehender Popups */}
      <div className="msm-card overflow-hidden">
        <div className="p-5 border-b border-outline-variant/30 bg-surface-container-high/30">
          <h3 className="font-headline text-title-md text-on-surface">
            {t('popups.listTitle')}
          </h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Spinner size="lg" className="text-primary" />
          </div>
        ) : popups.length === 0 ? (
          <div className="p-8 text-center text-on-surface-variant">
            <Megaphone className="w-10 h-10 mx-auto mb-2 opacity-40 text-primary" />
            <p className="font-body-md text-body-md font-medium">
              {t('popups.empty')}
            </p>
            <p className="text-body-sm text-on-surface-variant/80 mt-1">
              {t('popups.emptyHint')}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-outline-variant/20">
            {popups.map((p) => {
              const now = new Date()
              const isExpired = p.end_at && new Date(p.end_at) < now
              const isFuture = p.start_at && new Date(p.start_at) > now

              return (
                <div
                  key={p.id}
                  className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-surface-container-high/20 transition-colors"
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-headline text-title-md text-on-surface font-semibold truncate">
                        {p.title}
                      </span>
                      {p.is_active && !isExpired && !isFuture && (
                        <span className="msm-badge-success flex items-center gap-1 text-xs">
                          <CheckCircle className="w-3 h-3" />
                          {t('common.active')}
                        </span>
                      )}
                      {p.is_active && isFuture && (
                        <span className="msm-badge-info flex items-center gap-1 text-xs">
                          <Clock className="w-3 h-3" />
                          {t('popups.statusScheduled')}
                        </span>
                      )}
                      {isExpired && (
                        <span className="msm-badge-warning flex items-center gap-1 text-xs">
                          {t('popups.statusExpired')}
                        </span>
                      )}
                      {!p.is_active && (
                        <span className="msm-badge-neutral text-xs">
                          {t('popups.statusInactive')}
                        </span>
                      )}
                      <span className="msm-badge-neutral text-xs">
                        {p.audience === 'shop'
                          ? t('popups.audienceShop')
                          : p.audience === 'panel'
                            ? t('popups.audiencePanel')
                            : t('popups.audienceAll')}
                      </span>
                      <span
                        className={`${
                          p.tone === 'maintenance'
                            ? 'msm-badge-warning'
                            : p.tone === 'promo'
                              ? 'msm-badge-info'
                              : 'msm-badge-neutral'
                        } text-xs`}
                      >
                        {p.tone === 'maintenance'
                          ? t('popups.toneMaintenance')
                          : p.tone === 'promo'
                            ? t('popups.tonePromo')
                            : t('popups.toneInfo')}
                      </span>
                    </div>

                    <p className="text-body-sm text-on-surface-variant line-clamp-2 font-mono">
                      {p.content_markdown}
                    </p>

                    {(p.start_at || p.end_at || p.button_text) && (
                      <div className="flex items-center gap-4 text-xs text-on-surface-variant/80 pt-1">
                        {(p.start_at || p.end_at) && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            {p.start_at ? new Date(p.start_at).toLocaleDateString() : 'Sofort'} –{' '}
                            {p.end_at ? new Date(p.end_at).toLocaleDateString() : 'Unbegrenzt'}
                          </span>
                        )}
                        {p.button_text && (
                          <span className="flex items-center gap-1 text-primary">
                            <ExternalLink className="w-3.5 h-3.5" />
                            Button: {p.button_text}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setPreviewPopup(p)}
                    >
                      <Eye className="w-4 h-4 mr-1" />
                      {t('common.preview')}
                    </Button>
                    {canWrite && (
                      <>
                        <Kurzinfo text={t('common.edit')}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startEdit(p)}
                            aria-label={t('common.edit')}
                          >
                            <Edit2 className="w-4 h-4" />
                          </Button>
                        </Kurzinfo>
                        <Kurzinfo text={t('common.delete')} seite="ende">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDelete(p)}
                            aria-label={t('common.delete')}
                            className="text-on-surface-variant hover:text-status-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </Kurzinfo>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Live Preview Modal */}
      {previewPopup && (
        <PanelPopupModal
          popup={previewPopup}
          isPreview={true}
          onClose={() => setPreviewPopup(null)}
        />
      )}
    </div>
  )
}
