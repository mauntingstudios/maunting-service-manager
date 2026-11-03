import type { MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Menu, Plus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { Button, Kurzinfo, Zustandsflaeche } from '@/Singra/UI'
import type { DocDetail, UploadGrenzen } from '@/api/docs'
import { DocEditor } from './DocEditor'
import type { OutlineEntry } from './editor/Outline'
import { useDocsStore } from './docsStore'
import type { PendingEdits } from './usePendingEdits'

interface DocsMainProps {
  uid: string | undefined
  detail: DocDetail | null
  detailFehler: string | null
  detailFehlerCode: string | null
  fehler: string | null
  online: boolean
  userId: number
  userName: string
  offlineOhneKopie: boolean
  grenzen: UploadGrenzen | undefined
  outlineJumpRef: MutableRefObject<((pos: number) => void) | null>
  pending: PendingEdits
  listeLaden: () => void
  detailLaden: (docUid: string) => void
  panelDatenLaden: () => void
  titelAendern: (titel: string) => Promise<void>
  neueDokument: () => void
  onOutlineChange: (eintraege: OutlineEntry[]) => void
}

/** Kopfzeile und Editor mit seinen Ladezuständen (Befund 21). */
export function DocsMain({
  uid,
  detail,
  detailFehler,
  detailFehlerCode,
  fehler,
  online,
  userId,
  userName,
  offlineOhneKopie,
  grenzen,
  outlineJumpRef,
  pending,
  listeLaden,
  detailLaden,
  panelDatenLaden,
  titelAendern,
  neueDokument,
  onOutlineChange,
}: DocsMainProps) {
  const { t } = useTranslation()
  const { panel, setPanel, setShareOpen, setMembersOpen, setSelection, setTreeOffen } =
    useDocsStore(
      useShallow((state) => ({
        panel: state.panel,
        setPanel: state.setPanel,
        setShareOpen: state.setShareOpen,
        setMembersOpen: state.setMembersOpen,
        setSelection: state.setSelection,
        setTreeOffen: state.setTreeOffen,
      })),
    )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b border-outline-variant/40 bg-surface-container px-3 py-2 md:hidden">
        <Kurzinfo text={t('docs.tree.open')}>
          <Button variant="ghost" size="sm" onClick={() => setTreeOffen(true)} aria-label={t('docs.tree.open')}>
            <Menu className="h-4 w-4" />
          </Button>
        </Kurzinfo>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-on-surface">
          {detail?.title ?? t('docs.title')}
        </span>
        <Kurzinfo text={t('docs.new')}>
          <Button variant="primary" size="sm" onClick={() => void neueDokument()} aria-label={t('docs.new')}>
            <Plus className="h-4 w-4" />
          </Button>
        </Kurzinfo>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {fehler && (
          <div className="p-4">
            <Zustandsflaeche art="fehler" titel={t('docs.list.errorTitle')} text={fehler} erneutLabel={t('common.retry')} onErneut={() => void listeLaden()} />
          </div>
        )}
        {!fehler && !uid && (
          <div className="flex flex-1 items-center justify-center p-6">
            <Zustandsflaeche
              art="leer"
              titel={t('docs.list.emptyTitle')}
              text={t('docs.list.emptyText')}
            >
              <Button onClick={() => void neueDokument()}>
                <Plus className="mr-1 h-4 w-4" />
                {t('docs.new')}
              </Button>
            </Zustandsflaeche>
          </div>
        )}
        {uid && detailFehler && (
          <div className="flex flex-1 items-center justify-center p-6">
            <Zustandsflaeche
              art={offlineOhneKopie ? 'offline' : 'fehler'}
              titel={
                offlineOhneKopie
                  ? t('docs.offline.noCopyTitle')
                  : detailFehlerCode
                    ? t(`docs.errors.${detailFehlerCode}`, { defaultValue: t('docs.fehler.list') })
                    : t('docs.fehler.list')
              }
              text={offlineOhneKopie ? t('docs.offline.noCopyText') : detailFehler}
              erneutLabel={t('common.retry')}
              onErneut={() => void detailLaden(uid)}
            />
          </div>
        )}
        {uid && detail && (
          <DocEditor
            key={detail.uid}
            detail={detail}
            userId={userId}
            userName={userName}
            online={online}
            activePanel={panel}
            onOpenPanel={setPanel}
            onOpenShare={() => setShareOpen(true)}
            onOpenMembers={() => setMembersOpen(true)}
            onCommentsChanged={() => void panelDatenLaden()}
            onTitleChanged={titelAendern}
            onSelectionChange={setSelection}
            onOutlineChange={onOutlineChange}
            outlineJumpRef={outlineJumpRef}
            vorschlag={pending.vorschlag}
            vorschlagBusy={pending.vorschlagBusy}
            onApplyVorschlag={() => void pending.vorschlagAnwenden()}
            onRejectVorschlag={() => void pending.vorschlagVerwerfen()}
            grenzen={grenzen}
          />
        )}
      </main>
    </div>
  )
}
