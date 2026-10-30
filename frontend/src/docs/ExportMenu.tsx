import { Download, FileCode2, FileText, Printer } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ActionMenu } from '@/Singra/UI'
import { toast } from '@/stores/toastStore'
import { downloadExport } from '@/api/docs'

interface ExportMenuProps {
  uid: string
  rev?: number
  disabled?: boolean
}

function speichern(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function ExportMenu({ uid, rev, disabled }: ExportMenuProps) {
  const { t } = useTranslation()

  const laden = async (format: 'html' | 'md' | 'txt') => {
    try {
      const { blob, filename } = await downloadExport(uid, format, rev)
      speichern(blob, filename)
    } catch {
      toast.error(t('docs.errors.DOCS_SIDECAR_UNAVAILABLE'))
    }
  }

  const drucken = async () => {
    try {
      const { blob } = await downloadExport(uid, 'html', rev)
      const url = URL.createObjectURL(blob)
      const fenster = window.open(url, '_blank', 'noopener,noreferrer')
      if (!fenster) {
        speichern(blob, `dokument-${uid.slice(0, 8)}.html`)
        toast.success(t('docs.export.downloaded'))
        return
      }
      setTimeout(() => {
        try {
          fenster.print()
        } catch {
          /* Der Nutzer druckt aus dem neuen Fenster. */
        }
      }, 600)
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      toast.error(t('docs.errors.DOCS_SIDECAR_UNAVAILABLE'))
    }
  }

  return (
    <ActionMenu
      label={t('docs.export.label')}
      ariaLabel={t('docs.export.label')}
      icon={<Download className="h-5 w-5" />}
      iconOnly
      variant="ghost"
      compact
      surface="dna"
      disabled={disabled}
      align="end"
      items={[
        { key: 'html', label: t('docs.export.html'), icon: <FileCode2 className="h-4 w-4" />, onSelect: () => void laden('html') },
        { key: 'md', label: t('docs.export.markdown'), icon: <FileText className="h-4 w-4" />, onSelect: () => void laden('md') },
        { key: 'txt', label: t('docs.export.text'), icon: <FileText className="h-4 w-4" />, onSelect: () => void laden('txt') },
        { key: 'print', label: t('docs.export.print'), icon: <Printer className="h-4 w-4" />, separatorBefore: true, onSelect: () => void drucken() },
      ]}
    />
  )
}
