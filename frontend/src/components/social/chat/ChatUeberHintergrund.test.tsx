/**
 * Was über dem Chat-Hintergrund steht, muss positioniert sein.
 *
 * `ChatHintergrund` legt eine absolut positionierte Schicht mit `z-0` über den
 * Kasten. Ein Element im Fluss ohne `relative` wird **darunter** gemalt: auf
 * einem echten Wandbild verschwanden Suchleiste und Anhangsleisten (bis
 * 27.10.2026), obwohl sie klickbar blieben. Der Test hält die Positionierung
 * fest, weil jsdom keine Malreihenfolge kennt.
 */

import { createRef } from 'react'
import { render } from '@testing-library/react'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import type { FileAttachment, ImageAttachment } from '@/components/social/ChatMediaAttachments'
import { ChatPinnedBar } from './ChatPinnedBar'
import { ChatTimeline } from './ChatTimeline'
import { EditingBanner, StagedFileBar, StagedImageBar } from './ChatComposerBars'
import { VerlaufSuchleiste } from '../VerlaufSuchleiste'

beforeAll(async () => {
  await i18n.changeLanguage('de')
})

function positioniert(element: Element | null): void {
  expect(element).not.toBeNull()
  expect(element!.className).toContain('relative')
}

describe('Leisten über dem Chat-Hintergrund', () => {
  it('positioniert die Suchleiste', () => {
    const { container } = render(
      <VerlaufSuchleiste
        onSchliessen={vi.fn()}
        onSuchen={vi.fn()}
        trefferAnzahl={0}
        aktuellerTreffer={0}
        onVor={vi.fn()}
        onZurueck={vi.fn()}
      />,
    )
    positioniert(container.firstElementChild)
  })

  it('positioniert die Angeheftet-Leiste', () => {
    const { container } = render(<ChatPinnedBar text="Regeln" onOeffnen={vi.fn()} />)
    positioniert(container.firstElementChild)
  })

  it('positioniert Anhang- und Bearbeiten-Leisten', () => {
    const bild = render(
      <StagedImageBar bild={{ dataUrl: 'data:image/webp;base64,AA', name: 'foto.webp' } as ImageAttachment} onEntfernen={vi.fn()} />,
    )
    positioniert(bild.container.firstElementChild)
    bild.unmount()

    const datei = render(
      <StagedFileBar datei={{ name: 'plan.pdf', sizeBytes: 10 } as FileAttachment} onEntfernen={vi.fn()} />,
    )
    positioniert(datei.container.firstElementChild)
    datei.unmount()

    const bearbeiten = render(<EditingBanner text="alt" onAbbrechen={vi.fn()} />)
    positioniert(bearbeiten.container.firstElementChild)
  })

  it('positioniert den Verlauf', () => {
    const { container } = render(
      <ChatTimeline
        scrollRef={createRef()}
        endeRef={createRef()}
        nachrichten={[]}
        laedt={false}
        trennerId={null}
        aktivitaet={null}
        istGruppe={false}
        zeichneNachricht={vi.fn()}
      />,
    )
    positioniert(container.firstElementChild)
  })
})
