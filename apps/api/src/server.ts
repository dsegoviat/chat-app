import cors from "@fastify/cors";
import type { ApiStatusResponse } from "@chat-app/contracts";
import Fastify from "fastify";

const port = Number(process.env.PORT ?? 4000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: webOrigin,
  credentials: true
});

app.get("/api/status", async () => {
  const response: ApiStatusResponse = {
    service: "api",
    status: "ok",
    timestamp: new Date().toISOString()
  };
  return response;
});

app.listen({ port, host: "0.0.0.0" }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
