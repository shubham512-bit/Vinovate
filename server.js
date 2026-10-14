const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ROOT = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Invalid path'); }

  if (pathname === '/' || pathname === '/controller') pathname = '/index.html';
  const filePath = path.resolve(ROOT, `.${pathname}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(error.code === 'ENOENT' ? 'Not found' : 'Unable to read file');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(contents);
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find(x => x && x.family === 'IPv4' && !x.internal);
  console.log(`WALL-E Mission Control ready at http://localhost:${port}${lan ? ` (same Wi-Fi: http://${lan.address}:${port})` : ''}`);
});

