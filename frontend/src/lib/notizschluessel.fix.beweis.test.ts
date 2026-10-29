/**
 * Beweis für den Fix vom 30.09.2026: drei Geräte eines Kontos mit drei
 * Notizschlüsseln — der Zustand, der an dem Tag gemessen wurde — enden mit
 * einem, und jede Notiz ist überall lesbar.
 *
 * Nachgebaut sind der Server (Notizen, Termine, Kontoschlüssel-Abdruck,
 * Geräteverzeichnis, Geräte-Mailbox) und welches Gerät gerade „dieses" ist.
 * Alles andere läuft durch den echten Code: `loadNotesOfflineFirst`,
 * `loadCalendarEventsOfflineFirst`, `saveNoteOffline`, `replayOutbox`,
 * Übergabe mit Unterschrift, Vertrauensprüfung der Geräteliste.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { importAesGcmRawKey } from '@msdis/shield/aead'
import { bytesToBase64 } from '@msdis/shield/core'
import {
  loadNotesOfflineFirst,
  loadCalendarEventsOfflineFirst,
  saveNoteOffline,
  replayOutbox,
  getOutbox,
  grundbestandZuruecksetzen,
} from './offlineSync'
import {
  NOTE_CIPHERTEXT_PREFIX,
  CALENDAR_CIPHERTEXT_PREFIX,
  encryptNoteTitle,
  encryptNoteContent,
  encryptCalendarField,
  clearNotesKeyCache,
  exportUserNotesKey,
  setUserNotesKey,
  getOrCreateUserNotesKey,
  checkAndReceiveDeviceNotesKey,
  kontoschluesselDaten,
  unterschreibeNotizUebergabe,
} from '@/services/notesCalendarCrypto'
import * as client from '@/api/client'
import * as e2eeGeraet from '@/services/e2eeGeraet'
import { erzeugeSignaturPaar, signiere, type SignaturPaar } from '@/services/absenderSignatur'
import { generateLocalE2eeKeyPair, encryptE2eeHybrid } from '@/services/e2eeCrypto'
import { useAuthStore } from '@/stores/authStore'
import { setzeAngemeldetesKonto } from '@/lib/angemeldetesKonto'

const KONTO = 2

const { server } = vi.hoisted(() => ({
  server: {
    notizen: new Map<string, any>(),
    termine: new Map<string, any>(),
    eintrag: { abdruck: null, stand: 0, geraet: null, signatur: null } as Record<string, any>,
    /** Wie ein Server vor diesem Fix: den Eintrag gibt es nicht (404). */
    ohneEintrag: false,
    geraete: [] as any[],
    mailbox: [] as { id: number; ciphertext_envelope: string }[],
    naechsteId: 1,
    /** Jeder Titel, der je an den Server ging — zum Nachweis, dass kein Klartext dabei war. */
    gesendet: [] as string[],
    /** Je Sammelauftrag zum Neuverschlüsseln die Kennungen darin. */
    sammelauftraege: [] as string[][],
    /** Läuft, wenn ein Sammelauftrag ankommt — vor dem Vergleich: ein anderes Gerät war schneller. */
    vorNeuVerschluesseln: null as null | (() => void),
  },
}))

vi.mock('@/api/client', () => ({ api: vi.fn(), apiStream: vi.fn() }))
vi.mock('@/api/social', () => ({
  relayE2eeEnvelope: vi.fn(async (u: any) => {
    const id = server.naechsteId++
    server.mailbox.push({ id, ciphertext_envelope: u.ciphertext_envelope })
    return { id, blind_mailbox_id: u.blind_mailbox_id }
  }),
  fetchE2eeEnvelopes: vi.fn(async () => server.mailbox.slice(-100)),
  getE2eeGeraete: vi.fn(async () => server.geraete.map((g) => ({ ...g }))),
}))
vi.mock('@/services/e2eeGeraet', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/e2eeGeraet')>()),
  eigenesGeraet: vi.fn(),
  geraeteVon: vi.fn(),
}))

type Name = 'web' | 'mss' | 'handy'

function roh(fuellung: number): string {
  return bytesToBase64(new Uint8Array(32).fill(fuellung))
}

async function abdruck(schluessel: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`msm:notes-key-abdruck:v1:${schluessel}`))
  return bytesToBase64(new Uint8Array(h)).slice(0, 22)
}

function fakeServer(pfad: string, optionen?: any): any {
  const methode = (optionen?.method || 'GET').toUpperCase()
  const body = optionen?.body ? JSON.parse(optionen.body) : undefined
  const jetzt = new Date().toISOString()
  if (pfad === '/notes/kontoschluessel') {
    // Ob die Unterschrift stimmt, prüft das Backend (`test_notizschluessel.py`).
    // Hier nicht: so zeigt sich, dass die Geräte selbst prüfen. Nur ein
    // freigegebenes Gerät darf setzen, und nur auf den nächsten Stand.
    if (server.ohneEintrag) throw Object.assign(new Error('Not Found'), { status: 404 })
    if (methode === 'GET') return { ...server.eintrag }
    if (!server.geraete.some((g) => g.device_id === body.geraet && g.is_approved)) {
      throw Object.assign(new Error('Forbidden'), { status: 403 })
    }
    if (body.stand !== (server.eintrag.stand ?? 0) + 1) {
      throw Object.assign(new Error('Konflikt'), { status: 409 })
    }
    server.eintrag = { abdruck: body.abdruck, stand: body.stand, geraet: body.geraet, signatur: body.signatur }
    return { ...server.eintrag }
  }
  if (pfad === '/notes/neu-verschluesseln' || pfad === '/calendar/events/neu-verschluesseln') {
    const [tabelle, kennung] = pfad.startsWith('/notes/')
      ? [server.notizen, 'note_uid']
      : [server.termine, 'event_id']
    server.sammelauftraege.push(body.eintraege.map((e: any) => e[kennung]))
    server.vorNeuVerschluesseln?.()
    const geschrieben: string[] = []
    const uebersprungen: string[] = []
    for (const e of body.eintraege) {
      const eintrag = tabelle.get(e[kennung])
      const felder = Object.entries(e).filter(([k]) => k !== kennung) as [string, { alt: string; neu: string }][]
      const persoenlich = eintrag && (eintrag.note_type ?? eintrag.event_type) === 'personal'
      if (!persoenlich || felder.some(([feld, { alt }]) => eintrag[feld] !== alt)) {
        uebersprungen.push(e[kennung])
        continue
      }
      for (const [feld, { neu }] of felder) {
        eintrag[feld] = neu
        if (feld === 'title') server.gesendet.push(neu)
      }
      geschrieben.push(e[kennung])
    }
    return { geschrieben, uebersprungen }
  }
  if (pfad.startsWith('/notes?')) return [...server.notizen.values()].map((n) => ({ ...n }))
  if (pfad === '/notes' && methode === 'POST') {
    if (body.title) server.gesendet.push(body.title)
    const neu = { ...body, id: server.naechsteId++, user_id: KONTO, note_type: 'personal', is_pinned: Boolean(body.is_pinned), is_archived: false, created_at: jetzt, updated_at: jetzt }
    server.notizen.set(body.note_uid, neu)
    return { ...neu }
  }
  if (pfad.startsWith('/notes/') && pfad.endsWith('/pin')) {
    const n = server.notizen.get(decodeURIComponent(pfad.slice(7, -4)))
    n.is_pinned = !n.is_pinned
    n.updated_at = jetzt
    return { ...n }
  }
  if (pfad.startsWith('/notes/') && methode === 'PUT') {
    const n = server.notizen.get(decodeURIComponent(pfad.slice(7)))
    if (body.title) server.gesendet.push(body.title)
    Object.assign(n, body, { updated_at: jetzt })
    return { ...n }
  }
  if (pfad.startsWith('/calendar/events/') && methode === 'PUT') {
    const t = server.termine.get(decodeURIComponent(pfad.slice(17)))
    if (body.title) server.gesendet.push(body.title)
    Object.assign(t, body)
    return { ...t }
  }
  if (pfad.startsWith('/calendar/events')) return [...server.termine.values()].map((t) => ({ ...t }))
  return []
}

describe('Beweis: der Fix bringt alle Geräte auf einen Schlüssel', () => {
  const paare: Record<Name, any> = {} as any
  const sigs: Record<Name, SignaturPaar> = {} as any
  const ablagen: Record<Name, Record<string, string>> = { web: {}, mss: {}, handy: {} }
  let aktuell: Name | null = null

  beforeAll(async () => {
    for (const n of ['web', 'mss', 'handy'] as Name[]) {
      paare[n] = await generateLocalE2eeKeyPair()
      sigs[n] = await erzeugeSignaturPaar()
    }
  }, 60000)

  /** Wechselt „dieses Gerät": eigener Speicher, frischer Arbeitsspeicher. */
  function aufGeraet(name: Name) {
    if (aktuell) {
      const stand: Record<string, string> = {}
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!
        stand[k] = localStorage.getItem(k)!
      }
      ablagen[aktuell] = stand
    }
    localStorage.clear()
    for (const [k, v] of Object.entries(ablagen[name])) localStorage.setItem(k, v)
    clearNotesKeyCache()
    e2eeGeraet.clearGeraeteMemory()
    grundbestandZuruecksetzen()
    vi.mocked(e2eeGeraet.eigenesGeraet).mockResolvedValue({
      kennung: name,
      paar: paare[name],
      signaturPaar: sigs[name],
    } as any)
    aktuell = name
  }

  /** Lässt alles zu Ende laufen, was im Hintergrund losging, und spielt die Warteschlange ab. */
  async function ruhe() {
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 25))
      await replayOutbox()
      if (getOutbox().length === 0 && i > 6) break
    }
  }

  async function titel(): Promise<Record<string, string>> {
    const { notes } = await loadNotesOfflineFirst()
    await ruhe()
    return Object.fromEntries(notes.map((n) => [n.note_uid, n.title]))
  }

  beforeEach(async () => {
    server.notizen.clear()
    server.termine.clear()
    server.eintrag = { abdruck: null, stand: 0, geraet: null, signatur: null }
    server.ohneEintrag = false
    server.mailbox = []
    server.gesendet = []
    server.sammelauftraege = []
    server.vorNeuVerschluesseln = null
    vi.mocked(client.api).mockImplementation(async (p: string, o?: any) => fakeServer(p, o))
    setzeAngemeldetesKonto(KONTO)
    useAuthStore.setState({ user: { id: KONTO } as any })

    // Geräteverzeichnis: das Handy hat das Web freigegeben, MSS das Handy —
    // MSS ist also nicht vom Web freigegeben (die Lage, in der bis zum Fix
    // der Schlüssel nie ankam).
    const eintrag = (n: Name) => ({
      device_id: n,
      public_key: paare[n].publicKeyJwk,
      signing_public_key: sigs[n].publicKeyJwk,
      label: n,
    })
    const handy: any = { ...eintrag('handy'), is_approved: true, approved_by: 'web' }
    handy.approval_signature = await signiere(
      await e2eeGeraet.freigabeDaten(KONTO, 'handy', handy.public_key, handy.signing_public_key),
      sigs.web.privateKeyJwk,
    )
    const mss: any = { ...eintrag('mss'), is_approved: true, approved_by: 'handy' }
    mss.approval_signature = await signiere(
      await e2eeGeraet.freigabeDaten(KONTO, 'mss', mss.public_key, mss.signing_public_key),
      sigs.handy.privateKeyJwk,
    )
    server.geraete = [{ ...eintrag('web'), is_approved: true }, handy, mss]
    vi.mocked(e2eeGeraet.geraeteVon).mockImplementation(async () => server.geraete.map((g) => ({ ...g })))
  })

    it('ein Eintrag ohne gültige Unterschrift stellt kein Gerät um', async () => {
    // Das Handy hatte seinen Schlüssel früher weitergegeben; MSS hält ihn als
    // Nebenschlüssel. Ein Angreifer mit einer Sitzung — oder der Server selbst
    // — zeigt mit dem Eintrag auf ihn, ohne dass ein vertrautes Gerät dafür
    // unterschrieben hat.
    const schluessel = { mss: roh(2), handy: roh(3) }
    ablagen.mss = {
      [`msm_e2ee_notes_key_${KONTO}`]: schluessel.mss,
      [`msm_e2ee_notes_nebenschluessel_${KONTO}`]: JSON.stringify([schluessel.handy]),
    }
    aktuell = null
    server.eintrag = {
      abdruck: await abdruck(schluessel.handy),
      stand: 1,
      geraet: 'web',
      signatur: bytesToBase64(new Uint8Array(64).fill(7)),
    }

    aufGeraet('mss')
    await titel()

    // MSS bleibt bei seinem Schlüssel und belegt den Eintrag selbst neu.
    expect(exportUserNotesKey(KONTO)).toBe(schluessel.mss)
    expect(server.eintrag.abdruck).toBe(await abdruck(schluessel.mss))
    expect(server.eintrag.geraet).toBe('mss')
    expect(server.eintrag.stand).toBe(2)
  }, 60000)

    it('ein ersetzter Schlüssel bleibt lesbar — auch beim Koppeln', async () => {
    aufGeraet('web')
    const vorKopplung = roh(4)
    await setUserNotesKey(KONTO, vorKopplung)
    const jetzt = new Date().toISOString()
    server.notizen.set('n-alt', {
      id: 1, note_uid: 'n-alt', category: 'personal', color: 'primary', is_pinned: false,
      is_archived: false, note_type: 'personal', user_id: KONTO, created_at: jetzt, updated_at: jetzt,
      title: await encryptNoteTitle('Vor der Kopplung', 'n-alt', undefined, KONTO),
      content: '',
    })

    // Wie `verlaufsUebergabe`: das Paket bringt den Schlüssel des Kontos.
    await setUserNotesKey(KONTO, roh(5))
    await ruhe()

    expect((await titel())['n-alt']).toBe('Vor der Kopplung')
  }, 60000)

  // ── Negativfälle (Durchsicht 30.09.2026, zweite Runde) ──

  /** Ein Gerät, das nicht unter den dreien ist: eigenes Paar, eigene Unterschrift. */
  async function fremdesGeraet(kennung: string) {
    const paar = await generateLocalE2eeKeyPair()
    const sig = await erzeugeSignaturPaar()
    return {
      paar,
      sig,
      eintrag: {
        device_id: kennung,
        public_key: paar.publicKeyJwk,
        signing_public_key: sig.publicKeyJwk,
        label: kennung,
        is_approved: true,
      } as any,
    }
  }

  async function belegterEintrag(kennung: string, sig: SignaturPaar, schluessel: string, stand: number) {
    const a = await abdruck(schluessel)
    return {
      abdruck: a,
      stand,
      geraet: kennung,
      signatur: await signiere(kontoschluesselDaten(KONTO, a, stand, kennung), sig.privateKeyJwk),
    }
  }

  it('Unterzeichner entfernt: das Gerät belegt den Eintrag mit seinem eigenen neu', async () => {
    // Echt unterschrieben — aber von einem Gerät, das nicht mehr im Verzeichnis steht.
    const entfernt = await fremdesGeraet('entfernt')
    const schluessel = { mss: roh(2), entfernt: roh(9) }
    ablagen.mss = {
      [`msm_e2ee_notes_key_${KONTO}`]: schluessel.mss,
      [`msm_e2ee_notes_nebenschluessel_${KONTO}`]: JSON.stringify([schluessel.entfernt]),
    }
    aktuell = null
    server.eintrag = await belegterEintrag('entfernt', entfernt.sig, schluessel.entfernt, 1)

    aufGeraet('mss')
    await titel()

    expect(exportUserNotesKey(KONTO)).toBe(schluessel.mss)
    expect(server.eintrag).toMatchObject({ abdruck: await abdruck(schluessel.mss), stand: 2, geraet: 'mss' })
  }, 60000)

  it('Unterzeichner im Verzeichnis, aber nicht vertraut: weder übernehmen noch überschreiben', async () => {
    const schluessel = { mss: roh(2), fremd: roh(8) }
    ablagen.mss = { [`msm_e2ee_notes_key_${KONTO}`]: schluessel.mss }
    aktuell = null

    // Erster Kontakt: MSS merkt sich die drei.
    aufGeraet('mss')
    await titel()
    await e2eeGeraet.verzeichnisVon(KONTO)
    expect(server.eintrag).toMatchObject({ geraet: 'mss', stand: 1 })

    // Dann taucht ein Gerät auf, dessen Freigabe sich nicht nachprüfen lässt,
    // und setzt seinen Schlüssel — echt unterschrieben, von sich selbst. MSS
    // hat ihn sogar als Nebenschlüssel.
    const fremd = await fremdesGeraet('fremd')
    fremd.eintrag.approved_by = 'web'
    fremd.eintrag.approval_signature = bytesToBase64(new Uint8Array(64).fill(3))
    server.geraete.push(fremd.eintrag)
    server.eintrag = await belegterEintrag('fremd', fremd.sig, schluessel.fremd, 2)
    const gesetzt = { ...server.eintrag }
    localStorage.setItem(`msm_e2ee_notes_nebenschluessel_${KONTO}`, JSON.stringify([schluessel.fremd]))

    aufGeraet('mss')
    await titel()

    // Kein Umstieg auf den fremden — und kein Wegnehmen: zwei solche Geräte
    // stellten den Eintrag sonst im Wechsel um.
    expect(exportUserNotesKey(KONTO)).toBe(schluessel.mss)
    expect(server.eintrag).toEqual(gesetzt)
  }, 60000)

    it('ein nicht freigegebenes Gerät belegt nichts und liest trotzdem seine Notizen', async () => {
    const eigen = roh(3)
    ablagen.handy = { [`msm_e2ee_notes_key_${KONTO}`]: eigen }
    aktuell = null
    server.geraete = server.geraete.filter((g) => g.device_id !== 'handy')
    const k = await importAesGcmRawKey(Uint8Array.from(atob(eigen), (c) => c.charCodeAt(0)), ['encrypt', 'decrypt'])
    const jetzt = new Date().toISOString()
    server.notizen.set('n-h', {
      id: 1, note_uid: 'n-h', category: 'personal', color: 'primary', is_pinned: false,
      is_archived: false, note_type: 'personal', user_id: KONTO, created_at: jetzt, updated_at: jetzt,
      title: await encryptNoteTitle('Vom Handy', 'n-h', k), content: '',
    })

    aufGeraet('handy')
    expect((await titel())['n-h']).toBe('Vom Handy')
    expect(server.eintrag.abdruck).toBeNull()
    expect(exportUserNotesKey(KONTO)).toBe(eigen)
  }, 60000)

  it('Neuverschlüsseln überschreibt keine Änderung, die inzwischen kam, und hält nichts an', async () => {
    const schluessel = { konto: roh(1), alt: roh(2) }
    ablagen.web = { [`msm_e2ee_notes_key_${KONTO}`]: schluessel.konto }
    aktuell = null
    aufGeraet('web')
    await titel()
    expect(server.eintrag.geraet).toBe('web')

    const alt = await importAesGcmRawKey(Uint8Array.from(atob(schluessel.alt), (c) => c.charCodeAt(0)), ['encrypt', 'decrypt'])
    const konto = await importAesGcmRawKey(Uint8Array.from(atob(schluessel.konto), (c) => c.charCodeAt(0)), ['encrypt', 'decrypt'])
    const jetzt = new Date().toISOString()
    server.notizen.set('n-spaet', {
      id: 1, note_uid: 'n-spaet', category: 'personal', color: 'primary', is_pinned: false,
      is_archived: false, note_type: 'personal', user_id: KONTO, created_at: jetzt, updated_at: jetzt,
      title: await encryptNoteTitle('Alter Stand', 'n-spaet', alt), content: '',
    })
    const bearbeitet = await encryptNoteTitle('Auf dem Handy geändert', 'n-spaet', konto)
    // Kommt an, während MSS neu verschlüsselt: das Handy war schneller.
    server.vorNeuVerschluesseln = () => {
      server.notizen.get('n-spaet').title = bearbeitet
    }
    ablagen.mss = {
      [`msm_e2ee_notes_key_${KONTO}`]: schluessel.konto,
      [`msm_e2ee_notes_nebenschluessel_${KONTO}`]: JSON.stringify([schluessel.alt]),
    }

    aufGeraet('mss')
    await titel()

    expect(server.sammelauftraege).toEqual([['n-spaet']])
    expect(server.notizen.get('n-spaet').title).toBe(bearbeitet)
    expect(getOutbox()).toEqual([])
    server.vorNeuVerschluesseln = null
    aufGeraet('mss')
    expect((await titel())['n-spaet']).toBe('Auf dem Handy geändert')
  }, 60000)

  it('ein Sammelauftrag für viele, und geteilte Notizen nie darin', async () => {
    const schluessel = { konto: roh(1), alt: roh(2) }
    ablagen.web = { [`msm_e2ee_notes_key_${KONTO}`]: schluessel.konto }
    aktuell = null
    aufGeraet('web')
    await titel()

    const alt = await importAesGcmRawKey(Uint8Array.from(atob(schluessel.alt), (c) => c.charCodeAt(0)), ['encrypt', 'decrypt'])
    const jetzt = new Date().toISOString()
    const basis = { category: 'personal', color: 'primary', is_pinned: false, is_archived: false, user_id: KONTO, created_at: jetzt, updated_at: jetzt, content: '' }
    for (let i = 0; i < 5; i++) {
      server.notizen.set(`s-${i}`, { ...basis, id: i + 1, note_uid: `s-${i}`, note_type: 'personal', title: await encryptNoteTitle(`Notiz ${i}`, `s-${i}`, alt) })
    }
    server.notizen.set('s-team', { ...basis, id: 99, note_uid: 's-team', note_type: 'team', team_id: 5, title: await encryptNoteTitle('Team', 's-team', alt) })
    ablagen.mss = {
      [`msm_e2ee_notes_key_${KONTO}`]: schluessel.konto,
      [`msm_e2ee_notes_nebenschluessel_${KONTO}`]: JSON.stringify([schluessel.alt]),
    }

    aufGeraet('mss')
    await titel()

    expect(server.sammelauftraege).toHaveLength(1)
    expect([...server.sammelauftraege[0]].sort()).toEqual(['s-0', 's-1', 's-2', 's-3', 's-4'])
    for (let i = 0; i < 5; i++) expect(server.notizen.get(`s-${i}`).updated_at).toBe(jetzt)
  }, 60000)

  it('zwei Speichervorgänge zugleich auf einem neuen Gerät: ein Schlüssel, beide lesbar', async () => {
    ablagen.handy = {}
    aktuell = null
    aufGeraet('handy')

    const [a, b] = await Promise.all([getOrCreateUserNotesKey(KONTO), getOrCreateUserNotesKey(KONTO)])
    expect(a).toBe(b)
    clearNotesKeyCache()
    localStorage.clear()

    const [erste, zweite] = await Promise.all([
      saveNoteOffline({ title: 'Erste', content: 'x', note_type: 'personal' }),
      saveNoteOffline({ title: 'Zweite', content: 'y', note_type: 'personal' }),
    ])
    await ruhe()

    aufGeraet('handy')
    const danach = await titel()
    expect(danach[erste.note.note_uid]).toBe('Erste')
    expect(danach[zweite.note.note_uid]).toBe('Zweite')
  }, 60000)
})
