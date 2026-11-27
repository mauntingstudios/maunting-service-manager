/**
 * Wirksamkeitsbeweis Paket 3E: Argon2id läuft in Worker-Threads und blockiert /decrypt nicht.
 * Runs with `node --test test-argon2-concurrency.mjs`.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

const PORT = 19193;
const TOKEN = 'test-argon2-concurrency-token';
let proc;

async function call(path, body) {
  const start = performance.now();
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const elapsedMs = performance.now() - start;
  return { status: res.status, body: await res.json(), elapsedMs };
}

before(async () => {
  proc = spawn(process.execPath, ['server.mjs'], {
    cwd: import.meta.dirname,
    env: {
      ...process.env,
      MSM_DIS_SIDECAR_PORT: String(PORT),
      MSM_DIS_SIDECAR_TOKEN: TOKEN,
      MSM_SECRET_KEY: crypto.randomBytes(32).toString('base64url'),
      MSM_DIS_SALT: crypto.randomBytes(16).toString('base64'),
      NODE_ENV: 'test',
    },
    stdio: 'ignore',
  });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (res.status === 200) return;
    } catch {
      /* waiting */
    }
  }
  throw new Error('sidecar did not start');
});

after(() => proc?.kill());

test('parallel /decrypt stays < 20ms p95 while /verify-password runs Argon2id in worker threads', async () => {
  const { body: hashed } = await call('/hash-password', { password: 'SyntheticSecretPassword!' });
  assert.ok(hashed.hash.startsWith('msm-pw-v1:'));

  const encItems = [];
  for (let i = 0; i < 20; i++) {
    const { body } = await call('/encrypt', { plaintext: `payload-${i}`, aad: 'aad-test' });
    encItems.push(body.ciphertext);
  }

  // Warm up worker thread WASM compilation and /decrypt path once so steady-state p95 reflects concurrency.
  const warmVerify = await call('/verify-password', {
    password: 'SyntheticSecretPassword!',
    hash: hashed.hash,
  });
  assert.deepEqual(warmVerify.body, { valid: true });
  const warmDecrypt = await call('/decrypt', { ciphertext: encItems[0], aad: 'aad-test' });
  assert.equal(warmDecrypt.body.plaintext, 'payload-0');

  // Fire Argon2id verification and 20 /decrypt calls (in 5x4 waves) while /verify-password is in flight.
  let verifySettled = false;
  const verifyPromise = call('/verify-password', {
    password: 'SyntheticSecretPassword!',
    hash: hashed.hash,
  }).then((res) => {
    verifySettled = true;
    return res;
  });
  await new Promise((r) => setTimeout(r, 10));
  const decryptResults = [];
  for (let wave = 0; wave < 5; wave++) {
    const batch = encItems.slice(wave * 4, wave * 4 + 4);
    const waveRes = await Promise.all(
      batch.map((ciphertext) => call('/decrypt', { ciphertext, aad: 'aad-test' })),
    );
    decryptResults.push(...waveRes);
  }
  assert.equal(verifySettled, false, '/verify-password should still be running after fast /decrypt calls');
  const verifyRes = await verifyPromise;

  assert.equal(verifyRes.status, 200);
  assert.deepEqual(verifyRes.body, { valid: true });

  const latencies = decryptResults.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const p95 = latencies[Math.floor(latencies.length * 0.95) - 1] ?? latencies[latencies.length - 1];
  for (let i = 0; i < 20; i++) {
    assert.equal(decryptResults[i].status, 200);
    assert.equal(decryptResults[i].body.plaintext, `payload-${i}`);
  }
  assert.ok(p95 < 20, `Expected /decrypt p95 < 20ms during Argon2id, got ${p95.toFixed(2)}ms`);

  const wrong = await call('/verify-password', { password: 'wrong', hash: hashed.hash });
  assert.deepEqual(wrong.body, { valid: false });
});
