import { useState, useMemo, type MutableRefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Menu, Plus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { Button, Kurzinfo, Zustandsflaeche } from '@maunting/ui'
import { TageszeitHintergrund } from '@/components/layout/TageszeitHintergrund'
import { begruessungSchluessel, tagesSeed, useTageszeitMotiv } from '@/lib/tageszeit'
import type { DocDetail, UploadGrenzen } from '@/api/docs'
import { DocEditor } from './DocEditor'
import type { OutlineEntry } from './editor/Outline'
import { useDocsStore } from './docsStore'
import type { PendingEdits } from './usePendingEdits'
import type { DocsFehlerInfo } from './docsFehler'

interface DocsMainProps {
  uid: string | undefined
  detail: DocDetail | null
  detailFehler: DocsFehlerInfo | null
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

const rundknopf =
  'flex items-center justify-center rounded-full h-10 w-10 sm:h-9 sm:w-9 bg-surface-container-high/85 hover:bg-surface-container-high text-on-surface hover:text-primary border border-outline-variant/30 backdrop-blur-md shadow-sm transition-all active:scale-95'

/** Kopfzeile und Editor mit seinen Ladezuständen (Befund 21). */
export function DocsMain({
  uid,
  detail,
  detailFehler,
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
  const [jetzt] = useState(() => new Date())
  const stunde = jetzt.getHours()
  const zufall = useMemo(() => tagesSeed(jetzt), [jetzt])
  const headerMotiv = useTageszeitMotiv('docs')
  const begruessung = userName
    ? t(begruessungSchluessel(stunde, false, zufall), { name: userName })
    : t('common.begruessung.ohneName')

  const fehlerTitel = offlineOhneKopie
    ? t('docs.offline.noCopyTitle')
    : detailFehler?.code
      ? t(`docs.errors.${detailFehler.code}`, { defaultValue: t('docs.fehler.list') })
      : t('docs.fehler.list')

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
      <div className="relative z-30 flex shrink-0 items-center gap-2.5 border-b border-outline-variant/30 bg-surface-container px-3 pt-[calc(var(--msm-oben-sicher,0px)+0.5rem)] pb-2.5 md:hidden">
        <Kurzinfo text={t('docs.tree.open')}>
          <button
            type="button"
            onClick={() => setTreeOffen(true)}
            aria-label={t('docs.tree.open')}
            className={rundknopf}
          >
            <Menu className="h-4 w-4" />
          </button>
        </Kurzinfo>
        <div className="flex min-w-0 flex-1 flex-col justify-center">
          <span className="truncate font-headline text-sm font-semibold text-on-surface">
            {detail?.title ?? t('docs.title')}
          </span>
        </div>
        <Kurzinfo text={t('docs.new')}>
          <button
            type="button"
            onClick={() => void neueDokument()}
            aria-label={t('docs.new')}
            className={rundknopf}
          >
            <Plus className="h-4 w-4" />
          </button>
        </Kurzinfo>
      </div>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {fehler && (
          <div className="p-4">
            <Zustandsflaeche art="fehler" titel={t('docs.list.errorTitle')} text={fehler} erneutLabel={t('common.retry')} onErneut={() => void listeLaden()} />
          </div>
        )}
        {!fehler && !uid && (
          <div className="relative isolate flex flex-1 flex-col overflow-y-auto">
            {/* Weicher atmosphärischer Tageszeit-Hintergrund für Docs */}
            <TageszeitHintergrund
              motiv={headerMotiv}
              hoehe="h-[520px] sm:h-[580px] lg:h-[640px]"
              deckkraft="opacity-55"
              ebene="-z-10"
            />

            <div className="relative z-10 flex flex-1 flex-col p-4 sm:p-6 space-y-6">
              {/* Freischwebender Docs-Header mit Tageszeit-Begrüßung und Aktion */}
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
                    <FileText className="h-4 w-4" aria-hidden="true" />
                    <span>{t('docs.title')}</span>
                  </div>
                  <h1 className="mt-1 font-headline text-2xl sm:text-3xl font-extrabold tracking-tight text-on-surface">
                    {begruessung}
                  </h1>
                  <p className="mt-1 text-xs sm:text-sm text-on-surface-variant max-w-xl leading-relaxed">
                    {t('docs.list.emptyText')}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button onClick={() => void neueDokument()} className="gap-1.5 rounded-xl font-medium shadow-sm">
                    <Plus className="w-4 h-4" />
                    <span>{t('docs.new')}</span>
                  </Button>
                </div>
              </div>

              <div className="flex flex-1 items-center justify-center py-6">
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
            </div>
          </div>
        )}
        {uid && detailFehler && (
          <div className="flex flex-1 items-center justify-center p-6">
            <Zustandsflaeche
              art={offlineOhneKopie ? 'offline' : 'fehler'}
              titel={fehlerTitel}
              text={offlineOhneKopie ? t('docs.offline.noCopyText') : detailFehler.text}
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
