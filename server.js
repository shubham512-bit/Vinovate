const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, 'public');
const rooms = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/info') {
    const lan = Object.values(os.networkInterfaces()).flat().find(x => x && x.family === 'IPv4' && !x.internal);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ host: lan?.address || url.hostname, port: server.address()?.port || 3000 }));
  }
  let file = url.pathname === '/' ? 'index.html' : path.basename(decodeURIComponent(url.pathname));
  const full = path.join(ROOT, file);
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

function send(socket, data) {
  if (socket.destroyed) return;
  const body = Buffer.from(JSON.stringify(data));
  let header;
  if (body.length < 126) header = Buffer.from([0x81, body.length]);
  else if (body.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(body.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(body.length), 2); }
  socket.write(Buffer.concat([header, body]));
}
function join(socket, role, room) {
  room = String(room || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (!room) return send(socket, { type: 'error', message: 'Enter a room code first.' });
  socket.role = role; socket.room = room;
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(socket);
  send(socket, { type: 'joined', role, room });
  for (const peer of rooms.get(room)) if (peer !== socket) send(peer, { type: 'peer', role, connected: true });
  send(socket, { type: 'peer', role: role === 'host' ? 'controller' : 'host', connected: [...rooms.get(room)].some(p => p !== socket && p.role !== role) });
}
function receive(socket, value) {
  let msg; try { msg = JSON.parse(value); } catch { return; }
  if (msg.type === 'join') return join(socket, msg.role, msg.room);
  if (!socket.room || !rooms.has(socket.room)) return;
  for (const peer of rooms.get(socket.room)) if (peer !== socket && peer.role !== socket.role) send(peer, msg);
}
server.on('upgrade', (req, socket) => {
  if (req.url.split('?')[0] !== '/ws' || !req.headers['sec-websocket-key']) return socket.destroy();
  const accept = crypto.createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  let buffer = Buffer.alloc(0);
  socket.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 15; let len = buffer[1] & 127; let offset = 2;
      if (len === 126) { if (buffer.length < 4) return; len = buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (buffer.length < 10) return; len = Number(buffer.readBigUInt64BE(2)); offset = 10; }
      const masked = (buffer[1] & 128) !== 0; const total = offset + (masked ? 4 : 0) + len;
      if (buffer.length < total) return;
      let payload = buffer.subarray(offset + (masked ? 4 : 0), total);
      if (masked) { const key = buffer.subarray(offset, offset + 4); payload = Buffer.from(payload); for (let i = 0; i < payload.length; i++) payload[i] ^= key[i % 4]; }
      buffer = buffer.subarray(total);
      if (opcode === 8) { socket.end(); return; }
      if (opcode === 1) receive(socket, payload.toString());
    }
  });
  socket.on('close', () => {
    if (!socket.room || !rooms.has(socket.room)) return;
    const peers = rooms.get(socket.room); peers.delete(socket);
    for (const peer of peers) send(peer, { type: 'peer', role: socket.role, connected: false });
    if (!peers.size) rooms.delete(socket.room);
  });
});
const port = Number(process.env.PORT || 3000);
server.listen(port, '0.0.0.0', () => {
  const lan = Object.values(os.networkInterfaces()).flat().find(x => x && x.family === 'IPv4' && !x.internal);
  console.log(`TiltPlay ready: http://localhost:${port}${lan ? ` (phone on same Wi-Fi: http://${lan.address}:${port})` : ''}`);
});

