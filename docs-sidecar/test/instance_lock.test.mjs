import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { acquireInstanceLock } from "../instance_lock.mjs";

async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "msm-docs-lock-"));
}

async function altern(pfad, ms) {
  const wann = new Date(Date.now() - ms);
  await utimes(pfad, wann, wann);
}

test("die Sperre weist eine zweite laufende Instanz ab und wird freigegeben", async () => {
  const dir = await tempDir();
  try {
    const release = await acquireInstanceLock(dir);
    const inhalt = JSON.parse(
      await readFile(path.join(dir, "docs-sidecar.lock"), "utf8"),
    );
    assert.equal(inhalt.pid, process.pid);
    assert.equal(typeof inhalt.owner, "string");
    await assert.rejects(acquireInstanceLock(dir), { code: "DOCS_INSTANCE_RUNNING" });
    await release();
    const erneutFreigeben = await acquireInstanceLock(dir);
    await erneutFreigeben();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("eine verwaiste alte PID-Sperre wird nach Ablauf uebernommen", async () => {
  const dir = await tempDir();
  const lockPfad = path.join(dir, "docs-sidecar.lock");
  try {
    await writeFile(lockPfad, `${process.pid + 10_000_000}\n`, { mode: 0o600 });
    await altern(lockPfad, 120_000);
    const release = await acquireInstanceLock(dir);
    await release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("eine frische unlesbare Sperre wird nicht uebernommen", async () => {
  const dir = await tempDir();
  const lockPfad = path.join(dir, "docs-sidecar.lock");
  try {
    await writeFile(lockPfad, "unbekannt\n", { mode: 0o600 });
    await assert.rejects(acquireInstanceLock(dir), { code: "DOCS_INSTANCE_RUNNING" });
    assert.equal(await readFile(lockPfad, "utf8"), "unbekannt\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("eine abgelaufene unlesbare Sperre wird uebernommen", async () => {
  const dir = await tempDir();
  const lockPfad = path.join(dir, "docs-sidecar.lock");
  try {
    await writeFile(lockPfad, "unbekannt\n", { mode: 0o600 });
    await altern(lockPfad, 120_000);
    const release = await acquireInstanceLock(dir);
    await release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("ein Fremder gibt die Sperre nicht frei", async () => {
  const dir = await tempDir();
  const lockPfad = path.join(dir, "docs-sidecar.lock");
  try {
    const release = await acquireInstanceLock(dir);
    await writeFile(
      lockPfad,
      `${JSON.stringify({ v: 1, pid: 999, owner: "fremd", startedAt: "2026-01-01T00:00:00Z" })}\n`,
      { mode: 0o600 },
    );
    await release();
    assert.match(await readFile(lockPfad, "utf8"), /"owner":"fremd"/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("der Heartbeat haelt eine Lease frisch", async () => {
  const dir = await tempDir();
  const lockPfad = path.join(dir, "docs-sidecar.lock");
  try {
    const release = await acquireInstanceLock(dir, {
      leaseMs: 200,
      heartbeatMs: 25,
    });
    try {
      await altern(lockPfad, 150);
      await new Promise((fertig) => setTimeout(fertig, 80));
      const info = await stat(lockPfad);
      assert.ok(Date.now() - info.mtimeMs < 150, "mtime wurde nicht aufgefrischt");
      await assert.rejects(acquireInstanceLock(dir, { leaseMs: 200 }), {
        code: "DOCS_INSTANCE_RUNNING",
      });
    } finally {
      await release();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("PID 1 im Container blockiert nach Ablauf nicht dauerhaft", async () => {
  const dir = await tempDir();
  const lockPfad = path.join(dir, "docs-sidecar.lock");
  try {
    await writeFile(
      lockPfad,
      `${JSON.stringify({ v: 1, pid: 1, owner: "alt", startedAt: "2026-01-01T00:00:00Z" })}\n`,
      { mode: 0o600 },
    );
    await altern(lockPfad, 120_000);
    const release = await acquireInstanceLock(dir);
    await release();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
