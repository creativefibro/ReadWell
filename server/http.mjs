// Bridges Node's HTTP server to a fetch-style handler, with request size limits.
import {createServer} from 'node:http';

export function serve(handler, {host = '127.0.0.1', port, origin, limit = 7_500_000, onError = () => {}}) {
  const server = createServer(async (req, res) => {
    try {
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) { res.writeHead(400); res.end(); return; }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > limit) { res.writeHead(413, {'Content-Type': 'text/plain'}); res.end('Request too large'); return; }
        chunks.push(chunk);
      }
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      const request = new Request(origin + req.url, {method: req.method, headers: req.headers, ...(hasBody ? {body: Buffer.concat(chunks)} : {})});
      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(req.method === 'HEAD' ? undefined : Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      onError(error);
      if (!res.headersSent) res.writeHead(500, {'Content-Type': 'text/plain', 'Cache-Control': 'no-store'});
      res.end('ReadWell could not complete this request.');
    }
  });
  server.requestTimeout = 60000;
  server.headersTimeout = 15000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve(server));
  });
}
