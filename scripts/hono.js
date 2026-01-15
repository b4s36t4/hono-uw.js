import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

app.get("/", (c) => {
  return c.text("hello1");
});

serve({
  fetch: app.fetch,
  port: 3001,
  host: "localhost",
});
