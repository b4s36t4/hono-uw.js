// Use structural typing to avoid version conflicts with consumer's Hono
type HonoLike = {
  fetch: (request: Request) => Response | Promise<Response>;
};
import uWS from "uWebSockets.js";
import type { Context } from "hono";

// ============================================================================
// CloseEvent Polyfill (not available in Node.js)
// ============================================================================

class CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;

  constructor(type: string, init?: { code?: number; reason?: string; wasClean?: boolean }) {
    super(type);
    this.code = init?.code ?? 1000;
    this.reason = init?.reason ?? "";
    this.wasClean = init?.wasClean ?? true;
  }
}

// ============================================================================
// WebSocket Types and Implementation
// ============================================================================

export interface WSContext {
  send(
    data: string | ArrayBuffer | Uint8Array,
    isBinary?: boolean,
    compress?: boolean
  ): void;
  close(code?: number, reason?: string): void;
  getRaw(): uWS.WebSocket<WebSocketData>;
}

export interface WSEvents {
  onOpen?: (event: Event, ws: WSContext) => void;
  onMessage?: (event: MessageEvent, ws: WSContext) => void;
  onClose?: (event: CloseEvent, ws: WSContext) => void;
  onError?: (event: Event, ws: WSContext) => void;
}

export type WSHandler = (c: Context) => WSEvents | Promise<WSEvents>;

interface WebSocketData {
  url: string;
  headers: [string, string][];
  events?: WSEvents;
  context?: Context;
}

// Store for WebSocket handlers registered via upgradeWebSocket
// Path -> Handler mapping, populated when Hono middleware runs
const wsHandlers = new Map<string, WSHandler>();

/**
 * Create WebSocket helpers for use with Hono and uWebSockets.js
 * 
 * Usage:
 * ```
 * const { upgradeWebSocket } = createUwsWebSocket();
 * 
 * app.get('/ws', upgradeWebSocket((c) => ({
 *   onOpen(event, ws) { ws.send('Welcome!'); },
 *   onMessage(event, ws) { ws.send(`Echo: ${event.data}`); },
 *   onClose() { console.log('Closed'); }
 * })));
 * ```
 */
export const createUwsWebSocket = (_options?: { app?: HonoLike }) => {
  /**
   * Middleware to upgrade HTTP connection to WebSocket
   * Hono handles the path routing - no need to pass the path
   * @param handler - Function returning WebSocket event handlers
   */
  const upgradeWebSocket = (handler: WSHandler) => {
    // Return middleware that signals WebSocket upgrade and registers handler
    return async (c: Context) => {
      // Extract path from request URL and register handler
      const url = new URL(c.req.url);
      wsHandlers.set(url.pathname, handler);
      
      // Return 101 to indicate this should be handled as WebSocket
      return new Response(null, { status: 101, statusText: "Switching Protocols" });
    };
  };

  return { upgradeWebSocket };
};

// Create WSContext wrapper for uWS WebSocket
const createWSContext = (ws: uWS.WebSocket<WebSocketData>): WSContext => ({
  send(
    data: string | ArrayBuffer | Uint8Array,
    isBinary = false,
    compress = false
  ) {
    ws.send(data, isBinary, compress);
  },
  close(code?: number, reason?: string) {
    ws.end(code, reason);
  },
  getRaw() {
    return ws;
  },
});

// ============================================================================
// Lightweight Response Implementation (inspired by @hono/node-server)
// ============================================================================

const responseCache = Symbol("responseCache");
const getResponseCache = Symbol("getResponseCache");
const cacheKey = Symbol("cache");
const GlobalResponse = globalThis.Response;

type ResponseCache = [
  number,
  string | ReadableStream | Blob | Uint8Array,
  Headers | Record<string, string>
];

class LightweightResponse {
  #body: BodyInit | null;
  #init: ResponseInit | undefined;
  [responseCache]?: Response;
  [cacheKey]?: ResponseCache;

  [getResponseCache](): Response {
    delete this[cacheKey];
    return (this[responseCache] ||= new GlobalResponse(this.#body, this.#init));
  }

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this.#body = body ?? null;
    this.#init = init;

    // Cache simple response types for fast access
    // Also cache null body responses (e.g., 101 Switching Protocols for WebSocket)
    if (
      body === null ||
      body === undefined ||
      typeof body === "string" ||
      typeof (body as ReadableStream | undefined)?.getReader !== "undefined" ||
      body instanceof Blob ||
      body instanceof Uint8Array
    ) {
      let headers: Headers | Record<string, string>;
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          headers = init.headers;
        } else if (Array.isArray(init.headers)) {
          headers = new Headers(init.headers);
        } else {
          headers = init.headers as Record<string, string>;
        }
      } else {
        headers = {};
      }
      this[cacheKey] = [
        init?.status || 200,
        (body ?? "") as string | ReadableStream | Blob | Uint8Array,
        headers,
      ];
    }
  }

  get headers(): Headers {
    const cache = this[cacheKey];
    if (cache) {
      if (!(cache[2] instanceof Headers)) {
        cache[2] = new Headers(cache[2] as Record<string, string>);
      }
      return cache[2] as Headers;
    }
    return this[getResponseCache]().headers;
  }

  get status(): number {
    return this[cacheKey]?.[0] ?? this[getResponseCache]().status;
  }

  get ok(): boolean {
    const status = this.status;
    return status >= 200 && status < 300;
  }
}

// Proxy properties that need the full Response object
["body", "bodyUsed", "redirected", "statusText", "type", "url"].forEach((k) => {
  Object.defineProperty(LightweightResponse.prototype, k, {
    get() {
      return (this as unknown as Record<symbol, () => Response>)[
        getResponseCache
      ]()[k as keyof Response];
    },
  });
});

// Proxy methods that need the full Response object
["arrayBuffer", "blob", "clone", "formData", "json", "text"].forEach((k) => {
  Object.defineProperty(LightweightResponse.prototype, k, {
    value: function () {
      return (
        (this as unknown as Record<symbol, () => Response>)[
          getResponseCache
        ]() as unknown as Record<string, () => unknown>
      )[k]();
    },
  });
});

Object.setPrototypeOf(LightweightResponse, GlobalResponse);
Object.setPrototypeOf(LightweightResponse.prototype, GlobalResponse.prototype);

// ============================================================================
// Lightweight Request Implementation (inspired by @hono/node-server)
// ============================================================================

const urlKey = Symbol("url");
const methodKey = Symbol("method");
const headersDataKey = Symbol("headersData");
const headersKey = Symbol("headers");
const bodyKey = Symbol("body");
const requestCacheKey = Symbol("requestCache");
const getRequestCache = Symbol("getRequestCache");

const GlobalRequest = globalThis.Request;

// Extended Request class that handles cache lookup
class LightweightRequest extends GlobalRequest {
  constructor(input: string | Request, options?: RequestInit) {
    if (typeof input === "object" && getRequestCache in input) {
      input = (input as unknown as Record<symbol, () => Request>)[
        getRequestCache
      ]();
    }
    if (
      typeof (options?.body as ReadableStream | undefined)?.getReader !==
      "undefined"
    ) {
      (options as Record<string, unknown>).duplex ??= "half";
    }
    super(input, options);
  }
}

// Lazy request prototype
const requestPrototype: Record<string | symbol, unknown> = {
  get method() {
    return (this as Record<symbol, string>)[methodKey];
  },

  get url() {
    return (this as Record<symbol, string>)[urlKey];
  },

  get headers() {
    const self = this as Record<symbol, unknown>;
    if (!self[headersKey]) {
      self[headersKey] = new Headers(
        self[headersDataKey] as [string, string][]
      );
    }
    return self[headersKey] as Headers;
  },

  [getRequestCache]() {
    const self = this as Record<symbol, unknown>;
    if (!self[requestCacheKey]) {
      self[requestCacheKey] = new LightweightRequest(self[urlKey] as string, {
        method: self[methodKey] as string,
        headers: self[headersDataKey] as [string, string][],
        body: self[bodyKey] as ReadableStream | null,
      });
    }
    return self[requestCacheKey] as Request;
  },
};

// Proxy properties that need the full Request object
[
  "body",
  "bodyUsed",
  "cache",
  "credentials",
  "destination",
  "integrity",
  "mode",
  "redirect",
  "referrer",
  "referrerPolicy",
  "signal",
  "keepalive",
].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    get() {
      return (this as Record<symbol, () => Request>)[getRequestCache]()[
        k as keyof Request
      ];
    },
  });
});

// Proxy methods that need the full Request object
["arrayBuffer", "blob", "clone", "formData", "json", "text"].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    value: function () {
      return (
        (this as Record<symbol, () => Request>)[
          getRequestCache
        ]() as unknown as Record<string, () => unknown>
      )[k]();
    },
  });
});

Object.setPrototypeOf(requestPrototype, LightweightRequest.prototype);

// Create a lazy request object
const createLazyRequest = (
  method: string,
  url: string,
  headersData: [string, string][],
  body: ReadableStream | null
): Request => {
  const req = Object.create(requestPrototype);
  req[methodKey] = method;
  req[urlKey] = url;
  req[headersDataKey] = headersData;
  req[bodyKey] = body;
  return req as Request;
};

// ============================================================================
// uWebSockets Server Implementation
// ============================================================================

const getBody = (res: uWS.HttpResponse) => {
  const bodyStream = new TransformStream();
  const writer = bodyStream.writable.getWriter();

  res.onData((chunk, isLast) => {
    // uWebSockets passes ArrayBuffer that gets reused, so we must copy it
    const copy = new Uint8Array(chunk.byteLength);
    copy.set(new Uint8Array(chunk));
    writer.write(copy);
    if (isLast) {
      writer.close();
    }
  });

  res.onAborted(() => {
    writer.abort();
  });

  return bodyStream.readable;
};

// Build outgoing headers for uWS
const writeHeaders = (
  res: uWS.HttpResponse,
  headers: Headers | Record<string, string>
) => {
  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      res.writeHeader(key, value);
    });
  } else {
    for (const key in headers) {
      res.writeHeader(key, headers[key]);
    }
  }
};

// Fast path: write response directly from cache
const writeResponseViaCache = (
  res: uWS.HttpResponse,
  cache: ResponseCache,
  aborted: boolean
): boolean => {
  if (aborted) return true;

  const [status, body, headers] = cache;

  // Only handle string/Uint8Array bodies synchronously - this is the fast path
  if (typeof body === "string") {
    res.cork(() => {
      res.writeStatus(status.toString());
      writeHeaders(res, headers);
      res.end(body);
    });
    return true;
  }

  if (body instanceof Uint8Array) {
    res.cork(() => {
      res.writeStatus(status.toString());
      writeHeaders(res, headers);
      res.end(body);
    });
    return true;
  }

  // ReadableStream or Blob needs async handling
  return false;
};

// Async path for responses that need body reading
const writeResponseAsync = async (
  res: uWS.HttpResponse,
  honoResponse: Response,
  aborted: () => boolean
) => {
  if (aborted()) return;

  const contentType = honoResponse.headers.get("content-type");
  const status = honoResponse.status;

  // Fast path for text-based responses
  if (
    contentType &&
    (contentType.startsWith("text/") ||
      contentType.startsWith("application/json") ||
      contentType.includes("+json"))
  ) {
    const text = await honoResponse.text();
    if (aborted()) return;

    res.cork(() => {
      res.writeStatus(status.toString());
      honoResponse.headers.forEach((value, key) => {
        res.writeHeader(key, value);
      });
      res.end(text);
    });
    return;
  }

  // Binary responses
  const responseBody = await honoResponse.arrayBuffer();
  if (aborted()) return;

  res.cork(() => {
    res.writeStatus(status.toString());
    honoResponse.headers.forEach((value, key) => {
      res.writeHeader(key, value);
    });
    if (responseBody.byteLength > 0) {
      res.end(new Uint8Array(responseBody));
    } else {
      res.end();
    }
  });
};

export const createUwsServer = (
  app: HonoLike,
  options: {
    port: number;
    host: string;
    ca?: { file_name: string; cert_file_name: string; passphrase: string };
    overrideGlobalObjects?: boolean;
  }
) => {
  const isSSLEnabled = options.ca !== undefined;
  const protocol = isSSLEnabled ? "https" : "http";

  // Override global Request/Response with lightweight versions
  // This is the key optimization - Hono will create lightweight responses with cacheKey
  if (options.overrideGlobalObjects !== false) {
    Object.defineProperty(globalThis, "Response", {
      value: LightweightResponse,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(globalThis, "Request", {
      value: LightweightRequest,
      writable: true,
      configurable: true,
    });
  }

  const uwsApp = isSSLEnabled
    ? uWS.SSLApp({
        passphrase: options.ca?.passphrase,
        cert_file_name: options.ca?.cert_file_name,
        ca_file_name: options.ca?.file_name,
      })
    : uWS.App();

  // WebSocket handler - Hono handles routing
  uwsApp.ws<WebSocketData>("/*", {
    upgrade: (res, req, context) => {
      // Read request data synchronously (uWS invalidates req after callback)
      const path = req.getUrl();
      const query = req.getQuery();
      const host = req.getHeader("host");
      const secWebSocketKey = req.getHeader("sec-websocket-key");
      const secWebSocketProtocol = req.getHeader("sec-websocket-protocol");
      const secWebSocketExtensions = req.getHeader("sec-websocket-extensions");

      // Collect headers
      const headersData: [string, string][] = [];
      req.forEach((name, value) => {
        headersData.push([name, value]);
      });

      const urlString = query
        ? `${protocol}://${host}${path}?${query}`
        : `${protocol}://${host}${path}`;

      // Upgrade all WebSocket connections - Hono will determine validity in open callback
      res.upgrade<WebSocketData>(
        {
          url: urlString,
          headers: headersData,
        },
        secWebSocketKey,
        secWebSocketProtocol,
        secWebSocketExtensions,
        context
      );
    },
    open: async (ws) => {
      const data = ws.getUserData();
      const url = new URL(data.url);
      const path = url.pathname;

      try {
        // Check if handler already registered (from previous connection)
        let handler = wsHandlers.get(path);

        // If not registered, call Hono to trigger middleware and register handler
        if (!handler) {
          const request = createLazyRequest("GET", data.url, data.headers, null);
          const response = await app.fetch(request);

          // Check if Hono returned 101 (WebSocket route)
          if (response.status !== 101) {
            ws.end(1008, "Not Found");
            return;
          }

          // Handler should now be registered by the middleware
          handler = wsHandlers.get(path);
          if (!handler) {
            ws.end(1008, "Not Found");
            return;
          }
        }

        // Create a minimal Hono-like context for the handler
        const request = createLazyRequest("GET", data.url, data.headers, null);
        const mockContext = {
          req: {
            url: data.url,
            header: (name: string) => {
              const found = data.headers.find(
                ([k]) => k.toLowerCase() === name.toLowerCase()
              );
              return found?.[1];
            },
            raw: request,
          },
        } as unknown as Context;

        const events = await handler(mockContext);
        data.events = events;
        data.context = mockContext;

        if (events.onOpen) {
          const wsContext = createWSContext(ws);
          events.onOpen(new Event("open"), wsContext);
        }
      } catch (error) {
        console.error("WebSocket handler error:", error);
        ws.end(1011, "Internal Error");
      }
    },
    message: (ws, message, isBinary) => {
      const data = ws.getUserData();
      if (data.events?.onMessage) {
        const wsContext = createWSContext(ws);
        const messageData = isBinary
          ? new Uint8Array(message)
          : new TextDecoder().decode(message);
        const event = new MessageEvent("message", { data: messageData });
        data.events.onMessage(event, wsContext);
      }
    },
    close: (ws, code, message) => {
      const data = ws.getUserData();
      if (data.events?.onClose) {
        const wsContext = createWSContext(ws);
        const reason = message
          ? new TextDecoder().decode(new Uint8Array(message))
          : "";
        const event = new CloseEvent("close", { code, reason });
        data.events.onClose(event, wsContext);
      }
    },
  });

  uwsApp.any("/*", (res: uWS.HttpResponse, req: uWS.HttpRequest) => {
    // Read all request data synchronously before any async operations
    // uWS invalidates req after the callback returns
    const method = req.getMethod().toUpperCase();
    const path = req.getUrl();
    const query = req.getQuery();
    const host = req.getHeader("host");

    // Collect raw header data - defer Headers creation
    const headersData: [string, string][] = [];
    req.forEach((name, value) => {
      headersData.push([name, value]);
    });

    // Build URL string directly
    const urlString = query
      ? `${protocol}://${host}${path}?${query}`
      : `${protocol}://${host}${path}`;

    // Only create body stream for methods that can have a body
    const body =
      method === "GET" || method === "HEAD" || method === "OPTIONS"
        ? null
        : getBody(res);

    let aborted = false;
    res.onAborted(() => {
      aborted = true;
    });

    // Create lazy request - defers Headers and full Request creation
    const request = createLazyRequest(method, urlString, headersData, body);

    // Call Hono's fetch handler
    const honoResponse = app.fetch(request);

    // Check if response has cache (lightweight Response)
    // This is the key optimization from @hono/node-server
    if (cacheKey in honoResponse) {
      const cache = (honoResponse as unknown as Record<symbol, ResponseCache>)[
        cacheKey
      ];
      if (cache && writeResponseViaCache(res, cache, aborted)) {
        return;
      }
    }

    // Handle Promise response
    if (honoResponse instanceof Promise) {
      honoResponse.then((response) => {
        if (aborted) return;

        // Check cache on resolved response
        if (cacheKey in response) {
          const cache = (response as unknown as Record<symbol, ResponseCache>)[
            cacheKey
          ];
          if (cache && writeResponseViaCache(res, cache, aborted)) {
            return;
          }
        }

        // Fall back to async response handling
        writeResponseAsync(res, response, () => aborted);
      });
    } else {
      // Synchronous response without cache
      writeResponseAsync(res, honoResponse, () => aborted);
    }
  });

  uwsApp.listen(options.host, options.port, (token) => {
    if (token) {
      console.log(`listening on ${protocol}://${options.host}:${options.port}`);
    } else {
      console.log(`Failed to listen on ${options.host}:${options.port}`);
    }
  });

  return uwsApp;
};

export const closeUwsServer = (server: ReturnType<typeof createUwsServer>) => {
  server.close();
};
