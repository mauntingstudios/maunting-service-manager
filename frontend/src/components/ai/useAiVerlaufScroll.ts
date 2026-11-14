import { useCallback, useEffect, useLayoutEffect, useRef, useState, type UIEvent } from 'react'

export function useAiVerlaufScroll(loading: boolean, entries: readonly unknown[], geoOpen: boolean) {
  const entriesLength = entries.length
  const [amEnde, setAmEnde] = useState(true)
  const verlaufRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)
  const bottomMarkerRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const initialScrollDoneRef = useRef(false)

  const scrolleNachUnten = useCallback((force = false) => {
    if (!force && userScrolledUpRef.current) return
    const kasten = verlaufRef.current
    if (kasten) {
      kasten.scrollTop = kasten.scrollHeight
    }
    bottomMarkerRef.current?.scrollIntoView({ block: 'end' })
  }, [])

  const scrolleNachGeoWechsel = useCallback(() => {
    userScrolledUpRef.current = false
    setAmEnde(true)
    scrolleNachUnten(true)
    const t1 = setTimeout(() => scrolleNachUnten(true), 50)
    const t2 = setTimeout(() => scrolleNachUnten(true), 150)
    const t3 = setTimeout(() => scrolleNachUnten(true), 350)
    const t4 = setTimeout(() => scrolleNachUnten(true), 600)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(t4)
    }
  }, [scrolleNachUnten])

  const prevGeoOpenRef = useRef(geoOpen)
  useEffect(() => {
    if (prevGeoOpenRef.current !== geoOpen) {
      return scrolleNachGeoWechsel()
    }
    prevGeoOpenRef.current = geoOpen
  }, [geoOpen, scrolleNachGeoWechsel])

  useEffect(() => {
    const el = messagesContainerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      if (!userScrolledUpRef.current) {
        scrolleNachUnten(false)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrolleNachUnten])

  useLayoutEffect(() => {
    if (!loading && entriesLength > 0 && !initialScrollDoneRef.current) {
      scrolleNachUnten(true)
    }
  }, [loading, entriesLength, scrolleNachUnten])

  useEffect(() => {
    if (!loading && entriesLength > 0 && !initialScrollDoneRef.current) {
      initialScrollDoneRef.current = true
      userScrolledUpRef.current = false
      setAmEnde(true)
      scrolleNachUnten(true)
      const timers = [
        setTimeout(() => scrolleNachUnten(true), 30),
        setTimeout(() => scrolleNachUnten(true), 100),
        setTimeout(() => scrolleNachUnten(true), 250),
        setTimeout(() => scrolleNachUnten(true), 500),
        setTimeout(() => scrolleNachUnten(true), 1000),
      ]
      return () => {
        timers.forEach(clearTimeout)
      }
    }
  }, [loading, entriesLength, scrolleNachUnten])

  useEffect(() => {
    if (amEnde && !userScrolledUpRef.current) {
      scrolleNachUnten(false)
    }
  }, [amEnde, entries, scrolleNachUnten])

  const nachUntenMerken = useCallback(() => {
    userScrolledUpRef.current = false
    setAmEnde(true)
    scrolleNachUnten(true)
  }, [scrolleNachUnten])

  const resetNachLeeren = useCallback(() => {
    initialScrollDoneRef.current = false
    userScrolledUpRef.current = false
  }, [])

  const handleVerlaufScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const { scrollTop, scrollHeight, clientHeight } = event.currentTarget
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 60
    setAmEnde(isAtBottom)
    if (isAtBottom) {
      userScrolledUpRef.current = false
    } else if (scrollHeight - scrollTop - clientHeight > 120) {
      userScrolledUpRef.current = true
    }
  }, [])

  return {
    verlaufRef,
    bottomMarkerRef,
    messagesContainerRef,
    nachUntenMerken,
    resetNachLeeren,
    scrolleNachUnten,
    handleVerlaufScroll,
  }
}
