/**
 * @vitest-environment node
 *
 * Der Messenger-PIN.
 *
 * Die vier Ablagen sind hier gefälscht: was sie tun, steht in ihren eigenen
 * Tests. Geprüft wird das, was nur hier passieren kann — dass aus einem PIN ein
 * Schlüssel wird, dass ein falscher PIN keinen ergibt, dass ein Wechsel den
 * Bestand nicht anfasst, und dass ein verlorener Schlüsselspeicher etwas
 * anderes meldet als ein Tippfehler.
 *
 * Argon2id rechnet mit 128 MiB. Jede PIN-Eingabe in dieser Datei kostet
 * deshalb spürbar Zeit — das ist der Sinn der Sache und der Grund für die
 * großzügigen Fristen.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setzeAngemeldetesKonto } from '@/lib/angemeldetesKonto'

// Ein später geladenes Modul (authStore) setzt den Kontostand aus dem
// Speicher neu. Für diese Datei zählt nur, was der Test ausdrücklich setzt.
const kontoStand = vi.hoisted(() => ({ wert: 1 as number | null }))
vi.mock('@/lib/angemeldetesKonto', () => ({
  angemeldetesKonto: () => kontoStand.wert,
  setzeAngemeldetesKonto: (id: number | null) => {
    if (id === 1 || id === 2) kontoStand.wert = id
  },
  beiKontowechsel: () => () => {},
}))

const fach = {
  schluesselfachVerfuegbar: vi.fn(async () => false),
  biometrieMoeglich: vi.fn(async () => false),
  geraeteGeheimnis: vi.fn(async (_erzeugen?: boolean) => null as Uint8Array | null),
  vergissGeraeteGeheimnis: vi.fn(async () => {}),
  verwahrePin: vi.fn(async (_pin: string) => {}),
  rufePinAb: vi.fn(async () => null as string | null),
  vergissPin: vi.fn(async () => {}),
}
vi.mock('./geraeteSchluesselfach', () => fach)

const umstellung = {
  nachrichten: vi.fn(async () => 0),
  geraet: vi.fn(async () => true),
  entwuerfe: vi.fn(async () => 0),
  funken: vi.fn(async () => 0),
  medien: vi.fn(async () => 0),
  medienTeile: vi.fn(async () => 0),
  medienAuftraege: vi.fn(async () => 0),
  steuerAuftraege: vi.fn(async () => 0),
  loeschAuftraege: vi.fn(async () => 0),
  offeneNachrichten: vi.fn(async () => 0),
  hintergruende: vi.fn(async () => 0),
}
vi.mock('./messengerLocalStore', async (importOriginal) => ({
  ...await importOriginal<typeof import('./messengerLocalStore')>(),
  schreibeNachrichtenBestandNeu: umstellung.nachrichten,
  schreibeEntwuerfeBestandNeu: umstellung.entwuerfe,
  schreibeFunkenBestandNeu: umstellung.funken,
  schreibeMedienBestandNeu: umstellung.medien,
  schreibeMedienTeileBestandNeu: umstellung.medienTeile,
  schreibeMedienAuftraegeBestandNeu: umstellung.medienAuftraege,
  schreibeSteuerAuftraegeBestandNeu: umstellung.steuerAuftraege,
  schreibeLoeschAuftraegeBestandNeu: umstellung.loeschAuftraege,
  schreibeOffeneNachrichtenBestandNeu: umstellung.offeneNachrichten,
  schreibeHintergruendeBestandNeu: umstellung.hintergruende,
}))
vi.mock('./gespraechsListe', () => ({
  schreibeGespraecheBestandNeu: vi.fn(async () => 0),
}))
vi.mock('./gruppenName', () => ({
  schreibeGruppenNamenBestandNeu: vi.fn(async () => 0),
}))
const geraeteSpeicherGeleert = vi.fn()
vi.mock('./e2eeGeraet', () => ({
  schreibeGeraetBestandNeu: umstellung.geraet,
  clearGeraeteMemory: geraeteSpeicherGeleert,
}))

const { istOffen, siegelAktiv } = await import('./lokaleVersiegelung')
const { PIN_MINDESTLAENGE, useMessengerSperre } = await import('./messengerSperre')
const { chatMediaBlobCache, sessionChatCache } = await import('./klartextSpeicher')

const PIN = 'geheim-123'
const FRIST = 120_000

function installiereAblage() {
  const daten = new Map<string, string>()
  ;(globalThis as any).localStorage = {
    getItem: (k: string) => daten.get(k) ?? null,
    setItem: (k: string, v: string) => daten.set(k, v),
    removeItem: (k: string) => daten.delete(k),
    clear: () => daten.clear(),
    get length() {
      return daten.size
    },
    key: (i: number) => [...daten.keys()][i] ?? null,
  }
}

describe('messengerSperre', () => {
  beforeEach(() => {
    installiereAblage()
    setzeAngemeldetesKonto(1)
    vi.clearAllMocks()
    fach.schluesselfachVerfuegbar.mockResolvedValue(false)
    fach.geraeteGeheimnis.mockResolvedValue(null)
    useMessengerSperre.setState({
      eingerichtet: false,
      entsperrt: true,
      laeuft: false,
      fehler: null,
      fehlversuche: 0,
      gesperrtBis: 0,
      biometrieAktiv: false,
      geraetebindung: false,
      sperrfrist: 15,
      letzteAktivitaet: Date.now(),
    })
  })

  it('weist einen zu kurzen PIN ab, bevor irgendetwas passiert', async () => {
    const kurz = 'a'.repeat(PIN_MINDESTLAENGE - 1)
    await expect(useMessengerSperre.getState().einrichten(kurz)).rejects.toThrow()
    expect(siegelAktiv()).toBe(false)
    expect(umstellung.nachrichten).not.toHaveBeenCalled()
  })

  it(
    'richtet ein, stellt den Bestand um und ist danach offen',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)

      const stand = useMessengerSperre.getState()
      expect(stand.eingerichtet).toBe(true)
      expect(stand.entsperrt).toBe(true)
      expect(siegelAktiv()).toBe(true)

      // Alle Ablagen müssen durchlaufen worden sein. Eine vergessene
      // bliebe im Klartext liegen, ohne dass es jemandem auffiele.
      expect(umstellung.nachrichten).toHaveBeenCalledOnce()
      expect(umstellung.geraet).toHaveBeenCalledOnce()
      expect(umstellung.entwuerfe).toHaveBeenCalledOnce()
      expect(umstellung.funken).toHaveBeenCalledOnce()
      expect(umstellung.medien).toHaveBeenCalledOnce()
      expect(umstellung.medienTeile).toHaveBeenCalledOnce()
      expect(umstellung.medienAuftraege).toHaveBeenCalledOnce()
      expect(umstellung.steuerAuftraege).toHaveBeenCalledOnce()
      expect(umstellung.loeschAuftraege).toHaveBeenCalledOnce()
      expect(umstellung.offeneNachrichten).toHaveBeenCalledOnce()
    },
    FRIST,
  )

  it(
    'wirft beim Sperren den entschlüsselten Klartext aus dem Arbeitsspeicher',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)
      sessionChatCache.set('mailbox-1', [{ id: 1, senderId: 2, text: 'geheim', createdAt: '', isSelf: false }])
      chatMediaBlobCache.set('medium-1', 'data:image/png;base64,AAAA')

      useMessengerSperre.getState().sperren()

      expect(sessionChatCache.size).toBe(0)
      expect(chatMediaBlobCache.size).toBe(0)
    },
    FRIST,
  )

  it(
    'sperrt, öffnet mit dem richtigen PIN und bleibt beim falschen zu',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)

      useMessengerSperre.getState().sperren()
      expect(useMessengerSperre.getState().entsperrt).toBe(false)
      expect(istOffen()).toBe(false)

      expect(await useMessengerSperre.getState().entsperren('falsch-falsch')).toBe(false)
      expect(useMessengerSperre.getState().entsperrt).toBe(false)
      expect(useMessengerSperre.getState().fehler).toBe('Falscher PIN.')
      expect(istOffen()).toBe(false)

      expect(await useMessengerSperre.getState().entsperren(PIN)).toBe(true)
      expect(useMessengerSperre.getState().entsperrt).toBe(true)
      expect(useMessengerSperre.getState().fehlversuche).toBe(0)
      expect(istOffen()).toBe(true)
    },
    FRIST,
  )

  it(
    'fängt die Frist beim Entsperren neu an, nicht beim Laden der Seite',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)
      useMessengerSperre.getState().sperren()

      // Der Sperrschirm stand eine halbe Stunde — jemand hat die App
      // aufgemacht und erst mal woanders hingeschaut.
      useMessengerSperre.setState({
        sperrfrist: 15,
        letzteAktivitaet: Date.now() - 30 * 60_000,
      })

      expect(await useMessengerSperre.getState().entsperren(PIN)).toBe(true)

      // Ohne das Nachstellen der Uhr wäre der Messenger im selben Atemzug „seit
      // 30 Minuten untätig": er ginge auf und beim nächsten Takt sofort wieder
      // zu. Genau das war der Fehler — sichtbar als kurzes Aufblitzen.
      useMessengerSperre.getState().pruefeFrist()
      expect(useMessengerSperre.getState().entsperrt).toBe(true)

      useMessengerSperre.getState().merkeAktivitaet()
      expect(useMessengerSperre.getState().entsperrt).toBe(true)
    },
    FRIST,
  )

  it(
    'nimmt beim Sperren auch den Geräteausweis aus dem Arbeitsspeicher',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)
      geraeteSpeicherGeleert.mockClear()

      useMessengerSperre.getState().sperren()

      // Bliebe der Ausweis im Speicher, hätte der Messenger nach der
      // automatischen Sperre weiter alles, was er zum Entschlüsseln braucht.
      expect(geraeteSpeicherGeleert).toHaveBeenCalledOnce()
    },
    FRIST,
  )

  it(
    'wechselt den PIN, ohne den Bestand anzufassen',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)
      vi.clearAllMocks()

      await useMessengerSperre.getState().pinAendern(PIN, 'neuer-pin-456')

      // Der Inhaltsschlüssel bleibt derselbe, nur sein Umschlag wird neu
      // geschrieben. Würde hier der Bestand angefasst, dauerte ein Wechsel bei
      // gewachsenem Verlauf Minuten statt eines Augenblicks.
      expect(umstellung.nachrichten).not.toHaveBeenCalled()
      expect(umstellung.entwuerfe).not.toHaveBeenCalled()

      useMessengerSperre.getState().sperren()
      expect(await useMessengerSperre.getState().entsperren(PIN)).toBe(false)
      expect(await useMessengerSperre.getState().entsperren('neuer-pin-456')).toBe(true)
    },
    FRIST,
  )

  it(
    'lässt einen Wechsel mit falschem alten PIN nicht zu',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)
      await expect(
        useMessengerSperre.getState().pinAendern('war-es-nicht', 'neuer-pin-456'),
      ).rejects.toThrow(/stimmt nicht/)

      useMessengerSperre.getState().sperren()
      expect(await useMessengerSperre.getState().entsperren(PIN)).toBe(true)
    },
    FRIST,
  )

  it(
    'schaltet ab und legt den Bestand wieder offen',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)
      vi.clearAllMocks()

      await useMessengerSperre.getState().abschalten(PIN)

      expect(useMessengerSperre.getState().eingerichtet).toBe(false)
      expect(siegelAktiv()).toBe(false)
      // Derselbe Durchlauf wie beim Einschalten, nur mit umgelegtem Schalter.
      expect(umstellung.nachrichten).toHaveBeenCalledOnce()
      expect(umstellung.geraet).toHaveBeenCalledOnce()
      expect(umstellung.entwuerfe).toHaveBeenCalledOnce()
      expect(umstellung.funken).toHaveBeenCalledOnce()
      expect(umstellung.medien).toHaveBeenCalledOnce()
      expect(umstellung.medienTeile).toHaveBeenCalledOnce()
      expect(umstellung.medienAuftraege).toHaveBeenCalledOnce()
      expect(umstellung.steuerAuftraege).toHaveBeenCalledOnce()
      expect(umstellung.loeschAuftraege).toHaveBeenCalledOnce()
      expect(umstellung.offeneNachrichten).toHaveBeenCalledOnce()
      expect(istOffen()).toBe(true)
    },
    FRIST,
  )

  it(
    'bleibt zu, wenn die Umstellung beim Abschalten abbricht',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)
      umstellung.entwuerfe.mockRejectedValueOnce(new Error('Platte voll'))

      await expect(useMessengerSperre.getState().abschalten(PIN)).rejects.toThrow()

      // Der Schalter muss zurück auf zu. Bliebe er offen, hielte nach dem
      // nächsten Neuladen niemand mehr die noch versiegelten Zeilen für
      // versiegelt — und der Schlüssel dazu wäre weg.
      expect(siegelAktiv()).toBe(true)
      expect(useMessengerSperre.getState().eingerichtet).toBe(true)

      // Ein zweiter Versuch räumt auf.
      await useMessengerSperre.getState().abschalten(PIN)
      expect(siegelAktiv()).toBe(false)
      expect(useMessengerSperre.getState().eingerichtet).toBe(false)
    },
    FRIST,
  )

  it(
    'schaltet mit falschem PIN nicht ab',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)
      await expect(useMessengerSperre.getState().abschalten('war-es-nicht')).rejects.toThrow()
      expect(siegelAktiv()).toBe(true)
      expect(useMessengerSperre.getState().eingerichtet).toBe(true)
    },
    FRIST,
  )

  it(
    'lässt nach genug Fehlversuchen warten, ohne etwas zu löschen',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)
      useMessengerSperre.getState().sperren()

      for (let i = 0; i < 5; i++) {
        useMessengerSperre.setState({ gesperrtBis: 0 })
        await useMessengerSperre.getState().entsperren('falsch-falsch')
      }

      expect(useMessengerSperre.getState().fehlversuche).toBe(5)
      expect(useMessengerSperre.getState().gesperrtBis).toBeGreaterThan(Date.now())

      // Die Wartezeit hält auch den richtigen PIN auf — aber nichts ist weg.
      expect(await useMessengerSperre.getState().entsperren(PIN)).toBe(false)
      useMessengerSperre.setState({ gesperrtBis: 0 })
      expect(await useMessengerSperre.getState().entsperren(PIN)).toBe(true)
    },
    FRIST,
  )

  it(
    'meldet beim Einschalten der Biometrie einen falschen PIN in Worten, nicht als Bibliotheksfehler',
    async () => {
      await useMessengerSperre.getState().einrichten(PIN)
      await expect(useMessengerSperre.getState().biometrieEinschalten('falsch-falsch')).rejects.toThrow(
        'Der PIN stimmt nicht.',
      )
      expect(fach.verwahrePin).not.toHaveBeenCalled()
    },
    FRIST,
  )

  describe('mit Gerätebindung', () => {
    const GEHEIMNIS = new Uint8Array(32).fill(7)

    beforeEach(() => {
      fach.schluesselfachVerfuegbar.mockResolvedValue(true)
      fach.geraeteGeheimnis.mockResolvedValue(GEHEIMNIS)
    })

    it(
      'bindet den Schlüssel an das Gerät und meldet einen verlorenen Speicher als solchen',
      async () => {
        await useMessengerSperre.getState().einrichten(PIN)
        expect(useMessengerSperre.getState().geraetebindung).toBe(true)

        useMessengerSperre.getState().sperren()

        // Der Schlüsselspeicher ist weg — Windows neu aufgesetzt, Profil
        // zurückgesetzt. Das ist kein Tippfehler, und die Meldung darf nicht
        // „Falscher PIN" lauten: wer das liest, tippt bis ans Ende seiner Tage.
        fach.geraeteGeheimnis.mockResolvedValue(null)
        expect(await useMessengerSperre.getState().entsperren(PIN)).toBe(false)
        expect(useMessengerSperre.getState().fehler).toMatch(/Schlüsselspeicher/)
        expect(useMessengerSperre.getState().fehlversuche).toBe(0)

        fach.geraeteGeheimnis.mockResolvedValue(GEHEIMNIS)
        expect(await useMessengerSperre.getState().entsperren(PIN)).toBe(true)
      },
      FRIST,
    )

    it(
      'nennt einen technischen Fehler nicht „Falscher PIN" und zählt ihn trotzdem',
      async () => {
        const warnung = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await useMessengerSperre.getState().einrichten(PIN)
        useMessengerSperre.getState().sperren()

        // Das Fach wirft, statt zu schweigen: der PIN wird gar nicht geprüft.
        fach.geraeteGeheimnis.mockRejectedValue(new Error('Fach antwortet nicht'))
        expect(await useMessengerSperre.getState().entsperren(PIN)).toBe(false)
        expect(useMessengerSperre.getState().fehler).toMatch(/am PIN lag es nicht/)
        // Die Bremse gegen das Durchprobieren hängt nicht an der Meldung.
        expect(useMessengerSperre.getState().fehlversuche).toBe(1)
        // Der PIN selbst landet nie im Log.
        expect(JSON.stringify(warnung.mock.calls)).not.toContain(PIN)

        await expect(useMessengerSperre.getState().abschalten(PIN)).rejects.toThrow(
          /am PIN lag es nicht/,
        )

        fach.geraeteGeheimnis.mockResolvedValue(GEHEIMNIS)
        useMessengerSperre.setState({ gesperrtBis: 0 })
        await expect(useMessengerSperre.getState().pinAendern('falsch-falsch', 'neu-neu-neu')).rejects.toThrow(
          'Der bisherige PIN stimmt nicht.',
        )
        fach.geraeteGeheimnis.mockRejectedValue(new Error('Fach antwortet nicht'))
        await expect(useMessengerSperre.getState().pinAendern(PIN, 'neu-neu-neu')).rejects.toThrow(
          /am PIN lag es nicht/,
        )

        fach.geraeteGeheimnis.mockResolvedValue(GEHEIMNIS)
        expect(await useMessengerSperre.getState().entsperren(PIN)).toBe(true)
        warnung.mockRestore()
      },
      FRIST,
    )

    it(
      'erzeugt beim Entsperren kein neues Gerätegeheimnis',
      async () => {
        await useMessengerSperre.getState().einrichten(PIN)
        expect(fach.geraeteGeheimnis).toHaveBeenCalledWith(true)

        fach.geraeteGeheimnis.mockClear()
        useMessengerSperre.getState().sperren()
        await useMessengerSperre.getState().entsperren(PIN)

        // Ein frisch erfundenes Geheimnis ergäbe einen anderen Schlüssel und
        // damit einen Umschlag, der nie wieder aufgeht.
        expect(fach.geraeteGeheimnis).toHaveBeenCalledWith(false)
        expect(fach.geraeteGeheimnis).not.toHaveBeenCalledWith(true)
      },
      FRIST,
    )

    it(
      'lässt das Gerätegeheimnis liegen, solange ein anderes Konto daran hängt',
      async () => {
        // Das Schlüsselfach gibt es einmal je Gerät, nicht je Konto.
        let imFach: Uint8Array | null = null
        fach.geraeteGeheimnis.mockImplementation(async (erzeugen?: boolean) => {
          if (!imFach && erzeugen) imFach = new Uint8Array(32).fill(9)
          return imFach
        })
        fach.vergissGeraeteGeheimnis.mockImplementation(async () => {
          imFach = null
        })
        const sperre = () => useMessengerSperre.getState()

        await sperre().einrichten(PIN)
        sperre().sperren()

        setzeAngemeldetesKonto(2)
        await sperre().initialisiere()
        await sperre().einrichten('anderer-pin')
        sperre().sperren()

        // Konto 1 schaltet ab; Konto 2 muss seinen Verlauf danach noch öffnen.
        setzeAngemeldetesKonto(1)
        await sperre().initialisiere()
        // Ein später geladenes Modul kann den Kontostand aus der Ablage neu
        // setzen; unmittelbar vor dem Zugriff gilt der gewollte Kontostand.
        setzeAngemeldetesKonto(1)
        await sperre().abschalten(PIN)

        setzeAngemeldetesKonto(2)
        await sperre().initialisiere()
        expect(await sperre().entsperren('anderer-pin')).toBe(true)
        expect(fach.vergissGeraeteGeheimnis).not.toHaveBeenCalled()

        // Das letzte gebundene Konto räumt das Fach dann auf.
        setzeAngemeldetesKonto(2)
        await sperre().abschalten('anderer-pin')
        expect(fach.vergissGeraeteGeheimnis).toHaveBeenCalledTimes(1)
        expect(imFach).toBeNull()
      },
      FRIST,
    )
  })
})
