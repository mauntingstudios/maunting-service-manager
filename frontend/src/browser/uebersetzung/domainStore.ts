/**
 * Persistiert Domains und deren Übersetzungseinstellungen (z. B. "Auf dieser Domain immer übersetzen").
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface DomainEintrag {
  domain: string
  paar: string
  auto: boolean
  zuletzt: number
}

interface DomainZustand {
  domains: Record<string, DomainEintrag>
  merkeDomain: (url: string, paar: string, auto?: boolean) => void
  setAutoUebersetzen: (domain: string, auto: boolean) => void
  entferneDomain: (domain: string) => void
  entfernePaarDomains: (paar: string) => void
  getDomainEintrag: (url: string) => DomainEintrag | null
  domainsFuerPaar: (paar: string) => DomainEintrag[]
}

export function extrahiereDomain(url: string): string {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    return parsed.hostname
  } catch {
    return ''
  }
}

export const useUebersetzungDomainStore = create<DomainZustand>()(
  persist(
    (set, get) => ({
      domains: {},
      merkeDomain: (url, paar, auto) => {
        const domain = extrahiereDomain(url)
        if (!domain) return
        set((s) => {
          const bisher = s.domains[domain]
          return {
            domains: {
              ...s.domains,
              [domain]: {
                domain,
                paar,
                auto: auto !== undefined ? auto : bisher?.auto ?? false,
                zuletzt: Date.now(),
              },
            },
          }
        })
      },
      setAutoUebersetzen: (domain, auto) => {
        set((s) => {
          const bisher = s.domains[domain]
          if (!bisher) return s
          return {
            domains: {
              ...s.domains,
              [domain]: { ...bisher, auto, zuletzt: Date.now() },
            },
          }
        })
      },
      entferneDomain: (domain) => {
        set((s) => {
          const rest = { ...s.domains }
          delete rest[domain]
          return { domains: rest }
        })
      },
      entfernePaarDomains: (paar) => {
        set((s) => {
          const rest: Record<string, DomainEintrag> = {}
          for (const [d, e] of Object.entries(s.domains)) {
            if (e.paar !== paar) rest[d] = e
          }
          return { domains: rest }
        })
      },
      getDomainEintrag: (url) => {
        const domain = extrahiereDomain(url)
        return get().domains[domain] ?? null
      },
      domainsFuerPaar: (paar) => {
        return Object.values(get().domains)
          .filter((d) => d.paar === paar)
          .sort((a, b) => b.zuletzt - a.zuletzt)
      },
    }),
    {
      name: 'msb-uebersetzung-domains',
    },
  ),
)
