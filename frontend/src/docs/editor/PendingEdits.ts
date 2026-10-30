import { Extension } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  fingerprintText,
  plainTextOfProseMirrorNode,
} from '@msm/docs-schema/structure'

import type {
  DocPendingEditPart,
  DocPendingPreviewPart,
  DocPendingView,
} from '@/api/docs'

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
  /** Platzhalter `{count}` wird ersetzt. */
  batchTitle: string
  editStale: string
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

interface BlockEintrag {
  pos: number
  node: PMNode
  fingerprint: string
}

function topLevelBlocks(doc: PMNode): BlockEintrag[] {
  const bloecke: BlockEintrag[] = []
  doc.forEach((node, offset) => {
    bloecke.push({
      pos: offset,
      node,
      fingerprint: fingerprintText(plainTextOfProseMirrorNode(node)),
    })
  })
  return bloecke
}

/**
 * Der Fingerabdruck ist die Wahrheit, der Index nur ein Hinweis: innerhalb
 * eines Batches verschieben sich Indizes durch vorherige Einfuegungen.
 */
function findeZiel(
  bloecke: BlockEintrag[],
  fingerprint: string | null | undefined,
  index: number | null | undefined,
): BlockEintrag | null {
  if (!fingerprint) return null
  const treffer = bloecke.filter((block) => block.fingerprint === fingerprint)
  if (treffer.length === 1) return treffer[0]
  if (treffer.length > 1 && Number.isInteger(index)) {
    const genau = bloecke[Number(index)]
    if (genau && genau.fingerprint === fingerprint) return genau
  }
  return null
}

interface ErkanntesZiel {
  block: BlockEintrag | null
  op: string
  summary: string | null
}

function erkenneBatch(
  doc: PMNode,
  vorschlag: DocPendingView,
): { ziele: ErkanntesZiel[]; unaufgeloest: boolean; bloecke: BlockEintrag[] } {
  const bloecke = topLevelBlocks(doc)
  const teile: DocPendingEditPart[] = vorschlag.edits ?? []
  const vorschauen = new Map<number, DocPendingPreviewPart>()
  for (const vorschau of vorschlag.previews ?? []) {
    vorschauen.set(vorschau.index, vorschau)
  }

  const ziele = teile.map((teil, index) => {
    const vorschau = vorschauen.get(index)
    if (teil.op === 'append') {
      return { block: null, op: teil.op, summary: teil.summary }
    }
    const fingerprint = teil.target?.fingerprint ?? vorschau?.target_fingerprint
    const block = findeZiel(bloecke, fingerprint, teil.target?.index)
    return { block, op: teil.op, summary: teil.summary }
  })

  // `append_to_section` hat als Vorschauposition die Stelle hinter dem
  // Abschnitt; das Ziel ist die Ueberschrift und bleibt der Anker.
  const unaufgeloest = ziele.some((ziel) => ziel.op !== 'append' && !ziel.block)
  return { ziele, unaufgeloest, bloecke }
}

function baueDecorations(doc: PMNode, handles: PendingHandles): DecorationSet {
  const vorschlag = handles.get()
  if (!vorschlag || vorschlag.stale) return DecorationSet.empty

  const dekorationen: Decoration[] = []
  let widgetPos = doc.content.size
  let titel = handles.labels.title
  let gesperrt = false
  let anzahl = 0

  if (vorschlag.edits && vorschlag.edits.length > 0) {
    const { ziele, unaufgeloest, bloecke } = erkenneBatch(doc, vorschlag)
    anzahl = ziele.length
    gesperrt = unaufgeloest
    titel =
      anzahl > 1
        ? handles.labels.batchTitle.replace('{count}', String(anzahl))
        : handles.labels.title

    let letztePosition = -1
    ziele.forEach((ziel) => {
      if (!ziel.block) return
      // Nur ein Ersatz oder eine Loeschung streicht den alten Text durch.
      // Bei insert_* ist der Block ein Anker, kein verschwindender Inhalt.
      const klasse =
        ziel.op === 'delete_block'
          ? 'docs-ai-vorschlag-ziel docs-ai-vorschlag-loeschen'
          : ziel.op === 'replace_block'
            ? 'docs-ai-vorschlag-ziel'
            : 'docs-ai-vorschlag-anker'
      dekorationen.push(
        Decoration.node(
          ziel.block.pos,
          ziel.block.pos + ziel.block.node.nodeSize,
          { class: klasse },
        ),
      )
      if (ziel.block.pos + ziel.block.node.nodeSize > letztePosition) {
        letztePosition = ziel.block.pos + ziel.block.node.nodeSize
      }
    })

    // Die Vorschau haengt hinter der letzten betroffenen Stelle. Ein reines
    // `append` bleibt am Dokumentende.
    const vorschauen = vorschlag.previews ?? []
    const letzteVorschau = vorschauen[vorschauen.length - 1]
    if (letztePosition >= 0) {
      widgetPos = letztePosition
    } else if (letzteVorschau?.target_index != null) {
      const block = bloecke[Math.min(letzteVorschau.target_index, bloecke.length - 1)]
      widgetPos = block ? block.pos + block.node.nodeSize : doc.content.size
    }
  } else if (vorschlag.operation === 'replace_block') {
    // Altformat ohne `edits`: Ziel ueber Zieltext oder Zitat.
    const gesucht = (vorschlag.target_block || '').trim()
    const quote = (vorschlag.anchor_quote || '').trim()
    const bloecke = topLevelBlocks(doc)
    const exakt = bloecke.filter(
      (block) => gesucht && plainTextOfProseMirrorNode(block.node).trim() === gesucht,
    )
    const zitat = bloecke.filter(
      (block) => quote && plainTextOfProseMirrorNode(block.node).includes(quote),
    )
    const treffer = exakt.length === 1 ? exakt : zitat.length === 1 ? zitat : []
    if (treffer.length !== 1) return DecorationSet.empty
    const ziel = treffer[0]
    dekorationen.push(
      Decoration.node(ziel.pos, ziel.pos + ziel.node.nodeSize, {
        class: 'docs-ai-vorschlag-ziel',
      }),
    )
    widgetPos = ziel.pos + ziel.node.nodeSize
  } else if (vorschlag.operation !== 'append') {
    return DecorationSet.empty
  }

  if (anzahl === 0 && !vorschlag.html && vorschlag.operation !== 'append') {
    // Ohne Vorschau und ohne Batch gibt es nichts zu zeigen.
    return DecorationSet.empty
  }

  dekorationen.push(
    Decoration.widget(
      widgetPos,
      () =>
        baueVorschlagDom(vorschlag, handles, {
          titel,
          anzahl,
          gesperrt,
        }),
      {
        side: 1,
        // Der Schluessel enthaelt Html und Busy-Zustand: aendert sich einer,
        // baut ProseMirror das Widget neu, statt den alten Knopf zu behalten.
        key: `${vorschlag.uid}:${vorschlag.status}:${vorschlag.html ?? ''}:${handles.busy()}:${titel}:${gesperrt}`,
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
  zustand: { titel: string; anzahl: number; gesperrt: boolean },
): HTMLElement {
  const labels = handles.labels
  const busy = handles.busy() || vorschlag.status === 'applying'
  const wrapper = document.createElement('div')
  wrapper.className = 'docs-ai-vorschlag'
  wrapper.dataset.pendingUid = vorschlag.uid
  wrapper.setAttribute('contenteditable', 'false')
  wrapper.setAttribute('role', 'group')
  wrapper.setAttribute('aria-label', zustand.titel)

  const kopf = document.createElement('div')
  kopf.className = 'docs-ai-vorschlag-kopf'
  kopf.textContent = zustand.titel
  wrapper.appendChild(kopf)

  if (zustand.anzahl > 1 && vorschlag.edits) {
    const liste = document.createElement('ul')
    liste.className = 'docs-ai-vorschlag-liste'
    for (const teil of vorschlag.edits) {
      const eintrag = document.createElement('li')
      eintrag.textContent = teil.summary || teil.op
      liste.appendChild(eintrag)
    }
    wrapper.appendChild(liste)
  }

  if (vorschlag.html) {
    const inhalt = document.createElement('div')
    inhalt.className = 'docs-prose docs-ai-vorschlag-inhalt'
    // Der Sidecar rendert nur erlaubte Links und Bildplatzhalter; der Text
    // selbst ist bereits escaped. Die zweite Schranke entfernt trotzdem
    // alles, was nicht im Dokument-Schema vorkommt.
    inhalt.innerHTML = sichereVorschauHtml(vorschlag.html)
    wrapper.appendChild(inhalt)
  }

  if (zustand.gesperrt) {
    const hinweis = document.createElement('p')
    hinweis.className = 'docs-ai-vorschlag-hinweis'
    hinweis.textContent = labels.editStale
    wrapper.appendChild(hinweis)
  }

  const aktionen = document.createElement('div')
  aktionen.className = 'docs-ai-vorschlag-aktionen'

  const uebernehmen = document.createElement('button')
  uebernehmen.type = 'button'
  uebernehmen.className = 'docs-ai-vorschlag-aktion docs-ai-vorschlag-uebernehmen'
  uebernehmen.disabled = busy || zustand.gesperrt
  uebernehmen.textContent = busy ? labels.applying : labels.apply
  uebernehmen.addEventListener('mousedown', (event) => event.preventDefault())
  uebernehmen.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (!handles.busy() && !zustand.gesperrt) handles.onApply()
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
