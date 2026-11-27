import { useEffect, useId, useState } from 'react'

let initializedTheme: 'dark' | 'default' | null = null

/**
 * Rendert einen ```mermaid```-Codeblock lazy-loaded als SVG.
 * Fällt bei ungültiger Syntax oder fehlender DOM-Unterstützung sauber auf
 * den unveränderten Quelltext zurück.
 */
export function MermaidBlock({ chart }: { chart: string }) {
  const reactId = useId().replace(/:/g, '-')
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const code = chart.trim()
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
        const targetTheme =
          typeof document !== 'undefined' &&
          document.documentElement.classList.contains('dark')
            ? 'dark'
            : 'default'
        if (initializedTheme !== targetTheme) {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            htmlLabels: false,
            theme: targetTheme,
          })
          initializedTheme = targetTheme
        }
        const { svg: rendered } = await mermaid.render(renderId, code)
        if (!cancelled) {
          setSvg(rendered)
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
  }, [chart, reactId])

  if (svg && !failed) {
    return (
      <div
        className="my-3 overflow-x-auto rounded-lg border border-outline-variant/35 bg-surface-container-low/50 p-3"
        // Mermaid rendert mit securityLevel: 'strict' bereinigtes SVG ohne Skripte.
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
