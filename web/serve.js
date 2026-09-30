// Serves the playground at http://localhost:5173 (browsers block ES modules from file://).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.lus': 'text/plain', '.wasm': 'application/wasm', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT) || 5173;

createServer(async (request, response) => {
  const path = normalize(decodeURIComponent(new URL(request.url, 'http://x').pathname));
  const file = join(root, path === '/' ? 'web/index.html' : path);
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    const type = TYPES[extname(file)] ?? 'application/octet-stream';
    response.writeHead(200, { 'content-type': type.startsWith('text/') ? `${type}; charset=utf-8` : type }).end(body);
  } catch {
    response.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Kel playground: http://localhost:${port}`));
