/**
 * Stories in der Seitenleiste: eigene, die der Freunde, was schon gesehen ist,
 * und welcher Dialog gerade offen ist.
 *
 * „Gesehen" merkt sich nur die Kennungen, in `localStorage` und nur auf diesem
 * Gerät; der Absender erfährt davon nichts. Bis 09/2026 stand das in
 * `Messenger.tsx`.
 */

import { useEffect, useMemo, useState } from 'react'

import type { ChatStoryItem } from '@/api/social'
import type { StoryGruppe } from '@/components/social/sidebar/StoriesCarouselBar'

const SEEN_STORIES_PREFIX = 'msm_seen_story_ids'

type Kontakt = { userId: number; username: string; avatarUrl?: string | null }

function speicherSchluessel(currentUserId: number): string {
  return `${SEEN_STORIES_PREFIX}:${currentUserId}`
}

function ladeGesehene(schluessel: string): Set<number> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = localStorage.getItem(schluessel)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

export function useStoryAnsicht(stories: ChatStoryItem[], currentUserId: number, kontakte: Kontakt[]) {
  const [erstellenOffen, setErstellenOffen] = useState(false)
  const [erstellModus, setErstellModus] = useState<'text' | 'photo'>('text')
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [betrachterOffen, setBetrachterOffen] = useState(false)
  const [betrachterIndex, setBetrachterIndex] = useState(0)
  const [betrachterStories, setBetrachterStories] = useState<ChatStoryItem[]>([])
  const [gesehen, setGesehen] = useState<Set<number>>(() => ladeGesehene(speicherSchluessel(currentUserId)))

  useEffect(() => {
    setGesehen(ladeGesehene(speicherSchluessel(currentUserId)))
  }, [currentUserId])

  const markiereGesehen = (liste: ChatStoryItem[]) => {
    setGesehen((prev) => {
      const next = new Set(prev)
      let changed = false
      for (const s of liste) {
        if (!next.has(s.id)) {
          next.add(s.id)
          changed = true
        }
      }
      if (changed && typeof window !== 'undefined') {
        try {
          localStorage.setItem(speicherSchluessel(currentUserId), JSON.stringify(Array.from(next)))
        } catch {}
      }
      return next
    })
  }

  const eigene = useMemo(() => {
    return stories.filter((s) => s.user_id === currentUserId)
  }, [stories, currentUserId])

  /** Je Freund eine Gruppe; wer Ungesehenes hat, steht vorn. */
  const freunde = useMemo<StoryGruppe[]>(() => {
    const map = new Map<number, ChatStoryItem[]>()
    for (const story of stories) {
      if (story.user_id === currentUserId) continue
      const list = map.get(story.user_id) || []
      list.push(story)
      map.set(story.user_id, list)
    }
    const grouped = Array.from(map.entries()).map(([userId, userStories]) => {
      const contact = kontakte.find((c) => c.userId === userId)
      const sortiert = [...userStories].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      )
      const first = sortiert[0]
      const hasUnseen = sortiert.some((s) => !gesehen.has(s.id))
      return {
        userId,
        username: contact?.username || first?.username || 'Freund',
        avatarUrl: contact?.avatarUrl || first?.avatar_url,
        stories: sortiert,
        latestStory: sortiert[sortiert.length - 1],
        hasUnseen,
      }
    })
    return grouped.sort((a, b) => {
      if (a.hasUnseen && !b.hasUnseen) return -1
      if (!a.hasUnseen && b.hasUnseen) return 1
      return 0
    })
  }, [stories, currentUserId, kontakte, gesehen])

  return {
    eigene,
    freunde,
    betrachter: {
      offen: betrachterOffen,
      setOffen: setBetrachterOffen,
      index: betrachterIndex,
      /** Ohne Auswahl zeigt der Betrachter alle. */
      stories: betrachterStories.length > 0 ? betrachterStories : stories,
      oeffne: (liste: ChatStoryItem[], start = 0) => {
        setBetrachterStories(liste)
        setBetrachterIndex(start)
        setBetrachterOffen(true)
        markiereGesehen(liste)
      },
    },
    erstellung: {
      offen: erstellenOffen,
      modus: erstellModus,
      fotoUrl,
      setOffen: (open: boolean) => {
        setErstellenOffen(open)
        if (!open) setFotoUrl(null)
      },
      mitText: () => {
        setErstellModus('text')
        setFotoUrl(null)
        setErstellenOffen(true)
      },
      mitFoto: (url: string) => {
        setFotoUrl(url)
        setErstellModus('photo')
        setErstellenOffen(true)
      },
    },
  }
}
