import { useEffect, useMemo, useRef, useState } from 'react'
import {
  aiApi,
  type AiConversationSummary,
  type AiPreviewInspectionResult,
  type AiProject,
  type AiProjectEnvironmentState,
  type AiProjectFile,
} from '@/api/ai'
import { SanitizedApiError } from '@/api/client'
import { still } from '@/lib/still'
import { toast } from '@/stores/toastStore'
import { buildPreviewDocument, isPreviewErrorMessage } from './previewBundle'
import type { ConsoleLogEntry } from './SingraPreviewTab'

interface UseSingraPreviewOptions {
  selectedProject: AiProject | null
  files: AiProjectFile[]
  productionFiles: Array<{ path: string; content: string; size_bytes: number }>
  projectChats: AiConversationSummary[]
  envState: AiProjectEnvironmentState | null
  sendTaskToProjectChat: (prompt: string, chatChoice: string, newChatTitle: string) => Promise<void>
  onOpenProjectChat: (projectId: string, conversationId?: string) => void
  onStartNewProjectChat: (initialTitle?: string) => void | Promise<void>
}

export function buildPreviewBridgeScript(): string {
  return `
<script>
(function() {
  var _l = console.log, _i = console.info, _w = console.warn, _e = console.error;
  function _postLog(lvl, args) {
    try {
      var str = Array.prototype.slice.call(args).map(function(a) {
        if (typeof a === 'object' && a !== null) {
          try { return JSON.stringify(a); } catch(err) { return String(a); }
        }
        return String(a);
      }).join(' ');
      window.parent.postMessage({ type: 'SINGRA_DEV_CONSOLE', level: lvl, message: str, time: new Date().toLocaleTimeString() }, '*');
    } catch(ex) { void ex; }
  }
  console.log = function() { _l.apply(console, arguments); _postLog('log', arguments); };
  console.info = function() { _i.apply(console, arguments); _postLog('info', arguments); };
  console.warn = function() { _w.apply(console, arguments); _postLog('warn', arguments); };
  console.error = function() { _e.apply(console, arguments); _postLog('error', arguments); };
  window.addEventListener('error', function(ev) {
    _postLog('error', [ev.message || 'Laufzeitfehler']);
  });

  document.addEventListener('click', function(e) {
    var target = e.target && e.target.closest ? e.target.closest('a') : null;
    if (!target) return;
    var href = (target.getAttribute('href') || '').trim();
    if (!href.startsWith('#') && !href.toLowerCase().startsWith('javascript:')) {
      e.preventDefault();
    }
  }, false);

  document.addEventListener('submit', function(e) {
    if (!e.defaultPrevented) {
      e.preventDefault();
    }
  }, false);

  var activeHover = null;
  var style = document.createElement('style');
  style.id = '__singra_inspector_style__';
  style.textContent = '.singra-inspect-hover { outline: 2px dashed #06b6d4 !important; outline-offset: -2px !important; cursor: crosshair !important; background-color: rgba(6,182,212,0.1) !important; }';
  document.head.appendChild(style);

  window.__singra_inspect_active__ = false;

  window.addEventListener('message', function(ev) {
    if (ev.data && ev.data.type === 'SINGRA_SET_INSPECT') {
      window.__singra_inspect_active__ = !!ev.data.active;
      if (!window.__singra_inspect_active__ && activeHover) {
        activeHover.classList.remove('singra-inspect-hover');
        activeHover = null;
      }
    }
  });

  document.addEventListener('mouseover', function(e) {
    if (!window.__singra_inspect_active__) return;
    if (activeHover && activeHover !== e.target) {
      activeHover.classList.remove('singra-inspect-hover');
    }
    activeHover = e.target;
    if (activeHover) {
      activeHover.classList.add('singra-inspect-hover');
    }
  }, true);

  document.addEventListener('click', function(e) {
    if (!window.__singra_inspect_active__) return;
    e.preventDefault();
    e.stopPropagation();
    var el = e.target;
    if (!el) return;
    var tag = el.tagName.toLowerCase();
    var id = el.id ? '#' + el.id : '';
    var cls = (typeof el.className === 'string' && el.className.trim())
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    var textSnippet = (el.innerText || el.textContent || '').trim().slice(0, 40);
    var desc = tag + id + cls + (textSnippet ? ' ("' + textSnippet + '")' : '');

    window.parent.postMessage({
      type: 'SINGRA_ELEMENT_SELECTED',
      selector: desc,
      tag: tag,
      id: el.id || null,
      classes: el.className || null,
      text: textSnippet
    }, '*');
  }, true);
})();
</script>
`
}

export function useSingraPreview({
  selectedProject,
  files,
  productionFiles,
  projectChats,
  envState,
  sendTaskToProjectChat,
  onOpenProjectChat,
  onStartNewProjectChat,
}: UseSingraPreviewOptions) {
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop')
  const [inspectMode, setInspectMode] = useState(false)
  const [previewEnv, setPreviewEnv] = useState<'dev' | 'production'>('dev')
  const [devPreviewMode, setDevPreviewMode] = useState<'bundle' | 'live'>('bundle')
  const [inspectElement, setInspectElement] = useState<string | null>(null)
  const [inspectTargetChatId, setInspectTargetChatId] = useState<string>('__latest__')
  const previewIframeRef = useRef<HTMLIFrameElement>(null)
  const [previewError, setPreviewError] = useState<{ message: string; detail?: string } | null>(null)
  const [previewErrorDismissed, setPreviewErrorDismissed] = useState(false)
  const [fixTargetChatId, setFixTargetChatId] = useState<string>('__latest__')

  const [visualModalOpen, setVisualModalOpen] = useState(false)
  const [visualInspection, setVisualInspection] = useState<AiPreviewInspectionResult | null>(null)
  const [visualLoading, setVisualLoading] = useState(false)

  const [devConsoleOpen, setDevConsoleOpen] = useState(false)
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLogEntry[]>([])
  const [consoleFilter, setConsoleFilter] = useState<'all' | 'log' | 'warn' | 'error'>('all')

  const previewSrcDoc = useMemo(() => {
    const activeFiles: Array<{ path: string; content: string }> =
      previewEnv === 'production' ? productionFiles : files
    const base = buildPreviewDocument(activeFiles, envState?.preview?.entry_file ?? null)
    if (!base) return null
    let doc = base

    const bridgeScript = buildPreviewBridgeScript()
    if (doc.includes('</body>')) {
      doc = doc.replace('</body>', `${bridgeScript}</body>`)
    } else {
      doc += bridgeScript
    }

    return doc
  }, [files, productionFiles, previewEnv, envState?.preview?.entry_file])

  useEffect(() => {
    setPreviewError(null)
    setPreviewErrorDismissed(false)
  }, [previewSrcDoc])

  useEffect(() => {
    const handleMsg = (ev: MessageEvent) => {
      if (isPreviewErrorMessage(ev.data)) {
        if (ev.source !== previewIframeRef.current?.contentWindow) return
        const { message, detail } = ev.data
        if ((message === 'Skriptfehler' || message === 'Script error.') && !detail) {
          return
        }
        setPreviewError((prev) => prev ?? { message, detail })
        return
      }
      if (ev.data && ev.data.type === 'SINGRA_ELEMENT_SELECTED') {
        const selector = String(ev.data.selector || 'Element')
        setInspectElement(selector)
        setInspectMode(false)
        toast.success(`Element ausgewählt: ${selector}`)
        try {
          previewIframeRef.current?.contentWindow?.postMessage(
            { type: 'SINGRA_SET_INSPECT', active: false },
            '*',
          )
        } catch (err) {
          still(err, 'singra:preview:postMessage:deactivate')
        }
      }
    }
    window.addEventListener('message', handleMsg)
    return () => window.removeEventListener('message', handleMsg)
  }, [])

  useEffect(() => {
    const handleDevConsoleMsg = (ev: MessageEvent) => {
      if (ev.data && ev.data.type === 'SINGRA_DEV_CONSOLE') {
        setConsoleLogs((prev) => [
          ...prev.slice(-99),
          {
            level: ev.data.level,
            message: String(ev.data.message || ''),
            time: ev.data.time || new Date().toLocaleTimeString(),
          },
        ])
      }
    }
    window.addEventListener('message', handleDevConsoleMsg)
    return () => window.removeEventListener('message', handleDevConsoleMsg)
  }, [])

  useEffect(() => {
    try {
      previewIframeRef.current?.contentWindow?.postMessage(
        { type: 'SINGRA_SET_INSPECT', active: inspectMode },
        '*',
      )
    } catch (err) {
      still(err, 'singra:preview:postMessage:toggle')
    }
  }, [inspectMode])

  const handleApplyElementWithSingra = async (selector: string) => {
    if (!selectedProject) return
    const promptHint = `Bitte passe folgendes Element in diesem Projekt an: \`${selector}\` — `
    try {
      sessionStorage.setItem('singra-inspect-prompt', promptHint)
      window.dispatchEvent(
        new CustomEvent('singra-inspect-element', {
          detail: { projectId: selectedProject.id, selector, promptHint },
        }),
      )
    } catch (err) {
      still(err, 'singra:inspect:sessionStorage')
    }

    const targetId =
      inspectTargetChatId === '__latest__'
        ? projectChats[0]?.id ?? '__new__'
        : inspectTargetChatId

    if (targetId && targetId !== '__new__') {
      onOpenProjectChat(selectedProject.id, targetId)
      return
    }
    await onStartNewProjectChat(`Anpassung: ${selector.slice(0, 42)}`)
  }

  const handleFixPreviewWithSingra = async () => {
    const entry = envState?.preview?.entry_file || 'nicht konfiguriert'
    const prompt = previewError
      ? [
          'Die Live-Vorschau dieses Projekts zeigt einen Fehler.',
          '',
          `Fehler: ${previewError.message}`,
          previewError.detail ? `Details:\n\`\`\`\n${previewError.detail.slice(0, 2500)}\n\`\`\`` : '',
          `Vorschau-Einstieg: ${entry}`,
          '',
          'Bitte finde die Ursache und behebe sie in den Projektdateien. Richte die Vorschau bei Bedarf mit `configure_preview` neu ein und prüfe danach mit `test_project`, dass sie fehlerfrei lädt. Melde dich erst, wenn das nachgewiesen ist.',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          'Für dieses Projekt gibt es noch keine funktionierende Live-Vorschau.',
          '',
          'Bitte lege eine Browser-Einstiegsdatei an (z. B. `index.html` mit `#root` und `src/main.tsx`), halte Backend- und Testdateien in `backend/` bzw. `tests/` getrennt und registriere die Vorschau mit `configure_preview`. Prüfe anschließend mit `test_project`, dass `preview_ready: true` gemeldet wird.',
        ].join('\n')
    await sendTaskToProjectChat(prompt, fixTargetChatId, 'Vorschau reparieren')
  }

  const handleRunVisualInspection = async () => {
    if (!selectedProject || visualLoading) return
    setVisualModalOpen(true)
    setVisualLoading(true)
    try {
      const res = await aiApi.inspectProjectPreview(selectedProject.id, {
        viewports: ['mobile', 'desktop'],
      })
      setVisualInspection(res)
      if (!res.ok) {
        toast.warning(
          `Sichtprüfung: ${res.issues.length} Auffälligkeit(en) auf Smartphone oder Desktop erkannt.`,
        )
      } else {
        toast.success('Sichtprüfung bestanden: Mobil- und Desktop-Layout sind fehlerfrei.')
      }
    } catch (err: unknown) {
      still(err, 'singra:visualInspect')
      toast.error(err instanceof SanitizedApiError ? err.message : 'Sichtprüfung fehlgeschlagen.')
    } finally {
      setVisualLoading(false)
    }
  }

  const handleFixVisualIssuesWithSingra = async (issues: string[]) => {
    const prompt = [
      'Bei der visuellen Sichtprüfung der Vorschau wurden folgende Layout- und Render-Probleme auf Smartphone oder Desktop erkannt:',
      '',
      ...issues.map((iss) => `- ${iss}`),
      '',
      'Bitte korrigiere die betroffenen Projektdateien (z. B. overflow-x-hidden, max-w-full, responsive Tailwind-Klassen, Schriftgrößen oder DOM-Struktur), damit die Seite auf dem Smartphone sauber ohne seitlichen Überlauf dargestellt wird und keine JavaScript-Fehler auftreten.',
      'Prüfe nach deiner Reparatur mit `project_workspace` (action: "preview_inspect"), dass alle Viewports fehlerfrei sind.',
    ].join('\n')
    await sendTaskToProjectChat(prompt, '__latest__', 'Layout & Mobile optimieren')
  }

  return {
    previewDevice,
    setPreviewDevice,
    inspectMode,
    setInspectMode,
    previewEnv,
    setPreviewEnv,
    devPreviewMode,
    setDevPreviewMode,
    inspectElement,
    setInspectElement,
    inspectTargetChatId,
    setInspectTargetChatId,
    previewIframeRef,
    previewError,
    previewErrorDismissed,
    setPreviewErrorDismissed,
    fixTargetChatId,
    setFixTargetChatId,
    visualModalOpen,
    setVisualModalOpen,
    visualInspection,
    visualLoading,
    devConsoleOpen,
    setDevConsoleOpen,
    consoleLogs,
    setConsoleLogs,
    consoleFilter,
    setConsoleFilter,
    previewSrcDoc,
    handleApplyElementWithSingra,
    handleFixPreviewWithSingra,
    handleRunVisualInspection,
    handleFixVisualIssuesWithSingra,
  }
}
