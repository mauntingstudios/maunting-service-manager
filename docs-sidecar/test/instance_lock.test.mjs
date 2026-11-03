import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireInstanceLock } from "../instance_lock.mjs";

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "msm-docs-lock-"));
}

test("die Sperre weist eine zweite laufende Instanz ab und wird freigegeben", async () => {
  const dir = await tempDir();
  try {
    const release = await acquireInstanceLock(dir);
    assert.equal(
      (await readFile(path.join(dir, "docs-sidecar.lock"), "utf8")).trim(),
      String(process.pid),
    );
    await assert.rejects(acquireInstanceLock(dir), { code: "DOCS_INSTANCE_RUNNING" });
    await release();
    const erneutFreigeben = await acquireInstanceLock(dir);
    await erneutFreigeben();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("eine Sperre mit nicht mehr laufendem Prozess wird bereinigt", async () => {
  const dir = await tempDir();
  try {
    await writeFile(
      path.join(dir, "docs-sidecar.lock"),
      `${process.pid + 10_000_000}\n`,
      { mode: 0o600 },
    );
    const release = await acquireInstanceLock(dir);
    await release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("eine unlesbare Sperre wird sicher nicht übernommen", async () => {
  const dir = await tempDir();
  const lockPfad = path.join(dir, "docs-sidecar.lock");
  try {
    await writeFile(lockPfad, "unbekannt\n", { mode: 0o600 });
    await assert.rejects(acquireInstanceLock(dir), /Sperre ist unlesbar/);
    assert.equal(await readFile(lockPfad, "utf8"), "unbekannt\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
