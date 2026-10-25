import "dotenv/config";
import { createServer } from "node:http";
import { resolve } from "node:path";
import express from "express";
import { createApp } from "./app";
const { app, db } = createApp();
const server = createServer(app);
setInterval(() => {
  db.prepare("DELETE FROM connections WHERE expires_at<?").run(Date.now());
  db.prepare("DELETE FROM oauth WHERE expires_at<?").run(Date.now());
  db.prepare("DELETE FROM questions_invites WHERE expires_at<?").run(
    Date.now(),
  );
  db.prepare("DELETE FROM questions_access WHERE expires_at<?").run(Date.now());
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
