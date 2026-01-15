import { Hono } from "hono";
import { createUwsServer } from "../dist/uws.js";

const app = new Hono();
app.get("/", (c) => {
  return c.text("hello1");
});

createUwsServer(app, {
  port: 3000,
  host: "localhost",
});
