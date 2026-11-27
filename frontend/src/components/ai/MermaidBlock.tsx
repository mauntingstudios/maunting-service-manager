import { useEffect, useId, useState } from 'react'

let initializedTheme: 'dark' | 'default' | null = null

const FORBIDDEN_SVG_TAGS = new Set([
  'script',
  'foreignobject',
  'iframe',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'audio',
  'video',
  'image',
  'animate',
  'animatetransform',
  'animatemotion',
  'set',
])

const LOCAL_FRAGMENT_RE = /^#[A-Za-z0-9_.:-]+$/

/**
 * Entfernt Mermaid-`%%{...}%%`-Directives vor dem Rendern, damit untrusted
 * Diagrammtexte keine `themeCSS`- oder `htmlLabels`-Konfiguration überschreiben.
 */
export function stripMermaidDirectives(code: string): string {
  return (code || '').replace(/%%\{[\s\S]*?\}%%/g, '').trim()
}

function sanitizeSvgCss(cssText: string): string {
  const withoutComments = (cssText || '').replace(/\/\*[\s\S]*?\*\//g, '')
  const withoutImports = withoutComments
    .replace(/@import[^;]*(?:;|$)/gi, '')
    .replace(/expression\s*\([^)]*\)/gi, 'none')
    .replace(/-moz-binding\s*:[^;]*(?:;|$)/gi, '')
    .replace(/behavior\s*:[^;]*(?:;|$)/gi, '')

  return withoutImports.replace(/url\(\s*(['"]?)([^)]*?)\1\s*\)/gi, (_full, _q, target: string) => {
    const cleanTarget = String(target || '').trim()
    return LOCAL_FRAGMENT_RE.test(cleanTarget) ? `url(#${cleanTarget.slice(1)})` : 'none'
  })
}

/**
 * Bereinigt ein von Mermaid erzeugtes SVG im fail-closed-Verfahren:
 * entfernt aktive/externe Elemente, Event-Handler, externe Links und
 * externe CSS-`url(...)`/`@import`-Aufrufe (keine Tracking-Requests).
 */
export function sanitizeMermaidSvg(rawSvg: string): string {
  if (!rawSvg || typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return ''
  }

  let doc: Document
  try {
    doc = new DOMParser().parseFromString(rawSvg, 'image/svg+xml')
  } catch {
    return ''
  }

  const root = doc.documentElement
  if (!root || root.localName.toLowerCase() !== 'svg' || doc.getElementsByTagName('parsererror').length > 0) {
    return ''
  }

  const allNodes = Array.from(doc.getElementsByTagName('*'))
  for (const el of allNodes) {
    const tag = (el.localName || el.tagName || '').toLowerCase()
    if (FORBIDDEN_SVG_TAGS.has(tag)) {
      el.parentNode?.removeChild(el)
      continue
    }

    if (tag === 'style') {
      el.textContent = sanitizeSvgCss(el.textContent || '')
    }

    for (const attr of Array.from(el.attributes)) {
      const attrName = attr.name.toLowerCase()
      const localAttr = (attr.localName || attr.name).toLowerCase()
      if (attrName.startsWith('on') || localAttr === 'src' || localAttr === 'action' || localAttr === 'formaction') {
        el.removeAttribute(attr.name)
        continue
      }
      if (localAttr === 'href') {
        const val = attr.value.trim()
        if (!LOCAL_FRAGMENT_RE.test(val)) {
          el.removeAttribute(attr.name)
        }
        continue
      }
      if (localAttr === 'style') {
        const cleaned = sanitizeSvgCss(attr.value)
        if (cleaned.trim()) {
          el.setAttribute(attr.name, cleaned)
        } else {
          el.removeAttribute(attr.name)
        }
        continue
      }
      // Auch Präsentationsattribute wie marker-end / fill / filter auf externe url(...) prüfen
      if (/url\s*\(/i.test(attr.value)) {
        el.setAttribute(attr.name, sanitizeSvgCss(attr.value))
      }
    }
  }

  return new XMLSerializer().serializeToString(root)
}

function currentDarkFlag(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

/**
 * Rendert einen ```mermaid```-Codeblock lazy-loaded als bereinigtes SVG.
 * Fällt bei ungültiger Syntax oder fehlender DOM-Unterstützung sauber auf
 * den unveränderten Quelltext zurück.
 */
export function MermaidBlock({ chart }: { chart: string }) {
  const reactId = useId().replace(/:/g, '-')
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [isDark, setIsDark] = useState<boolean>(currentDarkFlag)

  useEffect(() => {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setIsDark(currentDarkFlag())
    })
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let cancelled = false
    const code = stripMermaidDirectives(chart)
    if (!code) {
      setSvg(null)
      setFailed(false)
      return () => {
        cancelled = true
      }
    }

    const renderId = `msm-mermaid-${reactId}`

    async function renderChart() {
      try {
        const mod = await import('mermaid')
        const mermaid = mod.default
        const targetTheme = isDark ? 'dark' : 'default'
        if (initializedTheme !== targetTheme) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            htmlLabels: false,
            maxTextSize: 50_000,
            secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'htmlLabels', 'themeCSS', 'fontFamily'],
            theme: targetTheme,
          })
          initializedTheme = targetTheme
        }
        const { svg: rendered } = await mermaid.render(renderId, code)
        const cleanSvg = sanitizeMermaidSvg(rendered)
        if (!cleanSvg) {
          throw new Error('Empty or invalid sanitized SVG')
        }
        if (!cancelled) {
          setSvg(cleanSvg)
          setFailed(false)
        }
      } catch {
        if (typeof document !== 'undefined') {
          document.getElementById(`d${renderId}`)?.remove()
          document.getElementById(renderId)?.remove()
        }
        if (!cancelled) {
          setSvg(null)
          setFailed(true)
        }
      }
    }

    void renderChart()
    return () => {
      cancelled = true
    }
  }, [chart, reactId, isDark])

  if (svg && !failed) {
    return (
      <div
        className="my-3 overflow-x-auto rounded-lg border border-outline-variant/35 bg-surface-container-low/50 p-3"
        // Bereinigt durch stripMermaidDirectives() + sanitizeMermaidSvg() (ohne Skripte, Events oder externe URLs).
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    )
  }

  return (
    <pre className="my-2 overflow-x-auto rounded-lg border border-outline-variant/40 bg-surface-container-low/60 p-3">
      <code className="font-mono text-xs">{chart}</code>
    </pre>
  )
}
