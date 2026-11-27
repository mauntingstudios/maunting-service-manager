import { parentPort } from 'node:worker_threads';
import { argon2idRaw } from '@msdis/shield/kdf';

parentPort.on('message', async (task) => {
  const { id, password, salt, memorySize, iterations, parallelism, hashLength } = task;
  const saltBytes = salt instanceof Uint8Array ? salt : new Uint8Array(salt);
  try {
    const out = await argon2idRaw({
      password,
      salt: saltBytes,
      memorySize,
      iterations,
      parallelism,
      hashLength,
    });
    const copy = new Uint8Array(out.length);
    copy.set(out);
    out.fill(0);
    parentPort.postMessage({ id, result: copy.buffer }, [copy.buffer]);
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message || 'Argon2Failed' });
  } finally {
    saltBytes.fill(0);
  }
});
