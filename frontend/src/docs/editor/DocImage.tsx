import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { assetUrl, getAssetSignedUrl } from '@/api/docs'

/**
 * Bilder im Dokument zeigen nie eine eingefrorene signierte URL.
 *
 * Der Server gibt signierte URLs mit kurzer Frist aus. Stünde die URL im
 * Yjs-Knoten, wäre jedes Bild nach einer Stunde tot. Der Knoten trägt deshalb
 * die `asset_uid`; die Ansicht holt beim Öffnen und danach regelmäßig eine
 * frische URL.
 */
export function DocImageNodeView({ node, extension, selected }: NodeViewProps) {
  const { t } = useTranslation()
  const assetUid = typeof node.attrs.assetUid === 'string' ? node.attrs.assetUid : null
  const docUid = String(extension.options.docUid ?? '')
  const [bild, setBild] = useState<{ assetUid: string; docUid: string; src: string } | null>(null)
  const src = bild?.assetUid === assetUid && bild.docUid === docUid ? bild.src : ''

  useEffect(() => {
    if (!assetUid || !docUid) return
    let aktiv = true
    const laden = async () => {
      try {
        const { signed_url } = await getAssetSignedUrl(docUid, assetUid, 3600)
        if (aktiv) setBild({ assetUid, docUid, src: assetUrl(signed_url) })
      } catch {
        if (aktiv) setBild(null)
      }
    }
    void laden()
    const timer = window.setInterval(() => void laden(), 45 * 60 * 1000)
    return () => {
      aktiv = false
      window.clearInterval(timer)
    }
  }, [assetUid, docUid])

  return (
    <NodeViewWrapper
      as="span"
      className={`docs-image inline-block max-w-full ${selected ? 'ring-2 ring-primary/60' : ''}`}
    >
      {!src ? (
        <span className="inline-flex rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
          {t('docs.editor.imageUnavailable')}
        </span>
      ) : (
        <img
          src={src}
          alt={String(node.attrs.alt ?? '')}
          draggable={false}
          className="max-w-full rounded-lg"
        />
      )}
    </NodeViewWrapper>
  )
}
