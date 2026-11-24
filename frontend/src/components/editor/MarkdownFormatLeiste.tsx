import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Bold,
  Code,
  Eye,
  Heading,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  PencilLine,
} from 'lucide-react'
import { Kurzinfo } from '@maunting/ui'

export interface MarkdownFormatLeisteProps {
  label: string
  htmlFor?: string
  required?: boolean
  mode: 'write' | 'preview'
  onModeChange: (mode: 'write' | 'preview') => void
  onInsert: (prefix: string, suffix?: string) => void
  headingPrefix?: string
  headingLabel?: string
  linkSuffix?: string
  writeLabel?: string
  previewLabel?: string
  preview: ReactNode
  footer?: ReactNode
  children: ReactNode
}

/**
 * Gemeinsame Markdown-Formatleiste samt Schreiben/Live-Vorschau-Umschalter
 * für Pop-up-Ankündigungen und News-Beiträge.
 */
export function MarkdownFormatLeiste({
  label,
  htmlFor,
  required = false,
  mode,
  onModeChange,
  onInsert,
  headingPrefix = '### ',
  headingLabel,
  linkSuffix = '](https://example.com)',
  writeLabel,
  previewLabel,
  preview,
  footer,
  children,
}: MarkdownFormatLeisteProps) {
  const { t } = useTranslation()

  const resolvedWriteLabel = writeLabel || t('popups.modusSchreiben')
  const resolvedPreviewLabel = previewLabel || t('popups.modusVorschau')
  const resolvedHeadingLabel = headingLabel || t('popups.markdownHeading')

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor={htmlFor}
          className="block font-label-md text-xs font-semibold uppercase tracking-wider text-on-surface-variant"
        >
          {label}
          {required ? ' *' : ''}
        </label>

        <div className="flex items-center gap-1 rounded-xl border border-outline-variant/40 bg-surface-container-low p-1">
          <button
            type="button"
            onClick={() => onModeChange('write')}
            aria-pressed={mode === 'write'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
              mode === 'write'
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{resolvedWriteLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('preview')}
            aria-pressed={mode === 'preview'}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
              mode === 'preview'
                ? 'bg-primary text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{resolvedPreviewLabel}</span>
          </button>
        </div>
      </div>

      {mode === 'write' ? (
        <div className="overflow-hidden rounded-xl border border-outline-variant/50 bg-surface-container-low focus-within:border-primary">
          <div className="flex flex-wrap items-center gap-1 border-b border-outline-variant/30 bg-surface-container/60 px-2.5 py-1.5">
            <Kurzinfo text={t('popups.markdownBold')}>
              <button
                type="button"
                aria-label={t('popups.markdownBold')}
                onClick={() => onInsert('**', '**')}
                className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Bold className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
            <Kurzinfo text={t('popups.markdownItalic')}>
              <button
                type="button"
                aria-label={t('popups.markdownItalic')}
                onClick={() => onInsert('*', '*')}
                className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Italic className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
            <Kurzinfo text={resolvedHeadingLabel}>
              <button
                type="button"
                aria-label={resolvedHeadingLabel}
                onClick={() => onInsert(headingPrefix)}
                className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Heading className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
            <Kurzinfo text={t('popups.markdownList')}>
              <button
                type="button"
                aria-label={t('popups.markdownList')}
                onClick={() => onInsert('- ')}
                className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <List className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
            <Kurzinfo text={t('popups.markdownOrderedList')}>
              <button
                type="button"
                aria-label={t('popups.markdownOrderedList')}
                onClick={() => onInsert('1. ')}
                className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <ListOrdered className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
            <Kurzinfo text={t('popups.markdownLink')}>
              <button
                type="button"
                aria-label={t('popups.markdownLink')}
                onClick={() => onInsert('[', linkSuffix)}
                className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <LinkIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
            <Kurzinfo text={t('popups.markdownCode')} seite="ende">
              <button
                type="button"
                aria-label={t('popups.markdownCode')}
                onClick={() => onInsert('`', '`')}
                className="rounded-lg p-1.5 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
              >
                <Code className="h-4 w-4" aria-hidden="true" />
              </button>
            </Kurzinfo>
          </div>
          {children}
        </div>
      ) : (
        <div className="min-h-[190px] rounded-xl border border-outline-variant/50 bg-surface-container-low/70 p-4">
          {preview}
        </div>
      )}

      {footer}
    </div>
  )
}
