# ReflexRun 3D

ReflexRun 3D is a first-person workout arcade game: your play space becomes an endless temple run, and your body becomes the controller. Jump over spikes, duck beneath blades, dodge stone pillars, and punch golems while a magma beast pursues you. Stay alive, build your score, and keep the chase at a distance.

Play with a webcam using body tracking, or switch to keyboard controls. The game is built with Three.js and MediaPipe Pose Landmarker, runs in the browser, and does not need a game server or account.

## What makes it stand out

- **A run that responds to your movement:** webcam controls translate jumps, crouches, side steps, and punches into game actions. A per-run calibration learns your neutral stance and checks the moves before play.
- **Two distinct ways to play:** Classic is an endless reflex run. Chaos keeps the same hazards and controls, then adds sudden blackouts, vigorous screen shakes, slips when you stop moving, and a Turbo boost when camera tracking detects you running in place.
- **A pursuer you can actually watch:** clean obstacle clears push the beast back; hits let it close in. A rear-view mirror keeps the chase visible while you run forward.
- **Arcade survival and scoring:** three lives, temporary shield pickups, combo multipliers, an escalating run speed, and saved high scores give each run clear stakes.
- **Play without extra hardware:** keyboard mode supports the full set of jump, duck, dodge, and punch actions. Body tracking is optional.
- **Runs locally in your browser:** pose processing happens on-device, and game settings and scores are saved in browser storage.

## Run locally

### Requirements

- Node.js **20.19+** or **22.12+** ([Vite 8 requirements](https://vite.dev/guide/#scaffolding-your-first-vite-project)). Node 18 is not supported.
- npm (included with Node.js).
- A modern desktop browser with WebGL support. Chrome or Edge is recommended.
- A webcam for body controls. A webcam is not needed for keyboard play.

Check that Node.js and npm are installed:

```sh
node --version
npm --version
```

### Start the development server

1. Clone the repository and enter the project folder:

   ```sh
   git clone https://github.com/Parima15-creator/GAME-REVOLUTION.git
   cd GAME-REVOLUTION
   ```

   If you downloaded the project as a ZIP, extract it and open a terminal in the folder containing `package.json`.

2. Install the locked dependencies:

   ```sh
   npm ci
   ```

3. Start Vite:

   ```sh
   npm run dev
   ```

4. Open the local URL printed by Vite, usually <http://localhost:5173/>.

Keep the terminal running while you play. Stop the server with `Ctrl+C`.

### Camera and first launch

Choose **Start Run** and allow camera access when your browser asks. Stand about 2–3 m from the camera, centred in the frame, with your hands near your chest. Follow the calibration steps. By default, camera runs ask you to practise jump, duck, dodge, and punch before starting; this auto-start behavior can be changed in Settings.

The first launch needs an internet connection to load the MediaPipe runtime and pose model. Pose processing happens in your browser. The camera works on `localhost`; when hosted elsewhere, the site must use HTTPS for browser camera access.

To play without a webcam, choose **Keyboard Mode** in the setup screen.

## Controls

| Action | Body control | Keyboard |
| --- | --- | --- |
| Jump | Jump so your shoulders rise | `W`, `Space`, or `↑` |
| Duck | Crouch | `S` or `↓` |
| Dodge left / right | Step sideways | `A` / `D` or `←` / `→` |
| Punch | Extend a hand forward | `J` (left), `K` or `F` (right) |
| Pause / resume | — | `Esc` |
| Mute / unmute | — | `M` |
| Start from the home screen | — | `Enter` or `Space` |
| Restart after a run | — | `R` |

## Game modes

- **Classic Mode:** the standard endless run with hazards, three lives, scoring, combos, and shield pickups.
- **Chaos Mode:** includes the Classic gameplay, plus occasional blackouts and strong screen shakes. In camera mode, running in place activates Turbo; inactivity can trigger a slip.

## Build and preview a production version

Create an optimized production build in `dist/`:

```sh
npm run build
```

Serve that build locally to preview it:

```sh
npm run preview
```

Open the preview URL printed by Vite (usually <http://localhost:4173/>). `npm run preview` serves the build; it does not rebuild it. Run `npm run build` again after making changes.

For deployment, publish the contents of `dist/` to a static web host. Use an HTTPS URL if players need webcam controls. The MediaPipe runtime and model still need to be reachable from the browser on first load.

## Development scripts

| Command | Purpose |
| --- | --- |
| `npm install` | Install project dependencies |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Create the production build in `dist/` |
| `npm run preview` | Preview the last production build locally |

## Project structure

```text
index.html                 App screens and interface
src/
  main.js                  Application entry point
  style.css                Interface and game styles
  cv/
    PoseDetector.js        MediaPipe pose detection
    Calibrator.js          Calibration and motion classification
    PerformanceMonitor.js  Pose model performance tuning
  game/
    GameController.js      Game flow, controls, scoring, and run loop
    SceneManager.js        Three.js scene and cameras
    Environment.js         Temple environment
    ObstacleManager.js     Obstacles and collisions
    PickupManager.js       Shield and life pickups
    MonsterManager.js      Golem enemies
    ChaserManager.js       Chasing beast
    PlayerHands.js         First person gloves
  ui/
    UIManager.js           HUD, prompts, and dialogs
```

## Notes

- The project has no backend. High scores, settings, and coaching progress are saved in browser `localStorage`.
- There is no automated test script in `package.json` yet.
- See [LICENSE](LICENSE) for the license.
