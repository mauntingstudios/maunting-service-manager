import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Copy,
  Forward,
  ListChecks,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  Reply,
  Search,
  Sparkles,
  Star,
  StarOff,
  Users,
} from 'lucide-react'
import {
  Blatteintrag,
  Blattmenue,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from '@maunting/ui'
import { aiApi, type AiConversationSummary, type AiMessage } from '@/api/ai'
import { getDirectChats, getFriends, getGroups, type ChatGroupItem } from '@/api/social'
import { Avatar } from '@/components/app/Avatar'
import { entwurfUebergeben } from '@/lib/aiEntwurf'
import { benenneGruppen } from '@/services/gruppenName'
import { toast } from '@/stores/toastStore'

export interface AiNachrichtenMenueProps {
  message: AiMessage | null
  isStarred: boolean
  canEdit: boolean
  onClose: () => void
  onReply: (msg: AiMessage) => void
  onForward: (msg: AiMessage) => void
  onCopy: (msg: AiMessage) => void
  onToggleStar: (msg: AiMessage) => void
  onStartMultiSelect: (msg: AiMessage) => void
  onEdit: (msg: AiMessage) => void
}

export function AiNachrichtenMenue({
  message,
  isStarred,
  canEdit,
  onClose,
  onReply,
  onForward,
  onCopy,
  onToggleStar,
  onStartMultiSelect,
  onEdit,
}: AiNachrichtenMenueProps) {
  if (!message) return null

  const runAndClose = (fn: (m: AiMessage) => void) => () => {
    onClose()
    fn(message)
  }

  return (
    <Blattmenue
      offen
      onSchliessen={onClose}
      titel="Nachrichtenaktionen"
      className="bg-surface-container-high/95 backdrop-blur-2xl border border-outline-variant/30 text-on-surface shadow-2xl"
    >
      <div className="py-1">
        <Blatteintrag
          icon={<Reply className="h-4 w-4" />}
          label="Antworten"
          hinweis="Nachricht im Eingabefeld zitieren"
          onClick={runAndClose(onReply)}
        />
        <Blatteintrag
          icon={<Forward className="h-4 w-4" />}
          label="Weiterleiten"
          hinweis="An Messenger-Chat oder Singra-Unterhaltung senden"
          onClick={runAndClose(onForward)}
        />
        {message.content && (
          <Blatteintrag
            icon={<Copy className="h-4 w-4" />}
            label="Text kopieren"
            onClick={runAndClose(onCopy)}
          />
        )}
        <Blatteintrag
          icon={isStarred ? <StarOff className="h-4 w-4" /> : <Star className="h-4 w-4" />}
          label={isStarred ? 'Markierung aufheben' : 'Markieren'}
          hinweis="Mit Stern hervorheben"
          onClick={runAndClose(onToggleStar)}
        />
        <Blatteintrag
          icon={<ListChecks className="h-4 w-4" />}
          label="Mehrere auswählen"
          onClick={runAndClose(onStartMultiSelect)}
        />
        {canEdit && message.role === 'user' && message.content && (
          <Blatteintrag
            icon={<Pencil className="h-4 w-4" />}
            label="Bearbeiten"
            hinweis="Nachricht anpassen und Antwort neu generieren"
            onClick={runAndClose(onEdit)}
          />
        )}
      </div>
    </Blattmenue>
  )
}

interface MessengerTarget {
  key: string
  type: 'direct' | 'group'
  id: number
  name: string
  avatarUrl?: string | null
  subtitle: string
}

export interface AiWeiterleitenDialogProps {
  open: boolean
  messages: AiMessage[]
  onClose: () => void
  onNewChat?: () => void
}

export function AiWeiterleitenDialog({
  open,
  messages,
  onClose,
  onNewChat,
}: AiWeiterleitenDialogProps) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'messenger' | 'singra'>('messenger')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [messengerTargets, setMessengerTargets] = useState<MessengerTarget[]>([])
  const [singraConvs, setSingraConvs] = useState<AiConversationSummary[]>([])

  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)

    Promise.all([
      getFriends().catch(() => []),
      getDirectChats().catch(() => []),
      getGroups().catch(() => [] as ChatGroupItem[]),
      typeof aiApi.listConversations === 'function'
        ? aiApi.listConversations().catch(() => [])
        : Promise.resolve([]),
    ])
      .then(async ([friends, directChats, rawGroups, convs]) => {
        if (!active) return
        const groups = await benenneGruppen(rawGroups).catch(() => rawGroups)
        if (!active) return

        const targets: MessengerTarget[] = []
        const seenUsers = new Set<number>()

        for (const f of friends) {
          if (f.status !== 'accepted') continue
          const uid = f.user_id ?? f.id
          if (!uid || seenUsers.has(uid)) continue
          seenUsers.add(uid)
          targets.push({
            key: `direct:${uid}`,
            type: 'direct',
            id: uid,
            name: f.username,
            avatarUrl: f.avatar_url,
            subtitle: 'Kontakt im Messenger',
          })
        }

        for (const dc of directChats) {
          if (!dc.other_user_id || seenUsers.has(dc.other_user_id)) continue
          seenUsers.add(dc.other_user_id)
          targets.push({
            key: `direct:${dc.other_user_id}`,
            type: 'direct',
            id: dc.other_user_id,
            name: dc.other_username,
            avatarUrl: dc.other_avatar_url,
            subtitle: 'Direktchat',
          })
        }

        for (const g of groups) {
          targets.push({
            key: `group:${g.id}`,
            type: 'group',
            id: g.id,
            name: g.name?.trim() || `Gruppe #${g.id}`,
            avatarUrl: g.avatar_url,
            subtitle: 'Gruppe im Messenger',
          })
        }

        setMessengerTargets(targets)
        setSingraConvs(convs)
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
    }
  }, [open])

  const formattedForwardText = useMemo(() => {
    if (messages.length === 0) return ''
    if (messages.length === 1) {
      const m = messages[0]
      const prefix = m.role === 'assistant' ? '[Weitergeleitet von Singra]' : '[Weitergeleitete Nachricht]'
      return `${prefix}\n${m.content.trim()}`
    }
    return messages
      .map((m) => {
        const sender = m.role === 'assistant' ? 'Singra' : 'Ich'
        return `${sender}: ${m.content.trim()}`
      })
      .join('\n\n---\n\n')
  }, [messages])

  const filteredMessenger = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return messengerTargets
    return messengerTargets.filter((t) => t.name.toLowerCase().includes(q))
  }, [messengerTargets, search])

  const filteredSingra = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return singraConvs
    return singraConvs.filter((c) => (c.title || '').toLowerCase().includes(q))
  }, [singraConvs, search])

  const handleForwardToMessenger = (target: MessengerTarget) => {
    try {
      sessionStorage.setItem('msm:pending_messenger_draft', formattedForwardText)
    } catch {}
    onClose()
    if (target.type === 'direct') {
      navigate(`/messenger?userId=${target.id}`)
    } else {
      navigate(`/messenger?groupId=${target.id}`)
    }
    toast.success(`In Chat „${target.name}" übernommen.`)
  }

  const handleForwardToSingra = (convId: string | 'new', title: string) => {
    onClose()
    if (convId === 'new') {
      onNewChat?.()
    }
    window.setTimeout(() => {
      entwurfUebergeben(formattedForwardText)
    }, 60)
    toast.success(`In „${title}" übernommen.`)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md bg-surface-container-high/95 backdrop-blur-2xl border border-outline-variant/30 text-on-surface shadow-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Forward className="h-4 w-4 text-primary" />
            <span>
              {messages.length === 1
                ? 'Nachricht weiterleiten'
                : `${messages.length} Nachrichten weiterleiten`}
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs text-on-surface-variant">
            Wähle einen Kontakt im Messenger oder eine Singra-Unterhaltung aus.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-1">
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-surface-container-low p-1 border border-outline-variant/25">
            <button
              type="button"
              onClick={() => setTab('messenger')}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                tab === 'messenger'
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" />
              <span>Messenger</span>
            </button>
            <button
              type="button"
              onClick={() => setTab('singra')}
              className={`flex items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium transition-colors ${
                tab === 'singra'
                  ? 'bg-primary text-on-primary shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Singra KI</span>
            </button>
          </div>

          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={
              tab === 'messenger'
                ? 'Kontakt oder Gruppe suchen …'
                : 'Singra-Unterhaltung suchen …'
            }
            prefix={<Search className="h-4 w-4" />}
          />

          <div className="max-h-72 overflow-y-auto space-y-1 pr-1">
            {loading ? (
              <p className="py-8 text-center text-xs text-on-surface-variant">Lade Ziele …</p>
            ) : tab === 'messenger' ? (
              filteredMessenger.length === 0 ? (
                <p className="py-8 text-center text-xs text-on-surface-variant">
                  Keine passenden Kontakte oder Gruppen gefunden.
                </p>
              ) : (
                filteredMessenger.map((target) => (
                  <button
                    key={target.key}
                    type="button"
                    onClick={() => handleForwardToMessenger(target)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-container-highest/70"
                  >
                    {target.type === 'group' ? (
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-tertiary/20 text-tertiary">
                        <Users className="h-4 w-4" />
                      </span>
                    ) : (
                      <Avatar
                        src={target.avatarUrl ?? null}
                        name={target.name}
                        size="sm"
                        className="h-9 w-9 shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-on-surface">{target.name}</p>
                      <p className="truncate text-label-sm text-on-surface-variant">{target.subtitle}</p>
                    </div>
                    <Forward className="h-4 w-4 shrink-0 text-primary" />
                  </button>
                ))
              )
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleForwardToSingra('new', 'Neuer Chat')}
                  className="flex w-full items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2.5 text-left transition-colors hover:bg-primary/20"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
                    <MessageSquarePlus className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold text-primary">In neuem Singra-Chat öffnen</p>
                    <p className="truncate text-label-sm text-on-surface-variant">
                      Startet eine frische Unterhaltung mit dem weitergeleiteten Inhalt
                    </p>
                  </div>
                </button>
                {filteredSingra.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => handleForwardToSingra(conv.id, conv.title || 'Singra-Chat')}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-surface-container-highest/70"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-on-surface-variant">
                      <Sparkles className="h-4 w-4 text-primary" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-on-surface">
                        {conv.title || 'Unterhaltung'}
                      </p>
                      <p className="truncate text-label-sm text-on-surface-variant">
                        In Eingabeleiste übernehmen
                      </p>
                    </div>
                    <Forward className="h-4 w-4 shrink-0 text-on-surface-variant" />
                  </button>
                ))}
              </>
            )}
          </div>

          <div className="flex justify-end pt-1">
            <Button type="button" variant="secondary" size="sm" onClick={onClose}>
              Abbrechen
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
