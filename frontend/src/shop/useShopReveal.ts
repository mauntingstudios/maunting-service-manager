import { useEffect } from 'react'

/**
 * Progressive Enhancement für Scroll-Reveals im Shop:
 * Browser mit nativer CSS-View-Timeline nutzen direkt `@supports ((animation-timeline: view()) and (animation-range: entry))`.
 * Nur ohne native Unterstützung (und ohne `prefers-reduced-motion: reduce`) übernimmt IntersectionObserver.
 */
export function useShopReveal(dependencyKey?: string | number) {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const elements = Array.from(
      document.querySelectorAll<HTMLElement>('[data-shop-reveal]'),
    )
    if (elements.length === 0) return

    const prefersReduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const supportsScrollDriven =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports('(animation-timeline: view()) and (animation-range: entry)')

    if (prefersReduced || supportsScrollDriven || typeof IntersectionObserver === 'undefined') {
      for (const el of elements) {
        el.dataset.reveal = 'visible'
      }
      return
    }

    const viewportHeight = window.innerHeight || 900
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement
            target.dataset.reveal = 'visible'
            observer.unobserve(target)
          }
        }
      },
      {
        threshold: 0.12,
        rootMargin: '0px 0px -24px 0px',
      },
    )

    for (const el of elements) {
      const rect = el.getBoundingClientRect()
      if (rect.top < viewportHeight * 0.94) {
        el.dataset.reveal = 'visible'
      } else {
        el.dataset.reveal = 'hidden'
        observer.observe(el)
      }
    }

    return () => {
      observer.disconnect()
    }
  }, [dependencyKey])
}
