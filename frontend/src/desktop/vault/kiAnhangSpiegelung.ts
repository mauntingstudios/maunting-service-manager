/**
 * Spiegelung von KI-Chat-Dateianhängen in den persönlichen Tresor.
 *
 * Wenn die Option aktiv ist, werden im Singra-Chat hochgeladene Dateien
 * automatisch in einen gesonderten Ordner („KI-Anhänge“) im persönlichen
 * Tresor abgelegt. Nur der Haupt-Chat spiegelt — der Maunting-Docs-Chat
 * ruft die Spiegelung nicht auf.
 *
 * Ist der Tresor gerade gesperrt, wandert die Datei in eine lokale Warteschlange
 * (IndexedDB). Sobald der Tresor entsperrt wird, werden die wartenden Dateien
 * automatisch in den Tresor übernommen und die Warteschlange geleert.
 */

import { useVaultStore } from './vaultStore'

export const KI_SPIEGELUNG_KEY = 'msm_vault_mirror_chat_attachments'
export const KI_ORDNER_NAME = 'KI-Anhänge'

const DB_NAME = 'msm_ki_spiegelung_db'
const STORE_NAME = 'warteschlange'

interface WartendeDatei {
  id: string
  name: string
  type: string
  lastModified: number
  daten: ArrayBuffer
  erstelltAm: number
}

function oeffneDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB nicht verfügbar'))
      return
    }
    const anfrage = indexedDB.open(DB_NAME, 1)
    anfrage.onupgradeneeded = () => {
      const db = anfrage.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }
    anfrage.onsuccess = () => resolve(anfrage.result)
    anfrage.onerror = () => reject(anfrage.error)
  })
}

async function inWarteschlangeLegen(datei: File): Promise<void> {
  try {
    const db = await oeffneDb()
    const daten = await datei.arrayBuffer()
    const eintrag: WartendeDatei = {
      id: crypto.randomUUID(),
      name: datei.name,
      type: datei.type,
      lastModified: datei.lastModified,
      daten,
      erstelltAm: Date.now(),
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).put(eintrag)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch (err) {
    console.error('Fehler beim Ablegen in die KI-Spiegel-Warteschlange:', err)
  }
}

async function warteschlangeLesen(): Promise<WartendeDatei[]> {
  try {
    const db = await oeffneDb()
    return await new Promise<WartendeDatei[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const anfrage = tx.objectStore(STORE_NAME).getAll()
      tx.oncomplete = () => {
        db.close()
        resolve(anfrage.result as WartendeDatei[])
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    })
  } catch {
    return []
  }
}

async function ausWarteschlangeLoeschen(id: string): Promise<void> {
  try {
    const db = await oeffneDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).delete(id)
      tx.oncomplete = () => {
        db.close()
        resolve()
      }
      tx.onerror = () => {
        db.close()
        reject(tx.error)
      }
    })
  } catch (err) {
    console.error('Fehler beim Löschen aus der KI-Spiegel-Warteschlange:', err)
  }
}

export function kiSpiegelungAktiv(): boolean {
  try {
    return localStorage.getItem(KI_SPIEGELUNG_KEY) === 'true'
  } catch {
    return false
  }
}

export function setKiSpiegelungAktiv(aktiv: boolean): void {
  try {
    localStorage.setItem(KI_SPIEGELUNG_KEY, aktiv ? 'true' : 'false')
  } catch {
    // ignorieren
  }
}

/**
 * Findet oder erstellt den Tresor-Ordner „KI-Anhänge“.
 */
async function findeOderErstelleKiOrdner(): Promise<string> {
  const store = useVaultStore.getState()
  const ordner = store.items.find(
    (i) => i.category === 'ordner' && i.service === KI_ORDNER_NAME && !i.trashedAt,
  )
  if (ordner) return ordner.id
  return await store.ordnerAnlegen(KI_ORDNER_NAME)
}

/**
 * Spiegelt eine Datei in den Tresor, wenn die Option aktiv ist.
 * Blockiert den Chat-Upload niemals und wirft bei Fehlern keine blockierenden Exceptions.
 */
export async function spiegleAnhangInTresor(datei: File): Promise<void> {
  if (!kiSpiegelungAktiv()) return

  const store = useVaultStore.getState()
  if (store.isUnlocked && store.userKey) {
    try {
      const ordnerId = await findeOderErstelleKiOrdner()
      await store.dateiHinzufuegen(datei, ordnerId)
    } catch (err) {
      console.warn('Fehler beim direkten Spiegeln in den Tresor, lege in Warteschlange:', err)
      await inWarteschlangeLegen(datei)
    }
  } else {
    await inWarteschlangeLegen(datei)
  }
}

/**
 * Arbeitet die Warteschlange ab, sobald der Tresor entsperrt ist.
 */
export async function spiegelWarteschlangeAbarbeiten(): Promise<void> {
  const store = useVaultStore.getState()
  if (!store.isUnlocked || !store.userKey) return

  const wartend = await warteschlangeLesen()
  if (wartend.length === 0) return

  try {
    const ordnerId = await findeOderErstelleKiOrdner()
    for (const eintrag of wartend) {
      try {
        const file = new File([eintrag.daten], eintrag.name, {
          type: eintrag.type,
          lastModified: eintrag.lastModified,
        })
        await store.dateiHinzufuegen(file, ordnerId)
        await ausWarteschlangeLoeschen(eintrag.id)
      } catch (err) {
        console.error(`Fehler beim Abarbeiten von ${eintrag.name}:`, err)
      }
    }
  } catch (err) {
    console.error('Fehler beim Abarbeiten der KI-Spiegel-Warteschlange:', err)
  }
}

// Beobachter: Sobald der Tresor entsperrt wird, Warteschlange abarbeiten
if (typeof window !== 'undefined') {
  useVaultStore.subscribe((state, prevState) => {
    if (state.isUnlocked && !prevState?.isUnlocked) {
      void spiegelWarteschlangeAbarbeiten().catch(() => {})
    }
  })
}
