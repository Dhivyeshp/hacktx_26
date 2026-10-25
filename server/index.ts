import "dotenv/config";
import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import { createApp } from "./app";
import { resetLiveRecordings } from "./conversation";
const { app, db, audio, rewards } = await createApp();
await rewards.recover();
await resetLiveRecordings(db);
const server = createServer(app);
audio.attach(server);
// Expired grants are swept in TigerDB. A failed sweep is retried next minute
// rather than taken as fatal: every read also filters on expires_at.
setInterval(() => {
  void (async () => {
    for (const table of [
      "connections",
      "oauth",
      "questions_invites",
      "questions_access",
    ])
      await db
        .prepare(`DELETE FROM ${table} WHERE expires_at<?`)
        .run(Date.now());
  })().catch(() => console.warn("[tigerdb] grant sweep failed"));
}, 60000).unref();
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist")));
  app.get("*", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer: createVite } = await import("vite");
  const vite = await createVite({
    server: {
      middlewareMode: true,
      hmr: { server },
      allowedHosts: process.env.PUBLIC_URL
        ? [new URL(process.env.PUBLIC_URL).hostname]
        : [],
    },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT) || 3000;
server.listen(port, "0.0.0.0", () =>
  console.log(`Destina is ready: http://localhost:${port}`),
);
