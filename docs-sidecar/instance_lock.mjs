import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";

const LOCK_DATEI = "docs-sidecar.lock";

/**
 * Die Sperre ist eine Lease, keine PID-Datei.
 *
 * Eine PID allein beweist kein Leben: im Container ist der Sidecar PID 1, und
 * nach einem harten Ende ist PID 1 beim Neustart wieder da. Der Inhaber
 * frischt deshalb alle 15 s die mtime der Datei auf; ist sie 60 s alt, gilt
 * die Lease als verwaist und darf übernommen werden. Der Inhalt nennt PID,
 * Besitzerkennung und Startzeit für Diagnose und Freigabe.
 */
const LEASE_MS = 60_000;
const HEARTBEAT_MS = 15_000;

function belegt(pfad) {
  const error = new Error(`Eine docs-sidecar-Instanz ist bereits aktiv (Sperre: ${pfad})`);
  error.code = "DOCS_INSTANCE_RUNNING";
  return error;
}

async function anlegen(lockPfad) {
  const inhalt = JSON.stringify({
    v: 1,
    pid: process.pid,
    owner: randomUUID(),
    startedAt: new Date().toISOString(),
  });
  const handle = await open(lockPfad, "wx", 0o600);
  try {
    await handle.writeFile(`${inhalt}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return JSON.parse(inhalt);
}

async function leaseAlter(lockPfad) {
  try {
    const info = await stat(lockPfad);
    return Date.now() - info.mtimeMs;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function inhaltLesen(lockPfad) {
  try {
    return await readFile(lockPfad, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function acquireInstanceLock(
  dataDir,
  { leaseMs = LEASE_MS, heartbeatMs = HEARTBEAT_MS } = {},
) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lockPfad = path.join(dataDir, LOCK_DATEI);

  for (let versuch = 0; versuch < 2; versuch += 1) {
    let lease;
    try {
      lease = await anlegen(lockPfad);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }

    if (lease) {
      let heartbeatFehler = false;
      const heartbeat = setInterval(() => {
        void utimes(lockPfad, new Date(), new Date()).catch((fehler) => {
          if (heartbeatFehler) return;
          heartbeatFehler = true;
          console.error(
            `Sidecar-Sperre konnte nicht aufgefrischt werden: ${fehler.message}`,
          );
        });
      }, heartbeatMs);
      heartbeat.unref?.();
      let freigegeben = false;
      return async () => {
        if (freigegeben) return;
        freigegeben = true;
        clearInterval(heartbeat);
        const inhalt = await inhaltLesen(lockPfad);
        if (inhalt === null) return;
        let eigentuemer;
        try {
          eigentuemer = JSON.parse(inhalt).owner;
        } catch {
          return;
        }
        if (eigentuemer !== lease.owner) return;
        await unlink(lockPfad).catch((fehler) => {
          if (fehler.code !== "ENOENT") throw fehler;
        });
      };
    }

    const alter = await leaseAlter(lockPfad);
    if (alter === null) continue;
    if (alter <= leaseMs) throw belegt(lockPfad);

    // Verwaist: nur übernehmen, wenn sich der Inhalt zwischen Lesen und
    // Löschen nicht geändert hat. Ein laufender Prozess frischt die mtime
    // auf und kommt hier gar nicht erst an.
    const vorher = await inhaltLesen(lockPfad);
    if (vorher === null) continue;
    const nachher = await inhaltLesen(lockPfad);
    if (nachher !== vorher) continue;
    const alterNochmal = await leaseAlter(lockPfad);
    if (alterNochmal === null) continue;
    if (alterNochmal <= leaseMs) throw belegt(lockPfad);
    await unlink(lockPfad).catch((fehler) => {
      if (fehler.code !== "ENOENT") throw fehler;
    });
  }

  throw belegt(lockPfad);
}
