import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiStream } = vi.hoisted(() => ({
  apiStream: vi.fn(),
}))

vi.mock('@/api/client', async (original) => ({
  ...(await original<object>()),
  apiStream,
}))

vi.mock('@/hooks/useHasPermission', async () => {
  const { useState } = await import('react')
  return { useHasPermission: () => useState(true)[0] }
})

const { SuchzusammenfassungKachel } = await import('./SuchzusammenfassungKachel')

const TREFFER = [
  { titel: 'Erster Treffer', url: 'https://example.com/1', inhalt: 'Beschreibung eins' },
  { titel: 'Zweiter Treffer', url: 'https://example.com/2', inhalt: 'Beschreibung zwei' },
]

describe('SuchzusammenfassungKachel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sagt, dass der Überblick nicht eingerichtet ist, statt stumm zu verschwinden', async () => {
    // SSE stream liefert sofort "disabled"
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              const chunk = new TextEncoder().encode('data: {"type": "disabled", "reason": "not_configured"}\n\n')
              return Promise.resolve({ done: false, value: chunk })
            },
          }
        },
      },
    })

    render(<SuchzusammenfassungKachel begriff="Testsuche" treffer={TREFFER} />)
    expect(await screen.findByText(/nicht eingerichtet|not set up/i)).toBeInTheDocument()
  })

  it('nennt das fehlende Recht, wenn die Rolle den Überblick nicht nutzen darf', async () => {
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              const chunk = new TextEncoder().encode('data: {"type": "disabled", "reason": "permission"}\n\n')
              return Promise.resolve({ done: false, value: chunk })
            },
          }
        },
      },
    })

    render(<SuchzusammenfassungKachel begriff="Testsuche" treffer={TREFFER} />)
    expect(await screen.findByText(/Singra-Überblick nicht nutzen|may not use the Singra overview/i)).toBeInTheDocument()
  })

  it('zeigt die Meldung des Servers, wenn der Stream abgelehnt wird', async () => {
    const { SanitizedApiError } = await import('@/api/client')
    apiStream.mockRejectedValueOnce(
      new SanitizedApiError('Zu viele Anfragen. Bitte warte einen kurzen Moment.', { status: 429 }),
    )

    render(<SuchzusammenfassungKachel begriff="Testsuche" treffer={TREFFER} />)

    expect(
      await screen.findByText('Zu viele Anfragen. Bitte warte einen kurzen Moment.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Erneut versuchen|Try again/i })).toBeInTheDocument()
    // Der Aufbau bekommt eine Frist, damit ein hängender Lauf nicht ewig lädt.
    expect(apiStream.mock.calls[0][1].connectTimeoutMs).toBe(30_000)
  })

  it('zeigt eine Fehlerkarte, wenn der Stream ohne Inhalt endet', async () => {
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: () => Promise.resolve({ done: true, value: undefined }),
        }),
      },
    })

    render(<SuchzusammenfassungKachel begriff="Testsuche" treffer={TREFFER} />)
    expect(
      await screen.findByText(/Die KI hat keine Antwort geliefert|The AI returned no answer/i),
    ).toBeInTheDocument()
  })

  it('zeigt Ladezustand und streamt Markdown-Inhalt mit klickbaren Quellenverweisen', async () => {
    let readCount = 0
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: () => {
            readCount++
            if (readCount === 1) {
              const chunk = new TextEncoder().encode('data: {"type": "start", "model": "gpt-6-luna"}\n\n')
              return Promise.resolve({ done: false, value: chunk })
            }
            if (readCount === 2) {
              const chunk = new TextEncoder().encode('data: {"type": "content", "text": "Hier ist die Antwort [1]."}\n\n')
              return Promise.resolve({ done: false, value: chunk })
            }
            if (readCount === 3) {
              const chunk = new TextEncoder().encode('data: {"type": "done"}\n\n')
              return Promise.resolve({ done: false, value: chunk })
            }
            return Promise.resolve({ done: true, value: undefined })
          },
        }),
      },
    })

    // DOM-Ziel für die Verlinkung vorbereiten
    const zielTreffer = document.createElement('div')
    zielTreffer.id = 'treffer-1'
    zielTreffer.scrollIntoView = vi.fn()
    document.body.appendChild(zielTreffer)

    render(<SuchzusammenfassungKachel begriff="Testsuche" treffer={TREFFER} />)

    // Die Antwort erscheint; interne Modellnamen oder technische Tab-Hinweise bleiben unsichtbar.
    expect(await screen.findByText(/Hier ist die Antwort/)).toBeInTheDocument()
    expect(screen.queryByText('gpt-6-luna')).not.toBeInTheDocument()
    expect(screen.queryByText(/Nur in diesem Tab aktiv|Active in this tab only/i)).not.toBeInTheDocument()

    // Quellenbutton [1] existiert und scrollt beim Klick zum Treffer. Der Name
    // nennt die Nummer, damit die Kachel mehrere Quellknöpfe zeigen kann.
    const quelleBtn = screen.getByRole('button', { name: 'Quelle 1' })
    fireEvent.click(quelleBtn)
    expect(zielTreffer.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })

    document.body.removeChild(zielTreffer)
  })

  it('erlaubt das Einklappen und Ausklappen der Kachel', async () => {
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              const chunk = new TextEncoder().encode(
                'data: {"type": "start", "model": "gpt-4o"}\n\ndata: {"type": "content", "text": "Fertige Zusammenfassung"}\n\ndata: {"type": "done"}\n\n',
              )
              return Promise.resolve({ done: false, value: chunk })
            },
          }
        },
      },
    })

    render(<SuchzusammenfassungKachel begriff="Testsuche" treffer={TREFFER} />)

    expect(await screen.findByText('Fertige Zusammenfassung')).toBeInTheDocument()

    // Einklappen-Button anklicken
    const einklappenBtn = screen.getByRole('button', { name: /Einklappen|Collapse/i })
    fireEvent.click(einklappenBtn)

    // Inhalt ist eingeklappt
    expect(screen.queryByText('Fertige Zusammenfassung')).not.toBeInTheDocument()

    // Ausklappen-Button anklicken
    const ausklappenBtn = screen.getByRole('button', { name: /Ausklappen|Expand/i })
    fireEvent.click(ausklappenBtn)

    // Inhalt ist wieder da
    expect(screen.getByText('Fertige Zusammenfassung')).toBeInTheDocument()
  })

  it('zeigt die selbständige Nachrecherche mit den Suchanfragen', async () => {
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              const chunk = new TextEncoder().encode(
                'data: {"type": "start", "model": "gpt-4o"}\n\n' +
                  'data: {"type": "recherche", "anfrage": "Grafikkarte einbauen Anleitung"}\n\n' +
                  'data: {"type": "recherche", "anfrage": "Grafikkarte Stromanschluss"}\n\n' +
                  'data: {"type": "content", "text": "So geht der Einbau [1]."}\n\n' +
                  'data: {"type": "done"}\n\n',
              )
              return Promise.resolve({ done: false, value: chunk })
            },
          }
        },
      },
    })

    render(<SuchzusammenfassungKachel begriff="Testsuche" treffer={TREFFER} />)

    expect(await screen.findByText(/Sucht weiter|Researching further/)).toBeInTheDocument()
    expect(screen.getByText(/Grafikkarte einbauen Anleitung/)).toBeInTheDocument()
    expect(screen.getByText(/Grafikkarte Stromanschluss/)).toBeInTheDocument()
    expect(await screen.findByText(/So geht der Einbau/)).toBeInTheDocument()
  })

  it('zeigt Denkprozess und klappt ihn bei Content zu, ohne Denkstufen-Dropdown', async () => {
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              const chunk = new TextEncoder().encode(
                'data: {"type": "start", "model": "o3-mini"}\n\n' +
                'data: {"type": "thought", "text": "Ich analysiere die Quellen..."}\n\n' +
                'data: {"type": "content", "text": "Ergebnis mit Denkstufe"}\n\n' +
                'data: {"type": "done"}\n\n',
              )
              return Promise.resolve({ done: false, value: chunk })
            },
          }
        },
      },
    })

    render(<SuchzusammenfassungKachel begriff="Testsuche" treffer={TREFFER} />)

    expect(await screen.findByText('Ergebnis mit Denkstufe')).toBeInTheDocument()
    expect(screen.queryByText('o3-mini')).not.toBeInTheDocument()
    // Denkprozess ist in details vorhanden
    expect(screen.getByText('Ich analysiere die Quellen...')).toBeInTheDocument()

    // Kein Denkstufen-Dropdown
    expect(screen.queryByRole('button', { name: /Denkstufe/i })).not.toBeInTheDocument()
  })

  it('klappt die Quellen als Logo-Leiste und nur auf Wunsch als Karten', async () => {
    let readCount = 0
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: () => {
            readCount += 1
            if (readCount === 1) {
              return Promise.resolve({
                done: false,
                value: new TextEncoder().encode(
                  'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Text"}\n\ndata: {"type": "done"}\n\n',
                ),
              })
            }
            return Promise.resolve({ done: true, value: undefined })
          },
        }),
      },
    })

    render(<SuchzusammenfassungKachel begriff="Testsuche" treffer={TREFFER} />)
    expect(await screen.findByText('Text')).toBeInTheDocument()

    // Eingeklappt: genau ein Symbol je Quelle, kein Titeltext der Karte.
    expect(screen.getAllByRole('button', { name: 'example.com' })).toHaveLength(2)
    expect(screen.queryByText('Zweiter Treffer')).not.toBeInTheDocument()

    // Ein Klick klappt die Vorschaukarten mit Titel auf.
    fireEvent.click(screen.getByRole('button', { name: /Top-Quellen 2 ein- oder ausblenden/ }))
    expect(await screen.findByText('Zweiter Treffer')).toBeInTheDocument()
  })

  it('startet im StrictMode einen Lauf, statt nach dem Abriss leer zu bleiben', async () => {
    // StrictMode mountet Effekte doppelt: erst der Abriss, dann der zweite Lauf.
    // Der Abbruch muss den Neustart erlauben, sonst bleibt die Kachel leer –
    // im Netz sah das wie ein Preflight ohne POST aus.
    apiStream.mockImplementation(
      (_pfad: string, optionen: { signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          optionen.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('abgebrochen'), { name: 'AbortError' })),
          )
          setTimeout(
            () =>
              resolve({
                ok: true,
                status: 200,
                body: {
                  getReader: () => {
                    let fertig = false
                    return {
                      read: () => {
                        if (fertig) return Promise.resolve({ done: true, value: undefined })
                        fertig = true
                        return Promise.resolve({
                          done: false,
                          value: new TextEncoder().encode(
                            'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Im StrictMode angekommen"}\n\ndata: {"type": "done"}\n\n',
                          ),
                        })
                      },
                    }
                  },
                },
              }),
            5,
          )
        }),
    )

    render(
      <StrictMode>
        <SuchzusammenfassungKachel begriff="Testsuche" treffer={TREFFER} />
      </StrictMode>,
    )

    expect(await screen.findByText('Im StrictMode angekommen')).toBeInTheDocument()
    // Genau ein Aufruf: ein abgebrochener erster Anlauf würde der zweiten
    // Anfrage den gemeinsamen CORS-Preflight nehmen.
    expect(apiStream).toHaveBeenCalledTimes(1)
  })

  it('sendet bei der ersten Folgefrage Ausgangsfrage und Antwort als alternierenden Verlauf', async () => {
    // Initiale Zusammenfassung
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              const chunk = new TextEncoder().encode(
                'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Initiale Antwort"}\n\ndata: {"type": "done"}\n\n',
              )
              return Promise.resolve({ done: false, value: chunk })
            },
          }
        },
      },
    })
    // Folgefrage-Antwort
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => ({
          read: () => Promise.resolve({ done: true, value: undefined }),
        }),
      },
    })

    render(<SuchzusammenfassungKachel begriff="Ausgangsfrage" treffer={TREFFER} />)
    expect(await screen.findByText('Initiale Antwort')).toBeInTheDocument()

    const eingabe = screen.getByRole('textbox')
    fireEvent.change(eingabe, { target: { value: 'Und nachts?' } })
    fireEvent.click(screen.getByRole('button', { name: /Senden|Send/i }))

    await waitFor(() => {
      expect(apiStream).toHaveBeenCalledTimes(2)
    })
    const folgeBody = JSON.parse(apiStream.mock.calls[1][1].body as string)
    // user (Ausgangsfrage) -> assistant (hauptText) -> user (Folgefrage)
    expect(folgeBody.verlauf.map((e: { role: string }) => e.role)).toEqual(['user', 'assistant', 'user'])
    expect(folgeBody.verlauf[0].content).toBe('Ausgangsfrage')
    expect(folgeBody.verlauf[1].content).toBe('Initiale Antwort')
    expect(folgeBody.verlauf[2].content).toBe('Und nachts?')
  })

  it('zeigt bei Stream-Fehler einen Wiederholen-Knopf statt ewigem Spinner', async () => {
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              const chunk = new TextEncoder().encode(
                'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Initiale Antwort"}\n\ndata: {"type": "done"}\n\n',
              )
              return Promise.resolve({ done: false, value: chunk })
            },
          }
        },
      },
    })
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              const chunk = new TextEncoder().encode('data: {"type": "error", "message": "Upstream boom"}\n\n')
              return Promise.resolve({ done: false, value: chunk })
            },
          }
        },
      },
    })

    render(<SuchzusammenfassungKachel begriff="Ausgangsfrage" treffer={TREFFER} />)
    expect(await screen.findByText('Initiale Antwort')).toBeInTheDocument()

    const eingabe = screen.getByRole('textbox')
    fireEvent.change(eingabe, { target: { value: 'Folgefrage?' } })
    fireEvent.click(screen.getByRole('button', { name: /Senden|Send/i }))

    // Fehlermeldung mit Retry statt "Antwort wird generiert …" im Dauer-Spinner
    expect(await screen.findByRole('button', { name: /Erneut versuchen|Try again/i })).toBeInTheDocument()
    expect(screen.queryByText('Upstream boom')).toBeInTheDocument()
  })

  it('lässt Kopierknopf aktiv und meldet Status in externer Live-Region', async () => {
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              const chunk = new TextEncoder().encode(
                'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Kopierbarer Text"}\n\ndata: {"type": "done"}\n\n',
              )
              return Promise.resolve({ done: false, value: chunk })
            },
          }
        },
      },
    })

    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })

    render(<SuchzusammenfassungKachel begriff="Kopie" treffer={TREFFER} />)
    expect(await screen.findByText('Kopierbarer Text')).toBeInTheDocument()

    const kopierBtn = screen.getByRole('button', { name: /Antwort kopieren|Copy answer/i })
    fireEvent.click(kopierBtn)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('Kopierbarer Text'))
    expect(kopierBtn).not.toBeDisabled()
    expect(kopierBtn).toHaveAttribute('data-copied', '')

    const liveRegionen = screen.getAllByRole('status')
    expect(liveRegionen[0].textContent).toMatch(/Kopiert|Copied/)

    // Wiederholtes Kopieren hängt U+00A0 an, damit Screenreader erneut vorlesen.
    fireEvent.click(kopierBtn)
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
    expect(liveRegionen[0].textContent?.endsWith('\u00A0')).toBe(true)

    // Fehlerfall beim Kopieren
    writeText.mockRejectedValueOnce(new Error('Clipboard blocked'))
    fireEvent.click(kopierBtn)
    await waitFor(() => expect(kopierBtn).toHaveAttribute('data-failed', ''))
    expect(kopierBtn).not.toBeDisabled()
    expect(liveRegionen[0].textContent).toMatch(/Kopieren fehlgeschlagen|Copy failed/i)
  })

  it('sendet Nachfrage bei IME-Enter (isComposing / keyCode 229) nicht ab', async () => {
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              const chunk = new TextEncoder().encode(
                'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Antwort"}\n\ndata: {"type": "done"}\n\n',
              )
              return Promise.resolve({ done: false, value: chunk })
            },
          }
        },
      },
    })

    render(<SuchzusammenfassungKachel begriff="Frage" treffer={TREFFER} />)
    expect(await screen.findByText('Antwort')).toBeInTheDocument()

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'IME-Test' } })
    const key1 = fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    const key2 = fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, which: 229 })
    expect(key1).toBe(false)
    expect(key2).toBe(false)
    expect(apiStream).toHaveBeenCalledTimes(1)
  })

  it('zeigt Lese-Bestätigung (An Singra übergeben -> Von Singra gelesen) für Folgefragen', async () => {
    // 1. Initiale Zusammenfassung
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              return Promise.resolve({
                done: false,
                value: new TextEncoder().encode(
                  'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Initiale Übersicht"}\n\ndata: {"type": "done"}\n\n',
                ),
              })
            },
          }
        },
      },
    })

    // 2. Folgefrage mit kontrollierter Stream-Auslieferung
    let gebeStartFrei: (() => void) | null = null
    apiStream.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          gebeStartFrei = () =>
            resolve({
              ok: true,
              body: {
                getReader: () => {
                  let gesendet = false
                  return {
                    read: () => {
                      if (gesendet) return Promise.resolve({ done: true, value: undefined })
                      gesendet = true
                      return Promise.resolve({
                        done: false,
                        value: new TextEncoder().encode(
                          'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Folgeantwort"}\n\ndata: {"type": "done"}\n\n',
                        ),
                      })
                    },
                  }
                },
              },
            })
        }),
    )

    render(<SuchzusammenfassungKachel begriff="Ausgangsfrage" treffer={TREFFER} />)
    expect(await screen.findByText('Initiale Übersicht')).toBeInTheDocument()

    const eingabe = screen.getByRole('textbox')
    fireEvent.change(eingabe, { target: { value: 'Wie genau?' } })
    fireEvent.click(screen.getByRole('button', { name: /Senden|Send/i }))

    // Ausgangsfrage/Übersicht wird im Verlauf nicht doppelt gerendert
    expect(screen.getAllByText('Initiale Übersicht')).toHaveLength(1)
    // Zunächst „An Singra übergeben“ (zwei graue Haken)
    expect(await screen.findByRole('img', { name: 'An Singra übergeben' })).toBeInTheDocument()

    // Sobald SSE antwortet -> „Von Singra gelesen“ (zwei blaue Haken)
    gebeStartFrei?.()
    expect(await screen.findByRole('img', { name: 'Von Singra gelesen' })).toBeInTheDocument()
    expect(await screen.findByText('Folgeantwort')).toBeInTheDocument()
  })

  it('nutzt die KI-Chat-Eingabelogik (Shift+Enter, Stopp, Warteschlange & Alt+Enter)', async () => {
    // 1. Initiale Zusammenfassung
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              return Promise.resolve({
                done: false,
                value: new TextEncoder().encode(
                  'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Startantwort"}\n\ndata: {"type": "done"}\n\n',
                ),
              })
            },
          }
        },
      },
    })

    // 2. Erste Folgefrage bleibt offen bis wir sie beenden
    let schliesseErste: (() => void) | null = null
    apiStream.mockImplementationOnce(() => ({
      ok: true,
      body: {
        getReader: () => {
          let phase = 0
          return {
            read: () => {
              phase += 1
              if (phase === 1) {
                return Promise.resolve({
                  done: false,
                  value: new TextEncoder().encode(
                    'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Antwort eins"}\n\n',
                  ),
                })
              }
              if (phase === 2) {
                return new Promise((resolve) => {
                  schliesseErste = () =>
                    resolve({
                      done: false,
                      value: new TextEncoder().encode('data: {"type": "done"}\n\n'),
                    })
                })
              }
              return Promise.resolve({ done: true, value: undefined })
            },
            cancel: vi.fn(),
          }
        },
      },
    }))

    // 3. Warteschlangen-Folgefrage läuft automatisch nach
    apiStream.mockResolvedValueOnce({
      ok: true,
      body: {
        getReader: () => {
          let gesendet = false
          return {
            read: () => {
              if (gesendet) return Promise.resolve({ done: true, value: undefined })
              gesendet = true
              return Promise.resolve({
                done: false,
                value: new TextEncoder().encode(
                  'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Antwort zwei"}\n\ndata: {"type": "done"}\n\n',
                ),
              })
            },
          }
        },
      },
    })

    render(<SuchzusammenfassungKachel begriff="Basis" treffer={TREFFER} />)
    expect(await screen.findByText('Startantwort')).toBeInTheDocument()

    const eingabe = screen.getByRole('textbox')
    // Shift+Enter sendet nicht ab
    fireEvent.change(eingabe, { target: { value: 'Frage eins' } })
    fireEvent.keyDown(eingabe, { key: 'Enter', shiftKey: true })
    expect(apiStream).toHaveBeenCalledTimes(1)

    // Enter sendet ab; während Antwort streamt bleibt das Feld bedienbar + Stopp-Button sichtbar
    fireEvent.keyDown(eingabe, { key: 'Enter' })
    expect(await screen.findByText('Antwort eins')).toBeInTheDocument()
    expect(eingabe).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /KI stoppen|Stop the AI/i })).toBeInTheDocument()

    // Tippen während Stream blendet Warteschlange + Unterbrechen ein
    fireEvent.change(eingabe, { target: { value: 'Zweite aus Queue' } })
    expect(screen.getByRole('button', { name: /In Warteschlange einreihen|Add to queue/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sofort senden und unterbrechen|Send now and interrupt/i })).toBeInTheDocument()

    // Enter reiht in Warteschlange ein und zeigt Banner
    fireEvent.keyDown(eingabe, { key: 'Enter' })
    expect(screen.getByText(/Warteschlange \(1\)|Queue \(1\)/)).toBeInTheDocument()
    expect(apiStream).toHaveBeenCalledTimes(2)

    // Sobald Stream 1 fertig ist, wird Frage 2 aus der Warteschlange automatisch gesendet
    schliesseErste?.()
    await waitFor(() => expect(apiStream).toHaveBeenCalledTimes(3))
    expect(await screen.findByText('Antwort zwei')).toBeInTheDocument()

    // 4. Alt+Enter unterbricht laufenden Stream und sendet sofort; Stopp-Button bricht ab
    let schliesseDritte: (() => void) | null = null
    apiStream.mockImplementationOnce(() => ({
      ok: true,
      body: {
        getReader: () => {
          let phase = 0
          return {
            read: () => {
              phase += 1
              if (phase === 1) {
                return Promise.resolve({
                  done: false,
                  value: new TextEncoder().encode(
                    'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Teilantwort drei"}\n\n',
                  ),
                })
              }
              if (phase === 2) {
                return new Promise((resolve) => {
                  schliesseDritte = () => resolve({ done: true, value: undefined })
                })
              }
              return Promise.resolve({ done: true, value: undefined })
            },
            cancel: vi.fn(),
          }
        },
      },
    }))
    apiStream.mockImplementationOnce(() => ({
      ok: true,
      body: {
        getReader: () => {
          let phase = 0
          return {
            read: () => {
              phase += 1
              if (phase === 1) {
                return Promise.resolve({
                  done: false,
                  value: new TextEncoder().encode(
                    'data: {"type": "start", "model": "m"}\n\ndata: {"type": "content", "text": "Sofortantwort vier"}\n\n',
                  ),
                })
              }
              return new Promise(() => {})
            },
            cancel: vi.fn(),
          }
        },
      },
    }))

    fireEvent.change(eingabe, { target: { value: 'Dritte Frage' } })
    fireEvent.keyDown(eingabe, { key: 'Enter' })
    expect(await screen.findByText('Teilantwort drei')).toBeInTheDocument()

    fireEvent.change(eingabe, { target: { value: 'Vierte sofort' } })
    fireEvent.keyDown(eingabe, { key: 'Enter', altKey: true })
    schliesseDritte?.()
    expect(await screen.findByText('Sofortantwort vier')).toBeInTheDocument()
    expect(apiStream).toHaveBeenCalledTimes(5)

    // Stopp-Knopf beendet laufenden Stream sofort
    const stoppBtn = screen.getByRole('button', { name: /KI stoppen|Stop the AI/i })
    fireEvent.click(stoppBtn)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Senden|Send/i })).toBeInTheDocument()
    })
  })
})

