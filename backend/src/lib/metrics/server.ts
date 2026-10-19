import { createServer, type Server } from 'node:http';
import { logger } from '../../utils/logger.js';
import { registry } from './registry.js';

export const startMetricsServer = (port: number): Server => {
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || req.url !== '/metrics') {
      res.writeHead(404).end();
      return;
    }
    registry
      .metrics()
      .then((body) => res.writeHead(200, { 'Content-Type': registry.contentType }).end(body))
      .catch((err: unknown) => {
        logger.error({ err }, 'could not collect metrics');
        res.writeHead(500).end();
      });
  });
  server.listen(port, () => logger.info({ port }, 'metrics listening'));
  return server;
};

export const closeMetricsServer = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));
