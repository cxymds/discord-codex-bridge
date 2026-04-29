import Fastify from "fastify";

interface NotifyServerOptions {
  host: string;
  port: number;
  onTurnEnded: (payload: unknown) => Promise<void>;
}

export async function startNotifyServer(options: NotifyServerOptions) {
  const app = Fastify({ logger: false });

  app.post("/notify/turn-ended", async (request, reply) => {
    await options.onTurnEnded(request.body);
    return reply.send({ ok: true });
  });

  await app.listen({ host: options.host, port: options.port });
  const address = app.server.address();
  const port = address && typeof address === "object" ? address.port : options.port;

  return {
    url: `http://${options.host}:${port}`,
    close: async () => {
      await app.close();
    }
  };
}
