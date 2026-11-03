export function configureHttpServer(server) {
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.timeout = 30_000;
  server.keepAliveTimeout = 5_000;
  server.on("timeout", (socket) => socket.destroy());
}

function listen(server, port, address) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, address);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function startServers({
  httpServer,
  websocketServer,
  httpPort,
  httpAddress,
}) {
  await listen(httpServer, httpPort, httpAddress);
  try {
    await websocketServer.listen();
  } catch (error) {
    await close(httpServer);
    throw error;
  }
}
