import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { configureHttpServer, startServers } from "../runtime.mjs";

function listening(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("HTTP-Anfragen und inaktive Verbindungen haben feste Fristen", () => {
  const server = http.createServer();
  configureHttpServer(server);
  let socketBeendet = false;

  assert.equal(server.headersTimeout, 10_000);
  assert.equal(server.requestTimeout, 30_000);
  assert.equal(server.timeout, 30_000);
  assert.equal(server.keepAliveTimeout, 5_000);
  server.emit("timeout", {
    destroy() {
      socketBeendet = true;
    },
  });
  assert.equal(socketBeendet, true);
});

test("ein belegter HTTP-Port startet keine zweite WebSocket-Instanz", async () => {
  const belegterPort = http.createServer();
  await listening(belegterPort);
  let websocketGestartet = false;
  const httpServer = http.createServer();
  configureHttpServer(httpServer);

  try {
    await assert.rejects(
      startServers({
        httpServer,
        websocketServer: {
          async listen() {
            websocketGestartet = true;
          },
        },
        httpPort: belegterPort.address().port,
        httpAddress: "127.0.0.1",
      }),
      { code: "EADDRINUSE" },
    );
    assert.equal(websocketGestartet, false);
  } finally {
    await close(belegterPort);
  }
});

test("ein fehlgeschlagener WebSocket-Start gibt den HTTP-Port wieder frei", async () => {
  const probe = http.createServer();
  await listening(probe);
  const port = probe.address().port;
  await close(probe);

  const httpServer = http.createServer();
  configureHttpServer(httpServer);
  await assert.rejects(
    startServers({
      httpServer,
      websocketServer: {
        async listen() {
          throw new Error("WebSocket-Start fehlgeschlagen");
        },
      },
      httpPort: port,
      httpAddress: "127.0.0.1",
    }),
    /WebSocket-Start fehlgeschlagen/,
  );
  assert.equal(httpServer.listening, false);
});
