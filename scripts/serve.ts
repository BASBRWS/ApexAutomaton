import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Tiny dependency-free static server for the local pages (setup wizard +
 * dashboard). Serves the repo root so `../state/...` fetches resolve the same
 * way they do on GitHub Pages.
 *
 *   npm run setup      -> opens the setup wizard  (/setup/)
 *   npm run dashboard  -> opens the dashboard     (/dashboard/)
 *
 * The setup wizard is intentionally LOCAL ONLY — it handles secrets and is never
 * published to GitHub Pages.
 */

const ROOT = process.cwd();
const PORT = Number(process.env.PORT ?? 4173);
const target = process.argv[2] === 'dashboard' ? 'dashboard' : process.argv[2] === 'setup' ? 'setup' : 'dashboard';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ndjson': 'application/x-ndjson; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const rawUrl = req.url ?? '/';
  const urlPath = decodeURIComponent(rawUrl.split('?')[0]!);

  if (urlPath === '/') {
    res.writeHead(302, { Location: `/${target}/` });
    res.end();
    return;
  }

  let abs = path.normalize(path.join(ROOT, urlPath));
  if (!abs.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }

  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(abs);
  } catch {
    stat = undefined;
  }
  if (stat?.isDirectory()) abs = path.join(abs, 'index.html');

  fs.readFile(abs, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('404 not found');
      return;
    }
    const type = TYPES[path.extname(abs).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}/${target}/`;
  console.log(`Serving ${ROOT}`);
  console.log(`${target === 'setup' ? 'Setup wizard' : 'Dashboard'}: ${url}`);
  console.log('Press Ctrl+C to stop.');
  tryOpen(url);
});

/** Best-effort browser open; silently ignored if it fails. */
function tryOpen(url: string): void {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' });
    child.on('error', () => {});
    child.unref();
  } catch {
    /* ignore — the URL is printed above */
  }
}
