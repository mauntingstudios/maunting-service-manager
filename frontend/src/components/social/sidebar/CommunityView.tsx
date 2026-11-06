import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Plus, Search, Share2, UsersRound } from 'lucide-react'
import { Button, Input, Kurzinfo } from '@maunting/ui'
import type { ChatGroupItem } from '@/api/social'

interface CommunityViewProps {
  gruppen: ChatGroupItem[]
  onGruppe: (gruppe: ChatGroupItem) => void
  onNeueGruppe: () => void
  onEinladungKopieren: (gruppe: ChatGroupItem) => void
  aktiveGruppeId?: number
  ungeleseneNachrichten?: Record<string, number>
  gruppenMailboxMap?: Record<number, string>
}

/** Der Reiter „Community": alle Gruppen samt Einladungslink und Suchfunktion. */
export function CommunityView({
  gruppen,
  onGruppe,
  onNeueGruppe,
  onEinladungKopieren,
  aktiveGruppeId,
  ungeleseneNachrichten = {},
  gruppenMailboxMap = {},
}: CommunityViewProps) {
  const { t } = useTranslation()
  const [suche, setSuche] = useState('')

  const gefiltert = gruppen.filter((g) =>
    (g.name || '').toLowerCase().includes(suche.trim().toLowerCase()),
  )

  return (
    <div className="space-y-3 p-2">
      {/* Kopfzeile mit Zähler und Aktion */}
      <div className="flex items-center justify-between px-1 pt-1">
        <div>
          <div className="text-xs font-headline font-bold text-white flex items-center gap-1.5">
            <UsersRound className="w-4 h-4 text-primary" />
            <span>{t('messenger.communitiesTitle')}</span>
            <span className="text-label-sm text-white/50">({gruppen.length})</span>
          </div>
          <p className="text-label-sm text-white/60">
            {t('messenger.communitySubtitle')}
          </p>
        </div>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onNeueGruppe}
          className="h-8 text-xs gap-1.5 px-3 rounded-full shadow-sm"
          aria-label={t('messenger.newGroup')}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{t('messenger.createGroup')}</span>
        </Button>
      </div>

      {/* Schnelle Gruppensuche */}
      {gruppen.length > 3 && (
        <div className="relative px-0.5">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/40" />
          <Input
            value={suche}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSuche(e.target.value)}
            placeholder="Gruppen durchsuchen..."
            className="text-xs pl-8 h-8 rounded-full bg-white/5 border-white/10 text-white placeholder:text-white/40 focus:border-primary/50 transition-all"
          />
        </div>
      )}

      {/* Gruppenliste */}
      <div className="space-y-1.5 pt-1">
        {gefiltert.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10 text-white/40 flex items-center justify-center mx-auto">
              <UsersRound className="w-6 h-6" />
            </div>
            <p className="text-xs text-white/60">
              {suche.trim() ? 'Keine passende Gruppe gefunden.' : t('messenger.noGroupsJoined')}
            </p>
            {!suche.trim() && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onNeueGruppe}
                className="rounded-full text-xs"
              >
                Erste Gruppe gründen
              </Button>
            )}
          </div>
        ) : (
          gefiltert.map((g) => {
            const mid = gruppenMailboxMap[g.id]
            const ungelesen = mid ? ungeleseneNachrichten[mid] || 0 : 0
            const istAktiv = aktiveGruppeId === g.id

            return (
              <div
                key={`comm-g-${g.id}`}
                className={`group flex items-center justify-between p-2.5 rounded-2xl border transition-all cursor-pointer ${
                  istAktiv
                    ? 'bg-primary/20 border-primary/40 shadow-sm'
                    : 'bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20'
                }`}
                onClick={() => onGruppe(g)}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="relative w-10 h-10 rounded-2xl bg-primary/20 text-primary border border-primary/30 flex items-center justify-center font-bold text-xs shrink-0 shadow-sm overflow-hidden">
                    {g.avatar_url ? (
                      <img src={g.avatar_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <UsersRound className="w-5 h-5 text-primary" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white truncate group-hover:text-primary transition-colors">
                        {g.name}
                      </span>
                      {ungelesen > 0 && (
                        <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-on-primary text-label-sm font-bold flex items-center justify-center shrink-0">
                          {ungelesen > 99 ? '99+' : ungelesen}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-white/50 flex items-center gap-1.5 mt-0.5">
                      <span>{g.member_count} Mitglieder</span>
                    </div>
                  </div>
                </div>

                {g.invite_code && (
                  <div className="shrink-0 ml-2" onClick={(e) => e.stopPropagation()}>
                    <Kurzinfo text={t('messenger.copyInvite')} seite="ende">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onEinladungKopieren(g)}
                        className="h-8 w-8 p-0 rounded-full text-white/60 hover:text-white hover:bg-white/10"
                        aria-description={t('messenger.copyInvite')}
                      >
                        <Share2 className="w-3.5 h-3.5" />
                      </Button>
                    </Kurzinfo>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
