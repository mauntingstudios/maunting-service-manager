import { useState } from 'react'
import { Camera, HardDrive, Loader2, Paperclip, Plug, Plus, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Kurzinfo } from '@maunting/ui'

const ATTACHMENT_ACCEPT = '*/*'

interface Props {
  singraShell: boolean
  canAttach: boolean
  busy: boolean
  uploading: boolean
  fileInputRef: React.RefObject<HTMLInputElement | null>
  uploadFiles: (dateien: FileList | File[] | null | undefined) => Promise<void>
  onKamera: () => void
  onSpeicher: () => void
  onTools: () => void
}

/** Aktionsknopf mit Menue fuer Datei, Foto, Speicher und MCP-Werkzeuge. */
export function AiChatPlusMenue({
  singraShell,
  canAttach,
  busy,
  uploading,
  fileInputRef,
  uploadFiles,
  onKamera,
  onSpeicher,
  onTools,
}: Props) {
  const { t } = useTranslation()
  const [plusMenuOffen, setPlusMenuOffen] = useState(false)

  if (!canAttach) return null

  return (
    <>
      {singraShell ? (
                            <div className="relative shrink-0">
                              <Kurzinfo text="Aktionen & Anhänge" lage="oben" seite="anfang">
                                <button
                                  type="button"
                                  onClick={() => setPlusMenuOffen((v) => !v)}
                                  className={`grid h-8 w-8 place-items-center rounded-full transition-colors border border-white/15 bg-white/5 text-white/80 hover:bg-white/15 hover:text-white ${
                                    busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                                  }`}
                                  aria-label="Aktionen und Anhänge"
                                  aria-expanded={plusMenuOffen}
                                >
                                  {uploading ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                  ) : (
                                    <Plus
                                      className={`h-3.5 w-3.5 transition-transform duration-200 ${
                                        plusMenuOffen ? 'rotate-45' : ''
                                      }`}
                                      aria-hidden="true"
                                    />
                                  )}
                                </button>
                              </Kurzinfo>

                              {plusMenuOffen && (
                                <>
                                  <div
                                    className="fixed inset-0 z-40"
                                    onClick={() => setPlusMenuOffen(false)}
                                    aria-hidden="true"
                                  />
                                  <div
                                    role="menu"
                                    className="absolute bottom-11 left-0 z-50 w-56 rounded-2xl border border-outline-variant/40 bg-surface-container-high/95 p-1.5 shadow-2xl backdrop-blur-xl animate-fade-in text-on-surface text-xs"
                                  >
                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-white/90 hover:bg-white/10 hover:text-white transition-colors"
                                      onClick={() => {
                                        setPlusMenuOffen(false)
                                        fileInputRef.current?.click()
                                      }}
                                    >
                                      <Upload className="h-4 w-4 text-primary" aria-hidden="true" />
                                      <span className="font-medium">Datei hochladen</span>
                                    </button>

                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-white/90 hover:bg-white/10 hover:text-white transition-colors"
                                      onClick={() => {
                                        setPlusMenuOffen(false)
                                        onKamera()
                                      }}
                                    >
                                      <Camera className="h-4 w-4 text-primary" aria-hidden="true" />
                                      <span className="font-medium">Foto aufnehmen</span>
                                    </button>

                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-white/90 hover:bg-white/10 hover:text-white transition-colors"
                                      onClick={() => {
                                        setPlusMenuOffen(false)
                                        onSpeicher()
                                      }}
                                    >
                                      <HardDrive className="h-4 w-4 text-primary" aria-hidden="true" />
                                      <span className="font-medium">Aus KI-Speicher wählen</span>
                                    </button>

                                    <button
                                      type="button"
                                      role="menuitem"
                                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-white/90 hover:bg-white/10 hover:text-white transition-colors"
                                      onClick={() => {
                                        setPlusMenuOffen(false)
                                        onTools()
                                      }}
                                    >
                                      <Plug className="h-4 w-4 text-primary" aria-hidden="true" />
                                      <span className="font-medium">Tools & MCP-Integrationen</span>
                                    </button>
                                  </div>
                                </>
                              )}

                              <input
                                ref={fileInputRef as React.Ref<HTMLInputElement>}
                                type="file"
                                className="sr-only"
                                disabled={busy}
                                accept={ATTACHMENT_ACCEPT}
                                multiple
                                aria-label={t('ai.attachments.add')}
                                onChange={(event) => {
                                  void uploadFiles(event.target.files)
                                  event.target.value = ''
                                }}
                              />
                            </div>
                          ) : (
                            <Kurzinfo text={t('ai.attachments.add')} lage="oben" seite="anfang" aussen="shrink-0">
                              <label
                                className={`grid h-8 w-8 place-items-center rounded-full transition-colors text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface ${
                                  busy ? 'pointer-events-none opacity-50' : 'cursor-pointer'
                                }`}
                              >
                                {uploading ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                                )}
                                <input
                                  type="file"
                                  className="sr-only"
                                  disabled={busy}
                                  accept={ATTACHMENT_ACCEPT}
                                  multiple
                                  aria-label={t('ai.attachments.add')}
                                  onChange={(event) => {
                                    void uploadFiles(event.target.files)
                                    event.target.value = ''
                                  }}
                                />
                              </label>
                            </Kurzinfo>
      )}
    </>
  )
}
