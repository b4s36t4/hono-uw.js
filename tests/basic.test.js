import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { Hono } from "hono";
import { createUwsServer, closeUwsServer } from "../dist/uws.js";

const PORT = 4567;
const BASE_URL = `http://localhost:${PORT}`;

// Create a Hono app with various routes for testing
const createTestApp = () => {
  const app = new Hono();

  // Basic routes for different HTTP methods
  app.get("/", (c) => c.text("Hello World"));
  app.get("/text", (c) => c.text("plain text response"));
  app.post("/post", (c) => c.text("POST received"));
  app.put("/put", (c) => c.text("PUT received"));
  app.delete("/delete", (c) => c.text("DELETE received"));
  app.patch("/patch", (c) => c.text("PATCH received"));
  app.options("/options", (c) => c.text("OPTIONS received"));

  // Path parameters
  app.get("/users/:id", (c) => {
    const id = c.req.param("id");
    return c.json({ userId: id });
  });

  app.get("/posts/:postId/comments/:commentId", (c) => {
    const postId = c.req.param("postId");
    const commentId = c.req.param("commentId");
    return c.json({ postId, commentId });
  });

  // Query parameters
  app.get("/search", (c) => {
    const query = c.req.query("q");
    const page = c.req.query("page");
    const limit = c.req.query("limit");
    return c.json({ query, page, limit });
  });

  // JSON request/response
  app.post("/json", async (c) => {
    const body = await c.req.json();
    return c.json({ received: body });
  });

  app.post("/echo-json", async (c) => {
    const body = await c.req.json();
    return c.json(body);
  });

  // Headers
  app.get("/headers", (c) => {
    const userAgent = c.req.header("user-agent");
    const customHeader = c.req.header("x-custom-header");
    const authorization = c.req.header("authorization");
    return c.json({ userAgent, customHeader, authorization });
  });

  app.get("/response-headers", (c) => {
    return c.json(
      { message: "ok" },
      200,
      {
        "X-Custom-Response": "custom-value",
        "X-Another-Header": "another-value",
      }
    );
  });

  // Status codes
  app.get("/status/200", (c) => c.text("OK", 200));
  app.get("/status/201", (c) => c.text("Created", 201));
  app.get("/status/204", (c) => c.body(null, 204));
  app.get("/status/400", (c) => c.text("Bad Request", 400));
  app.get("/status/404", (c) => c.text("Not Found", 404));
  app.get("/status/500", (c) => c.text("Internal Server Error", 500));

  // Content types
  app.get("/content/json", (c) => c.json({ type: "json" }));
  app.get("/content/html", (c) => c.html("<h1>Hello</h1>"));
  app.get("/content/text", (c) => c.text("plain text"));

  // Request body types
  app.post("/body/text", async (c) => {
    const text = await c.req.text();
    return c.json({ text });
  });

  app.post("/body/form", async (c) => {
    const formData = await c.req.parseBody();
    return c.json({ form: formData });
  });

  // Large response
  app.get("/large", (c) => {
    const data = { items: Array(1000).fill({ id: 1, name: "test" }) };
    return c.json(data);
  });

  // Binary response
  app.get("/binary", (c) => {
    const buffer = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    return c.body(buffer, 200, { "Content-Type": "application/octet-stream" });
  });

  // Async handler
  app.get("/async", async (c) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return c.json({ async: true });
  });

  // Not found handler
  app.notFound((c) => c.json({ error: "Not Found" }, 404));

  return app;
};

describe("hono-uws server tests", () => {
  let server;

  before(async () => {
    const app = createTestApp();
    server = createUwsServer(app, {
      port: PORT,
      host: "localhost",
      overrideGlobalObjects: false,
    });
    // Wait for server to be ready
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  after(() => {
    if (server) {
      closeUwsServer(server);
    }
  });

  // ============================================================================
  // HTTP Methods
  // ============================================================================

  describe("HTTP Methods", () => {
    test("GET request", async () => {
      const res = await fetch(`${BASE_URL}/`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), "Hello World");
    });

    test("POST request", async () => {
      const res = await fetch(`${BASE_URL}/post`, { method: "POST" });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), "POST received");
    });

    test("PUT request", async () => {
      const res = await fetch(`${BASE_URL}/put`, { method: "PUT" });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), "PUT received");
    });

    test("DELETE request", async () => {
      const res = await fetch(`${BASE_URL}/delete`, { method: "DELETE" });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), "DELETE received");
    });

    test("PATCH request", async () => {
      const res = await fetch(`${BASE_URL}/patch`, { method: "PATCH" });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), "PATCH received");
    });

    test("OPTIONS request", async () => {
      const res = await fetch(`${BASE_URL}/options`, { method: "OPTIONS" });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(await res.text(), "OPTIONS received");
    });
  });

  // ============================================================================
  // Path Parameters
  // ============================================================================

  describe("Path Parameters", () => {
    test("single path parameter", async () => {
      const res = await fetch(`${BASE_URL}/users/123`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.userId, "123");
    });

    test("multiple path parameters", async () => {
      const res = await fetch(`${BASE_URL}/posts/456/comments/789`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.postId, "456");
      assert.strictEqual(json.commentId, "789");
    });

    test("path parameter with special characters", async () => {
      const res = await fetch(`${BASE_URL}/users/user-name_123`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.userId, "user-name_123");
    });
  });

  // ============================================================================
  // Query Parameters
  // ============================================================================

  describe("Query Parameters", () => {
    test("single query parameter", async () => {
      const res = await fetch(`${BASE_URL}/search?q=hello`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.query, "hello");
    });

    test("multiple query parameters", async () => {
      const res = await fetch(`${BASE_URL}/search?q=hello&page=1&limit=10`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.query, "hello");
      assert.strictEqual(json.page, "1");
      assert.strictEqual(json.limit, "10");
    });

    test("query parameter with encoded characters", async () => {
      const res = await fetch(`${BASE_URL}/search?q=${encodeURIComponent("hello world")}`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.query, "hello world");
    });

    test("missing query parameters return undefined", async () => {
      const res = await fetch(`${BASE_URL}/search`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.query, undefined);
      assert.strictEqual(json.page, undefined);
    });
  });

  // ============================================================================
  // JSON Payloads
  // ============================================================================

  describe("JSON Payloads", () => {
    test("POST JSON body", async () => {
      const payload = { name: "John", age: 30 };
      const res = await fetch(`${BASE_URL}/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.deepStrictEqual(json.received, payload);
    });

    test("POST nested JSON body", async () => {
      const payload = {
        user: { name: "John", address: { city: "NYC", zip: "10001" } },
        items: [1, 2, 3],
      };
      const res = await fetch(`${BASE_URL}/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.deepStrictEqual(json.received, payload);
    });

    test("POST large JSON body", async () => {
      const payload = { items: Array(100).fill({ id: 1, name: "test item" }) };
      const res = await fetch(`${BASE_URL}/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.received.items.length, 100);
    });

    test("echo JSON preserves data", async () => {
      const payload = { key: "value", number: 42, bool: true, arr: [1, 2, 3] };
      const res = await fetch(`${BASE_URL}/echo-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.deepStrictEqual(json, payload);
    });
  });

  // ============================================================================
  // Request Headers
  // ============================================================================

  describe("Request Headers", () => {
    test("standard headers are received", async () => {
      const res = await fetch(`${BASE_URL}/headers`, {
        headers: { "User-Agent": "test-agent" },
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.userAgent, "test-agent");
    });

    test("custom headers are received", async () => {
      const res = await fetch(`${BASE_URL}/headers`, {
        headers: { "X-Custom-Header": "custom-value" },
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.customHeader, "custom-value");
    });

    test("authorization header is received", async () => {
      const res = await fetch(`${BASE_URL}/headers`, {
        headers: { Authorization: "Bearer token123" },
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.authorization, "Bearer token123");
    });

    test("multiple headers are received", async () => {
      const res = await fetch(`${BASE_URL}/headers`, {
        headers: {
          "User-Agent": "test-agent",
          "X-Custom-Header": "custom-value",
          Authorization: "Bearer token",
        },
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.userAgent, "test-agent");
      assert.strictEqual(json.customHeader, "custom-value");
      assert.strictEqual(json.authorization, "Bearer token");
    });
  });

  // ============================================================================
  // Response Headers
  // ============================================================================

  describe("Response Headers", () => {
    test("custom response headers are set", async () => {
      const res = await fetch(`${BASE_URL}/response-headers`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get("x-custom-response"), "custom-value");
      assert.strictEqual(res.headers.get("x-another-header"), "another-value");
    });

    test("content-type header for JSON", async () => {
      const res = await fetch(`${BASE_URL}/content/json`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("application/json"));
    });

    test("content-type header for HTML", async () => {
      const res = await fetch(`${BASE_URL}/content/html`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("text/html"));
    });

    test("content-type header for text", async () => {
      const res = await fetch(`${BASE_URL}/content/text`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers.get("content-type")?.includes("text/plain"));
    });
  });

  // ============================================================================
  // Status Codes
  // ============================================================================

  describe("Status Codes", () => {
    test("200 OK", async () => {
      const res = await fetch(`${BASE_URL}/status/200`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.ok, true);
    });

    test("201 Created", async () => {
      const res = await fetch(`${BASE_URL}/status/201`);
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.ok, true);
    });

    test("204 No Content", async () => {
      const res = await fetch(`${BASE_URL}/status/204`);
      assert.strictEqual(res.status, 204);
      assert.strictEqual(res.ok, true);
    });

    test("400 Bad Request", async () => {
      const res = await fetch(`${BASE_URL}/status/400`);
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.ok, false);
    });

    test("404 Not Found", async () => {
      const res = await fetch(`${BASE_URL}/status/404`);
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.ok, false);
    });

    test("500 Internal Server Error", async () => {
      const res = await fetch(`${BASE_URL}/status/500`);
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.ok, false);
    });
  });

  // ============================================================================
  // Content Types
  // ============================================================================

  describe("Content Types", () => {
    test("JSON response", async () => {
      const res = await fetch(`${BASE_URL}/content/json`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.deepStrictEqual(json, { type: "json" });
    });

    test("HTML response", async () => {
      const res = await fetch(`${BASE_URL}/content/html`);
      assert.strictEqual(res.status, 200);
      const html = await res.text();
      assert.strictEqual(html, "<h1>Hello</h1>");
    });

    test("plain text response", async () => {
      const res = await fetch(`${BASE_URL}/content/text`);
      assert.strictEqual(res.status, 200);
      const text = await res.text();
      assert.strictEqual(text, "plain text");
    });

    test("binary response", async () => {
      const res = await fetch(`${BASE_URL}/binary`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers.get("content-type"), "application/octet-stream");
      const buffer = await res.arrayBuffer();
      const text = new TextDecoder().decode(buffer);
      assert.strictEqual(text, "Hello");
    });
  });

  // ============================================================================
  // Request Body
  // ============================================================================

  describe("Request Body", () => {
    test("text body", async () => {
      const res = await fetch(`${BASE_URL}/body/text`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "Hello, World!",
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.text, "Hello, World!");
    });

    test("form data body", async () => {
      const formData = new URLSearchParams();
      formData.append("name", "John");
      formData.append("age", "30");

      const res = await fetch(`${BASE_URL}/body/form`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.form.name, "John");
      assert.strictEqual(json.form.age, "30");
    });
  });

  // ============================================================================
  // Large Responses
  // ============================================================================

  describe("Large Responses", () => {
    test("large JSON response", async () => {
      const res = await fetch(`${BASE_URL}/large`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.items.length, 1000);
    });
  });

  // ============================================================================
  // Async Handlers
  // ============================================================================

  describe("Async Handlers", () => {
    test("async handler works correctly", async () => {
      const res = await fetch(`${BASE_URL}/async`);
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.async, true);
    });
  });

  // ============================================================================
  // Not Found
  // ============================================================================

  describe("Not Found Handling", () => {
    test("404 for unknown route", async () => {
      const res = await fetch(`${BASE_URL}/unknown-route`);
      assert.strictEqual(res.status, 404);
      const json = await res.json();
      assert.strictEqual(json.error, "Not Found");
    });
  });

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe("Edge Cases", () => {
    test("empty body POST", async () => {
      const res = await fetch(`${BASE_URL}/body/text`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "",
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.text, "");
    });

    test("trailing slash handling", async () => {
      const res = await fetch(`${BASE_URL}/text`);
      assert.strictEqual(res.status, 200);
    });

    test("unicode in body", async () => {
      const payload = { message: "Hello 世界 🌍 émojis" };
      const res = await fetch(`${BASE_URL}/echo-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      assert.strictEqual(res.status, 200);
      const json = await res.json();
      assert.strictEqual(json.message, "Hello 世界 🌍 émojis");
    });

    test("concurrent requests", async () => {
      const requests = Array(10)
        .fill(null)
        .map((_, i) => fetch(`${BASE_URL}/users/${i}`));
      const responses = await Promise.all(requests);

      for (let i = 0; i < responses.length; i++) {
        assert.strictEqual(responses[i].status, 200);
        const json = await responses[i].json();
        assert.strictEqual(json.userId, String(i));
      }
    });
  });
});
