import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Editor } from '@tiptap/react'

import i18n from '@/i18n'
import { OutlineList, type OutlineEntry, useOutlineEntries } from './Outline'

const eintraege: OutlineEntry[] = [
  { pos: 4, level: 1, text: 'Einleitung' },
  { pos: 40, level: 2, text: 'Details' },
]

describe('OutlineList', () => {
  it('zeigt Überschriften und springt auf die Position', () => {
    const onJump = vi.fn()
    render(<OutlineList entries={eintraege} onJump={onJump} />)

    fireEvent.click(screen.getByRole('button', { name: 'Details' }))

    expect(onJump).toHaveBeenCalledWith(40)
  })

  it('zeigt den leeren Zustand', () => {
    render(<OutlineList entries={[]} onJump={vi.fn()} />)
    expect(screen.getByText(i18n.t('docs.outline.empty'))).toBeInTheDocument()
  })
})

describe('useOutlineEntries', () => {
  it('fasst schnelle Editor-Aktualisierungen zusammen', () => {
    vi.useFakeTimers()
    let ueberschriften = [{ pos: 1, text: 'Start' }]
    const listeners = new Set<() => void>()
    const editor = {
      state: {
        doc: {
          descendants(callback: (node: object, pos: number) => void) {
            for (const heading of ueberschriften) {
              callback(
                {
                  type: { name: 'heading' },
                  attrs: { level: 1 },
                  textContent: heading.text,
                },
                heading.pos,
              )
            }
          },
        },
      },
      on(_event: string, callback: () => void) {
        listeners.add(callback)
      },
      off(_event: string, callback: () => void) {
        listeners.delete(callback)
      },
    } as unknown as Editor
    const { result, unmount } = renderHook(() => useOutlineEntries(editor))

    expect(result.current.map((entry) => entry.text)).toEqual(['Start'])

    act(() => {
      ueberschriften = [{ pos: 1, text: 'Zwischenstand' }]
      for (const listener of listeners) listener()
      vi.advanceTimersByTime(50)
      ueberschriften = [{ pos: 1, text: 'Aktuell' }]
      for (const listener of listeners) listener()
      vi.advanceTimersByTime(149)
    })
    expect(result.current.map((entry) => entry.text)).toEqual(['Start'])

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.map((entry) => entry.text)).toEqual(['Aktuell'])

    unmount()
    vi.useRealTimers()
  })

  it('setzt keinen neuen Stand, wenn die Überschriften gleich geblieben sind', () => {
    vi.useFakeTimers()
    const listeners = new Set<() => void>()
    const editor = {
      state: {
        doc: {
          descendants(callback: (node: object, pos: number) => void) {
            callback(
              { type: { name: 'heading' }, attrs: { level: 1 }, textContent: 'Gleich' },
              1,
            )
          },
        },
      },
      on(_event: string, callback: () => void) {
        listeners.add(callback)
      },
      off(_event: string, callback: () => void) {
        listeners.delete(callback)
      },
    } as unknown as Editor
    const { result, unmount } = renderHook(() => useOutlineEntries(editor))
    const stand = result.current

    act(() => {
      for (const listener of listeners) listener()
      vi.advanceTimersByTime(150)
    })

    expect(result.current).toBe(stand)
    unmount()
    vi.useRealTimers()
  })

  it('abonniert Editor-Änderungen nur bei geöffnetem Outline-Panel', () => {
    const listeners = new Set<() => void>()
    const editor = {
      state: {
        doc: {
          descendants(callback: (node: object, pos: number) => void) {
            callback(
              { type: { name: 'heading' }, attrs: { level: 1 }, textContent: 'Aktuell' },
              1,
            )
          },
        },
      },
      on(_event: string, callback: () => void) {
        listeners.add(callback)
      },
      off(_event: string, callback: () => void) {
        listeners.delete(callback)
      },
    } as unknown as Editor
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) => useOutlineEntries(editor, enabled),
      { initialProps: { enabled: false } },
    )

    expect(listeners.size).toBe(0)
    rerender({ enabled: true })
    expect(listeners.size).toBe(1)
    expect(result.current.map((entry) => entry.text)).toEqual(['Aktuell'])
    rerender({ enabled: false })
    expect(listeners.size).toBe(0)
    unmount()
  })

  it('entfernt den ausstehenden Timer beim Abmelden', () => {
    vi.useFakeTimers()
    const listeners = new Set<() => void>()
    const editor = {
      state: {
        doc: {
          descendants() {},
        },
      },
      on(_event: string, callback: () => void) {
        listeners.add(callback)
      },
      off(_event: string, callback: () => void) {
        listeners.delete(callback)
      },
    } as unknown as Editor
    const { unmount } = renderHook(() => useOutlineEntries(editor))

    act(() => {
      for (const listener of listeners) listener()
    })
    unmount()
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})