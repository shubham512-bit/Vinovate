# WALL-E and EVE's Signal

A small autonomous search-and-rescue simulation. WALL-E starts with a noisy signal bearing, explores a hidden grid, discovers evidence only through scans and proximity, manages a finite battery, and returns to base with a mission report.

## Run locally

1. Install Node.js 18 or newer.
2. Run `npm start` from the project folder.
3. Open [http://localhost:3000](http://localhost:3000).
4. Choose **Quiet Garden · sample**, then use **Start mission** or **Step +1** to watch the planner.

No runtime packages are required. The server prints a same-Wi-Fi address if you want to show the simulation on another device.

## What the agent can observe

The simulator keeps the hidden obstacle layout, clues, and EVE's location in the environment config. WALL-E does not read those fields directly. The agent maintains its own map and learns from actions:

- Moving reveals the tile and nearby terrain. A blocked move costs energy and adds a wall to the map.
- Scanning costs more battery and returns a noisy **direction and strength**, not target coordinates.
- A clue is recorded only when a scan puts it within short-range sensor distance.
- EVE's exact location is reported only after the clue trail is complete and a close scan confirms visual contact.

The planner searches known safe paths with breadth-first search, chooses an unknown frontier using distance, recent signal bearing, and visit count, and scans again when a bearing gets stale. It estimates the cost of the route home and turns back before spending its return reserve. At base, it can recharge within the mission's recharge budget.

## Try the controls

- **Start mission** runs the decision loop. Press it again to pause or resume.
- **Step +1** advances one decision for a slower walkthrough.
- **Reset** clears the map, trace, and agent belief.
- **Mission file** loads one of the sample JSON configurations.
- **Load JSON** imports a mission file from your computer.
- **Export trace** downloads the decisions and observations as JSON.
- **Download report** saves the final evidence, location estimate, confidence, resource use, next step, and full trace.

The map uses fog of war: unknown tiles, walls, and undiscovered clue locations remain hidden until the environment returns evidence. The belief radar shows a relative bearing and confidence rather than exposing the hidden target coordinate.

## Mission config format

Mission files are JSON. `start`, `eve`, clue coordinates, and `blocked` coordinates describe the simulator's ground truth. The agent only receives the initial signal and the observations returned by its actions.

```json
{
  "name": "Quiet Garden",
  "seed": 27,
  "width": 12,
  "height": 8,
  "start": { "x": 1, "y": 6 },
  "eve": { "x": 10, "y": 1 },
  "clues": [{ "id": "compass", "x": 4, "y": 6, "label": "Rusted compass" }],
  "blocked": [[3, 5], [3, 6]],
  "resources": {
    "battery": 100,
    "timeLimit": 180,
    "moveCost": 1,
    "blockedCost": 1,
    "scanCost": 2,
    "rechargeAmount": 55,
    "maxRecharges": 1,
    "returnReserve": 14
  },
  "initialSignal": { "direction": 24, "strength": 0.18, "timestamp": 0 },
  "signalNoise": 0.12
}
```

The app validates map size, coordinates, and required fields before starting a mission. `signalNoise` ranges from 0 (clean) to 0.6 (very noisy).

## Included examples

- `public/missions/garden.json` — sample mission used in the walkthrough
- `public/missions/scrapyard.json` — alternate obstacle layout and signal noise
- `public/missions/blue-hour.json` — shorter battery budget
- `public/samples/sample-mission-report.json` — illustrative action trace and report shape

## Project layout

- `server.js` — dependency-free static file server for local demos
- `public/index.html` — mission control dashboard
- `public/style.css` — responsive dashboard and map styles
- `public/app.js` — hidden-world simulation, planner, belief updates, trace, and report export
- `public/missions/` — JSON mission configurations
- `public/samples/` — example trace and report

This is a deterministic, classical planner simulation, not a live Disney/Pixar character service or an LLM agent. The original TiltPlay prototype remains in the earlier Git history.

