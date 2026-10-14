# TiltPlay

TiltPlay turns a phone into a motion controller for a small browser racing game. It runs as a single Node.js server, so the laptop and phone share one room and one local WebSocket connection.

## Run it

1. Install Node.js 18 or newer.
2. Run `npm start` in this folder.
3. Open `http://localhost:3000` on the laptop.
4. On the phone, open the **phone on same Wi-Fi** address printed by the server. Enter the six-character room code shown on the laptop.
5. Allow motion access if the browser asks. Hold the phone in a comfortable neutral position and tap **Recalibrate**.

The phone page also supports drag steering, boost, brake, and hop buttons if motion sensors are unavailable. Both devices need to be able to reach the laptop on the same local network. Allow Node.js through the laptop firewall if the phone cannot connect.

## Controls

- Tilt left/right: steer
- Shake or hold boost: accelerate
- Brake: slow down
- Hop: jump

## Pairing and latency

The laptop creates a random six-character room. Both pages connect to `/ws` and send a room-and-role join message. The server relays controller inputs only to the laptop peer in that room. There are no accounts or external services. Rooms are held in memory and disappear after both devices disconnect.

The phone sends sensor state about 30 times per second over a persistent WebSocket. The game loop applies steering with interpolation, which smooths the input between packets. A periodic ping/pong displays approximate round-trip time. Actual latency depends on Wi-Fi quality and browser scheduling.

On iPhone and some Android browsers, sensor access requires permission and a secure context. The permission prompt is initiated by the phone's Connect button. If the browser refuses sensor access on a local HTTP address, use the on-screen touch steering and controls, or serve the app through HTTPS.

## Stack

- Node.js built-in HTTP, crypto, and networking modules
- Browser HTML, CSS, Canvas 2D, and Device Orientation / Motion APIs
- A small built-in WebSocket endpoint; no runtime packages to install

## Project layout

- `server.js` — static file server, room registry, and WebSocket relay
- `public/index.html` — laptop game and phone controller views
- `public/style.css` — responsive visual design
- `public/app.js` — pairing, sensors, controls, and canvas game

