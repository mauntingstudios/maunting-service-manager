import { mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";

const LOCK_DATEI = "docs-sidecar.lock";

function belegt(pfad) {
  const error = new Error(`Eine docs-sidecar-Instanz ist bereits aktiv (Sperre: ${pfad})`);
  error.code = "DOCS_INSTANCE_RUNNING";
  return error;
}

export async function acquireInstanceLock(dataDir) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const lockPfad = path.join(dataDir, LOCK_DATEI);

  for (let versuch = 0; versuch < 2; versuch += 1) {
    let handle;
    try {
      handle = await open(lockPfad, "wx", 0o600);
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.sync();
      await handle.close();
      let freigegeben = false;
      return async () => {
        if (freigegeben) return;
        freigegeben = true;
        try {
          const pid = Number((await readFile(lockPfad, "utf8")).trim());
          if (pid === process.pid) await unlink(lockPfad);
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (handle) await handle.close();
      if (error.code !== "EEXIST") throw error;
    }

    let pid;
    let lockInhalt;
    try {
      lockInhalt = await readFile(lockPfad, "utf8");
      pid = Number(lockInhalt.trim());
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error(`Die Sidecar-Sperre ist unlesbar und muss geprüft werden: ${lockPfad}`);
    }
    let prozessAktiv = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === "ESRCH") prozessAktiv = false;
      else if (error.code === "EPERM") throw belegt(lockPfad);
      else throw error;
    }
    if (prozessAktiv) throw belegt(lockPfad);
    if ((await readFile(lockPfad, "utf8").catch((error) => {
      if (error.code === "ENOENT") return null;
      throw error;
    })) !== lockInhalt) {
      continue;
    }
    await unlink(lockPfad).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  throw belegt(lockPfad);
}
