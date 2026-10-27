import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerAuthRoutes } from "./auth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { startDigestScheduler } from "./digestScheduler";
import { applyHttpSecurity } from "./security";
import { upgradeConfiguredSafetySchema } from "../schemaUpgrade";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  // Dev/start must support an existing database too; only `npm run build` ran db:push before.
  const upgraded = await upgradeConfiguredSafetySchema();
  if (upgraded.length) console.log(`[Database] Added required schema objects: ${upgraded.join(", ")}`);
  const app = express();
  const server = createServer(app);
  applyHttpSecurity(app);
  // Collapse duplicate slashes in the path (e.g. "//api/auth/verify" from an APP_URL with a
  // trailing slash) so already-sent email links still hit the right route.
  app.use((req, _res, next) => {
    const q = req.url.indexOf("?");
    const path = q === -1 ? req.url : req.url.slice(0, q);
    if (path.includes("//")) req.url = path.replace(/\/{2,}/g, "/") + (q === -1 ? "" : req.url.slice(q));
    next();
  });
  // Keep JSON payloads bounded; file traffic uses the storage proxy registered below.
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ limit: "5mb", extended: true }));
  registerStorageProxy(app);
  registerAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`Server timezone: ${process.env.TZ || "UTC (TZ not set -- set it to your facility's zone)"}`);
  });

  startDigestScheduler();
}

startServer().catch(error => { console.error("Server startup failed:", error); process.exitCode = 1; });
