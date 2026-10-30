import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

import type { DocPendingView } from '@/api/docs'

const ERLAUBTE_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI',
  'BLOCKQUOTE', 'PRE', 'CODE', 'STRONG', 'EM', 'U', 'S', 'MARK',
  'SPAN', 'HR', 'BR', 'TABLE', 'TBODY', 'TR', 'TH', 'TD', 'INPUT',
])

/**
 * Der Sidecar escaped Text und laesst nur sichere Links zu; diese zweite
 * Schranke entfernt trotzdem alles, was nicht im Dokument-Schema vorkommt.
 * Ein `innerHTML` aus einer Netzwerkantwort ist sonst genau die Stelle, an
 * der ein spaeterer Renderer-Wechsel still zur Luecke wird.
 */
function sichereVorschauHtml(html: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')

  const saeubern = (el: Element) => {
    // Kinder zuerst: ein unbekannter Container darf nichts Ungeprueftes
    // mitnehmen, wenn er aufgeloest wird.
    for (const kind of Array.from(el.children)) {
      const tag = kind.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'IFRAME' || tag === 'OBJECT') {
        kind.remove()
        continue
      }
      if (!ERLAUBTE_TAGS.has(tag)) {
        saeubern(kind)
        kind.replaceWith(...Array.from(kind.childNodes))
        continue
      }
      for (const attribut of Array.from(kind.attributes)) {
        const name = attribut.name.toLowerCase()
        const erlaubt =
          name === 'class' ||
          (tag === 'INPUT' && (name === 'type' || name === 'disabled' || name === 'checked'))
        if (!erlaubt) kind.removeAttribute(attribut.name)
      }
      saeubern(kind)
    }
  }
  saeubern(doc.body)
  return doc.body.innerHTML
}

export interface PendingLabels {
  title: string
  apply: string
  reject: string
  applying: string
}

export interface PendingHandles {
  get: () => DocPendingView | null
  busy: () => boolean
  onApply: () => void
  onReject: () => void
  labels: PendingLabels
}

/**
 * Zeigt den KI-Vorschlag als Dekoration im Editor.
 *
 * Dekorationen leben nur in der Ansicht dieses einen Browsers; sie beruehren
 * weder das Yjs-Dokument noch den Server. Andere Mitarbeiter sehen deshalb
 * nichts, bis der Vorschlag uebernommen wurde.
 */
export function createPendingEdits(handles: { current: PendingHandles }): Extension {
  return Extension.create({
    name: 'docsPendingEdits',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('docsPendingEdits'),
          props: {
            decorations: (state) => baueDecorations(state.doc, handles.current),
          },
        }),
      ]
    },
  })
}

/** Ein Transaktions-Meta, das nur die Dekorationen neu zeichnen laesst. */
export const PENDING_REFRESH_META = 'docsPendingRefresh'

function baueDecorations(doc: PMNode, handles: PendingHandles): DecorationSet {
  const vorschlag = handles.get()
  if (!vorschlag || vorschlag.stale || !vorschlag.html) return DecorationSet.empty

  let ziel: { pos: number; node: PMNode } | null = null
  if (vorschlag.operation === 'replace_block') {
    const exakt: { pos: number; node: PMNode }[] = []
    const zitat: { pos: number; node: PMNode }[] = []
    const gesucht = (vorschlag.target_block || '').trim()
    const quote = (vorschlag.anchor_quote || '').trim()
    doc.descendants((node, pos) => {
      if (!node.isTextblock) return true
      const text = node.textBetween(0, node.content.size, ' ')
      if (gesucht && text === gesucht) exakt.push({ pos, node })
      else if (quote && text.includes(quote)) zitat.push({ pos, node })
      return true
    })
    const treffer = exakt.length === 1 ? exakt : zitat.length === 1 ? zitat : []
    if (treffer.length !== 1) return DecorationSet.empty
    ziel = treffer[0]
  }

  const dekorationen: Decoration[] = []
  if (ziel) {
    dekorationen.push(
      Decoration.node(ziel.pos, ziel.pos + ziel.node.nodeSize, {
        class: 'docs-ai-vorschlag-ziel',
      }),
    )
  }
  const widgetPos = ziel ? ziel.pos + ziel.node.nodeSize : doc.content.size
  dekorationen.push(
    Decoration.widget(
      widgetPos,
      () => baueVorschlagDom(vorschlag, handles),
      {
        side: 1,
        // Der Schluessel enthaelt Html und Busy-Zustand: aendert sich einer,
        // baut ProseMirror das Widget neu, statt den alten Knopf zu behalten.
        key: `${vorschlag.uid}:${vorschlag.status}:${vorschlag.html ?? ''}:${handles.busy()}:${handles.labels.title}`,
        ignoreSelection: true,
        stopEvent: () => true,
      },
    ),
  )
  return DecorationSet.create(doc, dekorationen)
}

function baueVorschlagDom(
  vorschlag: DocPendingView,
  handles: PendingHandles,
): HTMLElement {
  const labels = handles.labels
  const busy = handles.busy() || vorschlag.status === 'applying'
  const wrapper = document.createElement('div')
  wrapper.className = 'docs-ai-vorschlag'
  wrapper.dataset.pendingUid = vorschlag.uid
  wrapper.setAttribute('contenteditable', 'false')
  wrapper.setAttribute('role', 'group')
  wrapper.setAttribute('aria-label', labels.title)

  const kopf = document.createElement('div')
  kopf.className = 'docs-ai-vorschlag-kopf'
  kopf.textContent = labels.title
  wrapper.appendChild(kopf)

  const inhalt = document.createElement('div')
  inhalt.className = 'docs-prose docs-ai-vorschlag-inhalt'
  // Der Sidecar rendert nur erlaubte Links und Bildplatzhalter; der Text
  // selbst ist bereits escaped. Die zweite Schranke entfernt trotzdem
  // alles, was nicht im Dokument-Schema vorkommt.
  inhalt.innerHTML = sichereVorschauHtml(vorschlag.html ?? '')
  wrapper.appendChild(inhalt)

  const aktionen = document.createElement('div')
  aktionen.className = 'docs-ai-vorschlag-aktionen'

  const uebernehmen = document.createElement('button')
  uebernehmen.type = 'button'
  uebernehmen.className = 'docs-ai-vorschlag-aktion docs-ai-vorschlag-uebernehmen'
  uebernehmen.disabled = busy
  uebernehmen.textContent = busy ? labels.applying : labels.apply
  uebernehmen.addEventListener('mousedown', (event) => event.preventDefault())
  uebernehmen.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!handles.busy()) handles.onApply()
  })

  const verwerfen = document.createElement('button')
  verwerfen.type = 'button'
  verwerfen.className = 'docs-ai-vorschlag-aktion docs-ai-vorschlag-verwerfen'
  verwerfen.disabled = busy
  verwerfen.textContent = labels.reject
  verwerfen.addEventListener('mousedown', (event) => event.preventDefault())
  verwerfen.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!handles.busy()) handles.onReject()
  })

  aktionen.append(uebernehmen, verwerfen)
  wrapper.appendChild(aktionen)
  return wrapper
}
