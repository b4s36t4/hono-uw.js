# hono-uws

uWebSockets.js adapter for Hono. This lets you run a Hono app on top of uWS for higher throughput than `node:http`.

## Install

```
npm install hono uWebSockets.js@github:uNetworking/uWebSockets.js#v20.51.0
```

## Usage

```ts
import { Hono } from "hono";
import { createUwsServer } from "hono-uws";

const app = new Hono();
app.get("/", (c) => c.text("hello"));

const server = createUwsServer(app, {
  port: 3000,
  origin: "http://localhost:3000"
});

await server.listen();
console.log("listening on http://localhost:3000");
```

## Notes

- `origin` is used to build the incoming `Request` URL for Hono. If you omit it, `http://localhost` is used.
- `close()` shuts down the uWS listen socket.
- To enable HTTP/2, pass TLS options to `ssl` and use `https://` in `origin` (ALPN negotiates HTTP/2).
- WebSockets can be registered directly on `server.app` before calling `listen()`.
- `maxResponseBufferBytes` lets small responses be buffered and sent in one write (default 64KB).
- `overrideGlobalResponse` swaps in a Response subclass to capture raw text/Uint8Array bodies for a faster write path (default true).

## Benchmark

```
npm run build
npm run bench
```

The benchmark writes a `BENCHMARK.md` file with the latest results.

Environment overrides: `BENCH_CONNECTIONS`, `BENCH_DURATION`, `BENCH_PIPELINING`, `BENCH_WARMUP`.

Example WebSocket registration:

```ts
server.app.ws("/ws", {
  message(ws, message) {
    ws.send(message);
  }
});
```
