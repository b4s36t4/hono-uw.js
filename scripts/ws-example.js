import { Hono } from "hono";
import { createUwsServer, createUwsWebSocket } from "../dist/uws.js";

const app = new Hono();

// Create WebSocket helpers
const { upgradeWebSocket } = createUwsWebSocket({ app });

// Regular HTTP route
app.get("/", (c) => {
  return c.text("Hello from Hono + uWebSockets.js!");
});

// WebSocket route - echo server
// Hono handles the routing - no need to pass the path
app.get(
  "/ws",
  upgradeWebSocket((c) => {
    console.log("WebSocket handler called for:", c.req.url);

    return {
      onOpen(event, ws) {
        console.log("Client connected!");
        ws.send("Welcome to the WebSocket server!");
      },

      onMessage(event, ws) {
        console.log("Received message:", event.data);
        // Echo the message back
        ws.send(`Echo: ${event.data}`);
      },

      onClose(event, ws) {
        console.log("Client disconnected. Code:", event.code, "Reason:", event.reason);
      },

      onError(event, ws) {
        console.error("WebSocket error:", event);
      },
    };
  })
);

// Chat room example - broadcast to all clients
const clients = new Set();

app.get(
  "/chat",
  upgradeWebSocket((c) => {
    let wsContext;

    return {
      onOpen(event, ws) {
        wsContext = ws;
        clients.add(ws);
        console.log(`Chat: Client joined. Total clients: ${clients.size}`);
        
        // Broadcast join message
        for (const client of clients) {
          if (client !== ws) {
            client.send(JSON.stringify({ type: "system", message: "A new user joined" }));
          }
        }
      },

      onMessage(event, ws) {
        const message = event.data;
        console.log("Chat message:", message);

        // Broadcast to all clients
        for (const client of clients) {
          client.send(JSON.stringify({ type: "message", message }));
        }
      },

      onClose(event, ws) {
        clients.delete(ws);
        console.log(`Chat: Client left. Total clients: ${clients.size}`);

        // Broadcast leave message
        for (const client of clients) {
          client.send(JSON.stringify({ type: "system", message: "A user left" }));
        }
      },
    };
  })
);

// Start server
createUwsServer(app, {
  port: 3000,
  host: "localhost",
});

console.log(`
WebSocket server running!

Test with:
  - HTTP: curl http://localhost:3000
  - WebSocket Echo: wscat -c ws://localhost:3000/ws
  - WebSocket Chat: wscat -c ws://localhost:3000/chat

If you don't have wscat, install it with: npm install -g wscat
Or use a browser console:
  const ws = new WebSocket('ws://localhost:3000/ws');
  ws.onmessage = (e) => console.log('Received:', e.data);
  ws.onopen = () => ws.send('Hello!');
`);
