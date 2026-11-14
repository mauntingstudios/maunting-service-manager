import { useEffect, useMemo, useRef, useState } from 'react'

import type { AiGeoCameraCommand, AiRegionalAnalysis, AiToolUse } from '@/api/ai'
import { still } from '@/lib/still'
import type { NewsItem } from './geo/RegionalInfoPanel'
import { applyGeoCameraCommand, normalizeGeoCameraCommand, normalizeRegionalAnalysis } from './geo/regionalAnalysis'
import type { Entry } from './useAiLauf'

export function useAiGeoAnalyse(
  entries: Entry[],
  streaming: boolean,
  laufendeWerkzeuge: AiToolUse[],
) {
  const [geoData, setGeoData] = useState<AiRegionalAnalysis | null>(null)
  const [geoOpen, setGeoOpen] = useState(false)

  const wasAnalyzingRegionRef = useRef(false)
  const verlaufEintraegeRef = useRef<Entry[] | null>(null)
  const letzteGeoKennungRef = useRef<string | null>(null)

  useEffect(() => {
    const isAnalyzing = laufendeWerkzeuge.some(
      (w) => w.tool_name === 'analyze_region' || w.tool_name === 'control_region_camera',
    )
    if (isAnalyzing && !wasAnalyzingRegionRef.current) {
      setGeoOpen(true)
    }
    wasAnalyzingRegionRef.current = isAnalyzing
  }, [laufendeWerkzeuge])

  useEffect(() => {
    const ausVerlauf = verlaufEintraegeRef.current === entries
    let latestAnalysis: AiRegionalAnalysis | null = null
    let analyseKennung = ''
    let analysisMsgIdx = -1
    let analysisSecIdx = -1

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry.kind === 'message' && entry.message.sections) {
        for (let j = entry.message.sections.length - 1; j >= 0; j--) {
          const section = entry.message.sections[j]
          if (
            section.art === 'tool' &&
            section.werkzeug?.tool_name === 'analyze_region' &&
            section.werkzeug.geo_analysis
          ) {
            const geo = normalizeRegionalAnalysis(section.werkzeug.geo_analysis)
            if (geo) {
              latestAnalysis = geo
              analyseKennung = geo.camera?.command_id || `${entry.message.id}:${j}`
              analysisMsgIdx = i
              analysisSecIdx = j
              break
            }
          }
        }
        if (latestAnalysis) break
      }
    }

    if (!latestAnalysis) {
      letzteGeoKennungRef.current = null
      setGeoData(null)
      return
    }

    let combinedGeo = latestAnalysis
    let letzterKamerabefehl: AiGeoCameraCommand | null = null

    for (let i = Math.max(0, analysisMsgIdx); i < entries.length; i++) {
      const entry = entries[i]
      if (entry.kind === 'message' && entry.message.sections) {
        const startJ = i === analysisMsgIdx ? analysisSecIdx + 1 : 0
        for (let j = startJ; j < entry.message.sections.length; j++) {
          const section = entry.message.sections[j]
          if (
            section.art === 'tool' &&
            section.werkzeug?.tool_name === 'control_region_camera' &&
            section.werkzeug.geo_camera
          ) {
            const command = normalizeGeoCameraCommand(section.werkzeug.geo_camera)
            if (command) {
              combinedGeo = applyGeoCameraCommand(combinedGeo, command) ?? combinedGeo
              letzterKamerabefehl = command
            }
          }
        }
      }
    }

    const kennung = letzterKamerabefehl?.command_id || analyseKennung
    if (letzteGeoKennungRef.current !== kennung) {
      if (!ausVerlauf && streaming) {
        setGeoOpen(true)
      }
      letzteGeoKennungRef.current = kennung
    }
    setGeoData(combinedGeo)
  }, [entries, streaming])

  const newsFromSearch = useMemo<NewsItem[]>(() => {
    if (!geoData?.location) return []
    const curLoc = geoData.location.toLowerCase().split(',')[0].trim()

    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry.kind === 'message' && entry.message.sections) {
        const hasMatchingAnalysis = entry.message.sections.some(
          (s) =>
            s.art === 'tool' &&
            s.werkzeug?.tool_name === 'analyze_region' &&
            s.werkzeug.geo_analysis?.location?.toLowerCase().includes(curLoc),
        )

        for (let j = entry.message.sections.length - 1; j >= 0; j--) {
          const section = entry.message.sections[j]
          if (
            section.art === 'tool' &&
            section.werkzeug?.tool_name === 'web_search' &&
            (section.werkzeug.web_results || section.werkzeug.ergebnis)
          ) {
            const rawResults =
              section.werkzeug.web_results ||
              (
                section.werkzeug.ergebnis as {
                  results?: Array<{
                    title?: string
                    url?: string
                    description?: string
                    snippet?: string
                  }>
                }
              )?.results

            if (Array.isArray(rawResults) && rawResults.length > 0) {
              const matchingResults = rawResults.filter((r) => {
                if (hasMatchingAnalysis) return true
                const text = `${r.title || ''} ${r.description || ''} ${r.snippet || ''}`.toLowerCase()
                return text.includes(curLoc)
              })

              if (matchingResults.length > 0) {
                return matchingResults.map((r, idx) => {
                  let domain = 'Websuche'
                  try {
                    if (r.url) domain = new URL(r.url).hostname.replace(/^www\./, '')
                  } catch (err) {
                    still(err, 'ai.news.url')
                  }
                  return {
                    id: `search-news-${idx}`,
                    title: r.title || 'Nachrichtenbericht',
                    source: domain,
                    timeAgo: 'Aktuell',
                    category: 'Websuche',
                    url: r.url,
                    snippet: r.description || r.snippet,
                  }
                })
              }
            }
          }
        }
      }
    }
    return []
  }, [entries, geoData?.location])

  return {
    geoData,
    geoOpen,
    setGeoOpen,
    newsFromSearch,
    verlaufEintraegeRef,
  }
}
