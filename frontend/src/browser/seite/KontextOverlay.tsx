/**
 * Autonomes Overlay-Fenster für das Pontis-Kontextmenü (Option C).
 *
 * Läuft in einem eigenen transparenten, rahmenlosen HWND-Fenster über der
 * WebView2-Fläche. Da es als eigenständiges Top-Level-Fenster gerendert wird,
 * muss die WebView2 niemals ausgeblendet werden (kein `SetIsVisible(false)`).
 * Videos (z. B. YouTube mit 60 FPS) laufen absolut ruckelfrei weiter.
 */
import { useEffect, useState, useRef, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { listen } from '@tauri-apps/api/event'
import { emit } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { LogicalSize } from '@tauri-apps/api/dpi'
import {
  ArrowLeft,
  ArrowRight,
  Code,
  Copy,
  Download,
  ExternalLink,
  Languages,
  Link2,
  Printer,
  RotateCw,
  Search,
  VenetianMask,
} from 'lucide-react'
import { cx } from '@maunting/ui'

export interface KontextDaten {
  tab: string
  x: number
  y: number
  link: string | null
  bild: string | null
  auswahl: string | null
  editierbar: boolean
  kann_zurueck: boolean
  kann_vor: boolean
  url: string
  titel: string
}

interface KontextItem {
  key: string
  label: string
  icon: React.ReactNode
  separatorBefore?: boolean
  destructive?: boolean
  tun: () => void | Promise<void>
}

export function KontextOverlay() {
  const { t } = useTranslation()
  const [daten, setDaten] = useState<KontextDaten | null>(null)
  const menueRef = useRef<HTMLDivElement>(null)

  // Hintergrund vollkommen transparent schalten
  useEffect(() => {
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
    const root = document.getElementById('root')
    if (root) root.style.background = 'transparent'
  }, [])

  // Schließen bei Escape oder Fokusverlust
  useEffect(() => {
    const fenster = getCurrentWindow()
    const schliessen = () => {
      setDaten(null)
      void fenster.hide().catch(() => null)
    }

    const aufTaste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        schliessen()
      }
    }

    const aufBlur = () => {
      schliessen()
    }

    window.addEventListener('keydown', aufTaste)
    window.addEventListener('blur', aufBlur)

    return () => {
      window.removeEventListener('keydown', aufTaste)
      window.removeEventListener('blur', aufBlur)
    }
  }, [])

  // Auf Daten aus Rust lauschen
  useEffect(() => {
    let unlisten: (() => void) | null = null

    void listen<KontextDaten>('msb:kontext-daten', (event) => {
      setDaten(event.payload)
    }).then((u) => {
      unlisten = u
    })

    return () => {
      unlisten?.()
    }
  }, [])

  const schliessen = () => {
    setDaten(null)
    void getCurrentWindow().hide().catch(() => null)
  }

  // Menüeinträge aufbauen
  const items: KontextItem[] = []

  if (daten) {
    if (daten.link) {
      const link = daten.link
      items.push({
        key: 'link_tab',
        label: t('browser.menue.linkNeuerTab', { defaultValue: 'Link in neuem Tab öffnen' }),
        icon: <ExternalLink className="h-4 w-4" />,
        tun: () => void emit('msb:kontext-befehl', { aktion: 'neuer_tab', tab: daten.tab, url: link, hintergrund: true }),
      })
      items.push({
        key: 'link_privat',
        label: t('browser.menue.linkPrivat', { defaultValue: 'Link in privatem Tab öffnen' }),
        icon: <VenetianMask className="h-4 w-4" />,
        tun: () => void emit('msb:kontext-befehl', { aktion: 'neuer_tab', tab: daten.tab, url: link, privat: true }),
      })
      items.push({
        key: 'link_kopieren',
        label: t('browser.menue.linkKopieren', { defaultValue: 'Link-Adresse kopieren' }),
        icon: <Link2 className="h-4 w-4" />,
        tun: () => void navigator.clipboard.writeText(link).catch(() => null),
      })
    }

    if (daten.bild) {
      const bild = daten.bild
      items.push({
        key: 'bild_tab',
        label: t('browser.menue.bildNeuerTab', { defaultValue: 'Bild in neuem Tab öffnen' }),
        icon: <ExternalLink className="h-4 w-4" />,
        separatorBefore: items.length > 0,
        tun: () => void emit('msb:kontext-befehl', { aktion: 'neuer_tab', tab: daten.tab, url: bild, hintergrund: true }),
      })
      items.push({
        key: 'bild_speichern',
        label: t('browser.menue.saveImageAs', { defaultValue: 'Bild speichern unter …' }),
        icon: <Download className="h-4 w-4" />,
        tun: () => void emit('msb:kontext-befehl', { aktion: 'bild_speichern', tab: daten.tab, url: bild }),
      })
      items.push({
        key: 'bild_kopieren',
        label: t('browser.menue.bildAdresse', { defaultValue: 'Bildadresse kopieren' }),
        icon: <Link2 className="h-4 w-4" />,
        tun: () => void navigator.clipboard.writeText(bild).catch(() => null),
      })
    }

    if (daten.auswahl && daten.auswahl.trim()) {
      const text = daten.auswahl.trim()
      items.push({
        key: 'kopieren',
        label: t('common.copy', { defaultValue: 'Kopieren' }),
        icon: <Copy className="h-4 w-4" />,
        separatorBefore: items.length > 0,
        tun: () => void navigator.clipboard.writeText(text).catch(() => null),
      })
      const kurz = text.length > 24 ? `${text.slice(0, 24)}…` : text
      const suchUrl = `https://duckduckgo.com/?q=${encodeURIComponent(text)}`
      items.push({
        key: 'suchen',
        label: t('browser.menue.suchen', { defaultValue: `Im Web nach „${kurz}“ suchen`, text: kurz, maschine: 'DuckDuckGo' }),
        icon: <Search className="h-4 w-4" />,
        tun: () => void emit('msb:kontext-befehl', { aktion: 'neuer_tab', tab: daten.tab, url: suchUrl }),
      })
      items.push({
        key: 'auswahl_uebersetzen',
        label: t('browser.menue.uebersetzen', { defaultValue: 'Übersetzen' }),
        icon: <Languages className="h-4 w-4" />,
        tun: () => void emit('msb:kontext-befehl', { aktion: 'uebersetzen', tab: daten.tab }),
      })
    }

    if (!daten.link && !daten.bild && !daten.auswahl && !daten.editierbar) {
      if (daten.kann_zurueck) {
        items.push({
          key: 'zurueck',
          label: t('browser.menue.back', { defaultValue: 'Zurück' }),
          icon: <ArrowLeft className="h-4 w-4" />,
          tun: () => void emit('msb:kontext-befehl', { aktion: 'zurueck', tab: daten.tab }),
        })
      }
      if (daten.kann_vor) {
        items.push({
          key: 'vor',
          label: t('browser.menue.forward', { defaultValue: 'Vor' }),
          icon: <ArrowRight className="h-4 w-4" />,
          tun: () => void emit('msb:kontext-befehl', { aktion: 'vor', tab: daten.tab }),
        })
      }
      items.push({
        key: 'neu_laden',
        label: t('common.reload', { defaultValue: 'Neu laden' }),
        icon: <RotateCw className="h-4 w-4" />,
        separatorBefore: items.length > 0,
        tun: () => void emit('msb:kontext-befehl', { aktion: 'neu_laden', tab: daten.tab }),
      })
      items.push({
        key: 'uebersetzen',
        label: t('browser.menue.uebersetzen', { defaultValue: 'Übersetzen' }),
        icon: <Languages className="h-4 w-4" />,
        separatorBefore: true,
        tun: () => void emit('msb:kontext-befehl', { aktion: 'uebersetzen', tab: daten.tab }),
      })
      items.push({
        key: 'speichern',
        label: t('browser.menue.saveAs', { defaultValue: 'Seite speichern unter …' }),
        icon: <Download className="h-4 w-4" />,
        tun: () => void emit('msb:kontext-befehl', { aktion: 'seite_speichern', tab: daten.tab }),
      })
      items.push({
        key: 'drucken',
        label: t('browser.menue.drucken', { defaultValue: 'Drucken …' }),
        icon: <Printer className="h-4 w-4" />,
        tun: () => void emit('msb:kontext-befehl', { aktion: 'drucken', tab: daten.tab }),
      })
    }

    items.push({
      key: 'untersuchen',
      label: t('browser.menue.untersuchen', { defaultValue: 'Untersuchen' }),
      icon: <Code className="h-4 w-4" />,
      separatorBefore: items.length > 0,
      tun: () => void emit('msb:kontext-befehl', { aktion: 'untersuchen', tab: daten.tab, x: daten.x, y: daten.y }),
    })
  }

  // Fensterhöhe passgenau an den Inhalt anpassen
  useLayoutEffect(() => {
    if (menueRef.current && items.length > 0) {
      const box = menueRef.current.getBoundingClientRect()
      const neueHoehe = Math.min(Math.ceil(box.height + 16), 520)
      void getCurrentWindow().setSize(new LogicalSize(260, neueHoehe)).catch(() => null)
    }
  }, [items.length])

  if (!daten || items.length === 0) return null

  return (
    <div
      className="h-screen w-screen p-1 select-none overflow-hidden"
      onClick={schliessen}
      onContextMenu={(e) => {
        e.preventDefault()
        schliessen()
      }}
    >
      <div
        ref={menueRef}
        role="menu"
        aria-label={t('browser.menue.name', { defaultValue: 'Kontextmenü' })}
        onClick={(e) => e.stopPropagation()}
        className="w-full rounded-2xl border border-outline-variant/30 bg-surface-container-high/95 backdrop-blur-2xl p-1.5 shadow-2xl text-on-surface"
      >
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            onClick={() => {
              void item.tun()
              schliessen()
            }}
            className={cx(
              'flex min-h-9 w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-sm font-medium transition-all hover:bg-surface-container-highest/80 active:scale-[0.98]',
              item.separatorBefore && 'mt-1 border-t border-outline-variant/20 pt-1',
              item.destructive ? 'text-status-destructive hover:bg-status-destructive/10' : 'text-on-surface',
            )}
          >
            <span className="[&>svg]:h-4 [&>svg]:w-4 text-on-surface-variant">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
