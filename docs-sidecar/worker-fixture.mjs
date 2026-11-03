import { parentPort } from "node:worker_threads";

parentPort.on("message", () => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000);
});
