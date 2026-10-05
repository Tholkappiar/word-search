import type { IncomingMessage, ServerResponse } from "node:http";

export type HealthzPluginOptions = {
  app: string;
};

type ViteConnectServer = {
  middlewares: {
    use(
      handler: (
        request: IncomingMessage,
        response: ServerResponse,
        next: () => void
      ) => void
    ): void;
  };
};

export type HealthzPlugin = {
  name: string;
  configureServer(server: ViteConnectServer): void;
  configurePreviewServer(server: ViteConnectServer): void;
};

export function healthzPlugin({ app }: HealthzPluginOptions): HealthzPlugin {
  const handleHealthz = (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void
  ) => {
    const path = request.url?.split("?")[0];

    if (path !== "/healthz") {
      next();
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.statusCode = 405;
      response.end();
      return;
    }

    response.setHeader("content-type", "application/json; charset=utf-8");
    response.end(JSON.stringify({ ok: true, app }));
  };

  return {
    name: `${app}-healthz`,
    configureServer(server) {
      server.middlewares.use(handleHealthz);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleHealthz);
    }
  };
}
