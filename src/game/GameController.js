// ==========================================================================
// REFLEXRUN 3D - MAIN GAME CONTROLLER & WORKOUT ENGINE
// ==========================================================================

import { SceneManager } from './SceneManager.js';
import { Environment } from './Environment.js';
import { ObstacleManager } from './ObstacleManager.js';
import { PickupManager } from './PickupManager.js';
import { MonsterManager } from './MonsterManager.js';
import { PlayerHands } from './PlayerHands.js';
import { ChaserManager, CHASE } from './ChaserManager.js';
import { SoundManager } from '../audio/SoundManager.js';
import { Calibrator } from '../cv/Calibrator.js';
import { PoseDetector } from '../cv/PoseDetector.js';
import { PerformanceMonitor } from '../cv/PerformanceMonitor.js';
import { UIManager } from '../ui/UIManager.js';

export class GameController {
  constructor() {
    this.container = document.getElementById('game-container');

    // Subsystems
    this.sceneManager = new SceneManager(this.container);
    this.environment = new Environment(this.sceneManager.scene);
    this.obstacleManager = new ObstacleManager(this.sceneManager.scene);
    this.monsterManager = new MonsterManager(this.sceneManager.scene);
    this.pickupManager = new PickupManager(this.sceneManager.scene);
    this.playerHands = new PlayerHands(this.sceneManager.camera);
    this.chaser = new ChaserManager(this.sceneManager.scene);
    this.sound = new SoundManager();
    this.ui = new UIManager();

    this.poseDetector = new PoseDetector();
    this.calibrator = new Calibrator(this.poseDetector);
    this.performanceMonitor = new PerformanceMonitor(this.poseDetector);

    // Asynchronous Vision Pipeline State (Decoupled from 60 FPS 3D Render Loop)
    this._isInferringPose = false;
    this._latestPose = null;
    this._latestMotion = null;
    this._lastPoseVideo = null;
    this._lastPoseVideoTime = -1;
    this._lastPoseProcessedAt = 0;
    this._lastCVDelta = 1 / 30;

    // Player State
    this.playerZ = 0;
    this.runSpeed = 10.5; // m/s (~38 km/h)
    this.targetLaneX = 0; // -2.8 (Left), 0 (Center), 2.8 (Right)
    this.isJumping = false;
    this.isSquatting = false;

    // Keyboard Fallback State
    this.keys = {};
    this.keyboardJumpTimer = 0;
    this.keyboardSquatTimer = 0;

    // Workout Metrics State
    this.isRunning = false;
    this.isPaused = false;
    this.score = 0;
    this.distance = 0;
    this.lives = this.maxLives;
    this.maxLives = 3;
    this.shieldTimer = 0;
    this.invulnerabilityTimer = 0;
    this.combo = 0;
    this.comboMultiplier = 1;
    this.maxCombo = 1;
    this.comboTimer = 0;
    this.elapsedSeconds = 0;
    this.caloriesBurned = 0;
    this.estimatedBpm = 120;
    this.bestScore = this.loadBestScore();

    this.reps = {
      jumps: 0,
      squats: 0,
      punches: 0,
      steps: 0,
    };

    // Clock
    this.lastTime = performance.now();

    // Tutorial State
    this.tutorialStep = 0;
    this.tutorialTotalSteps = 6; // 0=intro, 1=jump, 2=squat, 3=step, 4=punch, 5=ready
    this.isTutorialActive = false;
    this.tutorialDetected = { jump: false, squat: false, step: false, punch: false };
    this.tutAdvanceTimeout = null;
    this.tutStep3StartLane = undefined;

    // ---- App / screen state ------------------------------------------------
    this.screen = 'boot'; // boot | home | calibration | countdown | playing | paused | over
    this.cameraReady = false;
    // True for runs started from "Play with keyboard": the pose pipeline and the
    // camera PIP are switched off for the whole run.
    this.keyboardOnly = false;
    this.pendingKeyboard = false;
    // Remembered for the whole session: "camera" or "keyboard". Restarting with
    // R / RUN AGAIN must not silently drag you back in front of the camera.
    this.controlMode = 'camera';
    this.cameraSuspended = false;
    this.cameraError = '';
    this.settings = this.loadSettings();
    this.coach = this.loadCoach();
    this.chaosMode = false;
    this.chaosEffect = null;
    this.chaosEffectTimer = 0;
    this.chaosNextEffectIn = 0;
    this.chaosSlipTimer = 0;
    this.chaosLastActionAt = 0;
    this.chaosTurboUntil = 0;
    this._lastRunPose = null;
    this._runFootSide = null;
    this._runFootSwitches = 0;
    this._lastRunFootSwitchAt = 0;
    // Spoken lines are opt-in: routine obstacle cues are silent by design.
    this.sound.voiceEnabled = this.settings.voice === true;

    // ---- Calibration wizard state -----------------------------------------
    this.calib = {
      framedFor: 0,        // ms spent correctly framed
      stableFor: 0,        // ms spent holding still
      armFor: 0,           // ms spent holding the guard in the readiness gate
      holdRef: null,       // reference pose for the stillness check
      baselineLocked: false,
      tested: { jump: false, squat: false, step: false, punch: false },
      moveTestArmed: false,
      moveArmFor: 0,
      previousMotion: null,
      hint: '',
    };
    this.calibAutoStart = false;
    this.calibFast = false;
    this._autoStartFiring = false;

    // ---- Chase pressure ----------------------------------------------------
    this.heartbeatTimer = 0;
    this.caughtPending = false;
    this.mirrorFrame = 0;

    this.initEventListeners();
    this.initHome();
    this.initCalibrationWizard();
    this.initSensitivityControls();
  }

  async init() {
    // Initialize pose detector (loads MediaPipe WASM + BlazePose model) and audio
    await this.poseDetector.init();
    this.initCamera();
    this.showHome();
  }

  initEventListeners() {
    // Unlock audio on the first user gesture and add a synthesized click to
    // every button, including controls inside the existing modals.
    document.addEventListener('pointerdown', (e) => {
      const button = e.target.closest('button');
      if (button && !button.disabled) this.sound.playUIClick();
      if (this.screen === 'home') {
        this.sound.ensureContext();
        this.sound.setMenuMode(true);
        this.sound.startMusic();
        this.syncHomeAudioButton();
      }
    }, true);

    // A non-click gesture is enough to unlock autoplay on browsers that
    // suspended the initial menu music attempt.
    const unlockMenuAudio = () => {
      if (this.screen !== 'home') return;
      this.sound.ensureContext();
      this.sound.setMenuMode(true);
      this.sound.startMusic();
      this.syncHomeAudioButton();
    };
    ['pointermove', 'touchstart'].forEach((eventName) => {
      window.addEventListener(eventName, unlockMenuAudio, { once: true, passive: true });
    });

    // Keyboard inputs for manual testing and hybrid play
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (this.screen === 'home') {
        const key = e.code === 'Space' ? 'Space' : e.code === 'Escape' ? 'Esc' : e.code.replace(/^Key/, '');
        document.querySelectorAll('.home-foot kbd').forEach((cap) => {
          if (cap.textContent.trim() === key) {
            cap.classList.add('key-active');
            setTimeout(() => cap.classList.remove('key-active'), 180);
          }
        });
        this.sound.ensureContext();
        this.sound.setMenuMode(true);
        this.sound.startMusic();
        this.syncHomeAudioButton();
      }

      // Pause toggle works in every state
      if (e.code === 'Escape') {
        this.togglePause();
        return;
      }

      // Tutorial practice prompts still respond on the menu screens
      if (this.isTutorialActive) {
        if (e.code === 'KeyW' || e.code === 'Space' || e.code === 'ArrowUp') this.processTutorialKeyboard('jump');
        else if (e.code === 'KeyS' || e.code === 'ArrowDown') this.processTutorialKeyboard('squat');
        else if (e.code === 'KeyA' || e.code === 'ArrowLeft' || e.code === 'KeyD' || e.code === 'ArrowRight') this.processTutorialKeyboard('step');
        else if (e.code === 'KeyJ' || e.code === 'KeyK' || e.code === 'KeyF') this.processTutorialKeyboard('punch');
      }

      // Gameplay actions only exist while a run is actually live — otherwise
      // menubar keypresses would inflate the workout rep counters.
      if (!this.isRunning || this.isPaused) return;

      if (e.code === 'KeyW' || e.code === 'Space' || e.code === 'ArrowUp') {
        this.triggerJump();
      } else if (e.code === 'KeyS' || e.code === 'ArrowDown') {
        this.triggerSquat();
      } else if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
        if (this.targetLaneX > -2.8) {
          this.targetLaneX = Math.max(-2.8, this.targetLaneX - 2.8);
          this.reps.steps++;
          this.ui.bumpRep('steps');
          this.noteChaosAction();
        }
      } else if (e.code === 'KeyD' || e.code === 'ArrowRight') {
        if (this.targetLaneX < 2.8) {
          this.targetLaneX = Math.min(2.8, this.targetLaneX + 2.8);
          this.reps.steps++;
          this.ui.bumpRep('steps');
          this.noteChaosAction();
        }
      } else if (e.code === 'KeyJ') {
        this.triggerPunch('left');
      } else if (e.code === 'KeyK' || e.code === 'KeyF') {
        this.triggerPunch('right');
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // UI Buttons
    document.getElementById('btn-audio')?.addEventListener('click', () => {
      this.toggleMute();
    });
    document.getElementById('home-audio')?.addEventListener('click', () => this.toggleMute());

    document.getElementById('btn-pause')?.addEventListener('click', () => {
      this.togglePause();
    });

    document.getElementById('btn-resume')?.addEventListener('click', () => {
      this.togglePause();
    });

    document.getElementById('btn-restart')?.addEventListener('click', () => {
      // Re-enter through the readiness gate so every run starts centred
      this.openCalibration({ autoStart: this.cameraReady && this.calibrator.isCalibrated });
    });

    document.getElementById('home-cam-card')?.addEventListener('click', () => this.onControlCardPressed());

    document.getElementById('btn-quit')?.addEventListener('click', () => {
      this.endRun();
    });

    document.getElementById('btn-pause-home')?.addEventListener('click', () => {
      // Quit mid-run still records the session, then returns home without the summary
      this.endRun({ quit: true });
    });

    document.getElementById('btn-summary-home')?.addEventListener('click', () => {
      this.showHome();
    });

    document.getElementById('btn-recalibrate')?.addEventListener('click', () => {
      this.returnToCalibration();
    });

    // Only shown during a keyboard run: end it and go set up body tracking.
    document.getElementById('btn-pause-camera')?.addEventListener('click', async () => {
      this.controlMode = 'camera';
      this.keyboardOnly = false;
      this.pendingKeyboard = false;
      this.ui.hideAllModals();
      this.isPaused = false;
      this.endRun({ quit: true });
      await this.resumeCameraFeed();
      this.openCalibration({ autoStart: this.cameraReady && this.calibrator.isCalibrated });
    });

    document.getElementById('btn-adjust-calib')?.addEventListener('click', () => {
      this.ui.showModal('calibration');
    });

    // PIP minimize, close, and HUD toggle buttons
    document.getElementById('btn-toggle-pip')?.addEventListener('click', () => {
      const pip = document.getElementById('webcam-pip');
      pip?.classList.toggle('minimized');
    });

    document.getElementById('btn-close-pip')?.addEventListener('click', () => {
      const pip = document.getElementById('webcam-pip');
      pip?.classList.add('hidden');
    });

    document.getElementById('btn-pip-hud')?.addEventListener('click', () => {
      const pip = document.getElementById('webcam-pip');
      if (!pip) return;
      pip.classList.toggle('hidden');
      // Re-opening the tracker mid-run switches the run back to body control
      if (!pip.classList.contains('hidden') && this.keyboardOnly) {
        this.keyboardOnly = false;
        pip.classList.remove('keyboard-mode');
      }
    });
  }

  // =====================================================================
  // HOME / CAMERA / CALIBRATION / SETTINGS FLOW
  // =====================================================================
  initHome() {
    document.getElementById('mode-toggle')?.addEventListener('click', () => {
      this.chaosMode = !this.chaosMode;
      const toggle = document.getElementById('mode-toggle');
      toggle?.setAttribute('aria-pressed', String(this.chaosMode));
      toggle?.classList.toggle('active', this.chaosMode);
      document.body.classList.toggle('chaos-mode', this.chaosMode);
      document.getElementById('chaos-mode-badge')?.classList.toggle('hidden', !this.chaosMode);
    });
    document.getElementById('btn-play')?.addEventListener('click', () => this.onPlayPressed());
    document.getElementById('btn-how-to')?.addEventListener('click', () => this.openTutorial());
    document.getElementById('btn-settings')?.addEventListener('click', () => this.openSettings());
    document.getElementById('btn-close-settings')?.addEventListener('click', () => this.closeSettings());
    document.getElementById('btn-settings-recal')?.addEventListener('click', () => {
      this.closeSettings();
      this.openCalibration();
    });

    document.querySelectorAll('.home-embers').forEach((emberField) => {
      if (emberField.childElementCount) return;
      for (let i = 0; i < 22; i++) {
        const ember = document.createElement('i');
        ember.style.setProperty('--x', `${(i * 47 + 13) % 100}%`);
        ember.style.setProperty('--size', `${2 + (i % 3)}px`);
        ember.style.setProperty('--duration', `${8 + (i % 7)}s`);
        ember.style.setProperty('--delay', `${-(i % 13)}s`);
        ember.style.setProperty('--drift', `${(i % 2 ? 1 : -1) * (18 + (i % 45))}px`);
        ember.style.setProperty('--alpha', `${0.25 + (i % 5) * 0.1}`);
        emberField.appendChild(ember);
      }
    });

    // Keyboard shortcuts on the home screen
    window.addEventListener('keydown', (e) => {
      if (this.screen === 'home' && (e.code === 'Enter' || e.code === 'Space')) {
        e.preventDefault();
        this.onPlayPressed();
      }
      if (e.code === 'KeyM') this.toggleMute();
      if (e.code === 'KeyR' && (this.screen === 'over' || this.screen === 'playing')) {
        // Always route through the readiness gate so a restart re-locks the stance
        this.onPlayPressed();
      }
    });
  }

  loadSettings() {
    const defaults = { rearMirror: true, voice: false, prompts: 'adaptive', autoStart: true };
    try {
      const raw = JSON.parse(localStorage.getItem('reflexrun_game_settings') || '{}');
      return { ...defaults, ...raw };
    } catch (e) {
      return defaults;
    }
  }

  saveSettings() {
    try {
      localStorage.setItem('reflexrun_game_settings', JSON.stringify(this.settings));
    } catch (e) {
      // ignore private-mode storage failures
    }
  }

  // ---- Coach: cue each move only until the player has learned it ---------
  loadCoach() {
    const blank = () => ({ clears: 0, misses: 0, learned: false });
    const base = { jump: blank(), slide: blank(), step: blank(), punch: blank() };
    try {
      const raw = JSON.parse(localStorage.getItem('reflexrun_coach') || 'null');
      if (raw) {
        for (const key of Object.keys(base)) {
          if (raw[key]) {
            base[key] = {
              clears: Number(raw[key].clears) || 0,
              misses: Number(raw[key].misses) || 0,
              learned: Boolean(raw[key].learned),
            };
          }
        }
      }
    } catch (e) { /* ignore */ }
    return base;
  }

  saveCoach() {
    try {
      localStorage.setItem('reflexrun_coach', JSON.stringify(this.coach));
    } catch (e) { /* ignore */ }
  }

  /** Should this move still be cued? Adaptive mode drops a move once learned. */
  cueEnabled(kind) {
    const mode = this.settings.prompts || 'adaptive';
    if (mode === 'off') return false;
    if (mode === 'always') return true;
    const entry = this.coach[kind];
    return !entry || !entry.learned;
  }

  /** Three clean clears in a row and the move stops being announced. */
  noteClear(kind) {
    const entry = this.coach[kind];
    if (!entry) return;
    entry.clears += 1;
    if (!entry.learned && entry.clears >= 3) {
      entry.learned = true;
      this.saveCoach();
    }
  }

  /** A miss resets that move's cue so the reminder comes back. */
  noteMiss(kind) {
    const entry = this.coach[kind];
    if (!entry) return;
    entry.misses += 1;
    entry.clears = 0;
    if (entry.learned) {
      entry.learned = false;
      this.saveCoach();
    }
  }

  obstacleKind(type) {
    return type === 'JUMP' ? 'jump' : type === 'SLIDE' ? 'slide' : 'step';
  }

  applySettings() {
    this.sceneManager.mirrorEnabled = this.settings.rearMirror !== false;
    // Spoken lines are opt-in: routine obstacle cues are silent by design.
    this.sound.voiceEnabled = this.settings.voice === true;
    const mirror = document.getElementById('rear-panel');
    if (mirror) mirror.classList.toggle('mirror-off', this.settings.rearMirror === false);

    // Turning the mirror back on needs its canvas (re)created and sized
    if (this.settings.rearMirror !== false) {
      const slot = document.getElementById('rear-mirror');
      if (slot && slot.clientWidth > 8) this.sceneManager.initRearMirror(slot);
    }
  }

  resetTempleBackdrop() {
    this.playerZ = 0;
    this.runSpeed = 10.5;
    this.targetLaneX = 0;
    this.isJumping = false;
    this.isSquatting = false;
    this.obstacleManager.reset();
    this.monsterManager.reset();
    this.pickupManager.reset();
    this.lives = this.maxLives;
    this.shieldTimer = 0;
    this.invulnerabilityTimer = 0;
    this.playerHands.resetPunches();
    this.chaser.reset();
    this.environment.reset();
    this.sceneManager.resetToMenu();
    this.sceneManager.render();
  }

  showHome() {
    this.resetChaos();
    this.screen = 'home';
    this.isRunning = false;
    this.isPaused = false;
    this.isTutorialActive = false;
    this.sound.stopMusic();
    this.sound.setMenuMode(true);
    this.sound.startMusic();
    this.syncHomeAudioButton();
    this.ui.hideAllModals();
    this.ui.hideActionPrompt();
    this.ui.showHud(false);
    document.getElementById('webcam-pip')?.classList.add('hidden');
    document.getElementById('webcam-pip')?.classList.remove('keyboard-mode');
    document.getElementById('kb-badge')?.classList.add('hidden');
    this.keyboardOnly = false;
    this.pendingKeyboard = false;
    document.getElementById('home-screen')?.classList.remove('hidden');
    document.getElementById('run-countdown')?.classList.add('hidden');
    document.getElementById('caught-overlay')?.classList.add('hidden');
    this.ui.updateSpeedVfx(0);
    this.ui.updateChaseVfx(0);

    // Return the corridor and camera to the same pose shown on the title screen.
    this.resetTempleBackdrop();

    this.refreshHomeStats();
    this.applySettings();
  }

  refreshHomeStats() {
    const best = Math.max(this.bestScore, Number(localStorage.getItem('reflexrun_best_score')) || 0);
    const bestEl = document.getElementById('home-best');
    if (bestEl) bestEl.textContent = best.toLocaleString('en-US');

    const lastEl = document.getElementById('home-last');
    if (lastEl) {
      try {
        const last = JSON.parse(localStorage.getItem('reflexrun_last_run') || 'null');
        lastEl.textContent = last ? `${Math.round(last.score).toLocaleString('en-US')} · ${Math.round(last.distance)}m` : '—';
      } catch (e) {
        lastEl.textContent = '—';
      }
    }

    const camEl = document.getElementById('home-cam');
    const modeLabel = document.getElementById('home-mode-label');
    const modeCard = document.getElementById('home-cam-card');
    if (modeLabel) modeLabel.textContent = this.controlMode === 'keyboard' ? 'KEYBOARD MODE · TAP TO SWITCH' : 'CAMERA BODY TRACKING · TAP TO SWITCH';
    if (modeCard) modeCard.setAttribute('aria-pressed', String(this.controlMode === 'keyboard'));
    if (camEl) {
      if (this.controlMode === 'keyboard') {
        camEl.textContent = 'KEYBOARD MODE';
      } else {
        camEl.textContent = this.cameraReady ? 'READY' : (this.cameraError ? 'KEYBOARD' : 'CHECKING…');
      }
      camEl.classList.toggle('off', this.controlMode === 'keyboard' || !this.cameraReady);
    }

    const playBtn = document.getElementById('btn-play');
    if (playBtn) {
      const label = this.controlMode === 'keyboard' ? 'START RUN · KEYBOARD' : 'START RUN';
      const span = playBtn.querySelector('.btn-hero-label');
      if (span) span.textContent = label;
    }
  }

  // The body-tracking card on the home screen doubles as a mode switch.
  onControlCardPressed() {
    if (this.controlMode === 'keyboard') {
      this.controlMode = 'camera';
      this.refreshHomeStats();
    } else {
      this.controlMode = 'keyboard';
      this.pendingKeyboard = true;
      this.refreshHomeStats();
    }
  }

  onPlayPressed() {
    if (this.screen === 'calibration' || this.screen === 'countdown') return;

    // Stay in whichever control mode the player last chose. A keyboard run never
    // touches the camera, and never pops the setup wizard.
    if (this.controlMode === 'keyboard') {
      this.startCountdown({ force: true, keyboard: true });
      return;
    }

    // Camera runs go through the readiness gate: it checks that you are centred
    // with your guard up, then starts by itself. No extra clicking.
    this.openCalibration({ autoStart: this.cameraReady && this.calibrator.isCalibrated });
  }

  // ---- Camera feed lifecycle ---------------------------------------------
  // A keyboard run must release the camera, not just ignore its frames: an open
  // MediaStream keeps the camera LED on, which looks exactly like the game is
  // still watching you.
  releaseCameraFeed() {
    const stream = this.calibrator?.stream;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try { track.stop(); } catch (e) { /* already stopped */ }
      });
    }
    this.calibrator.stream = null;
    this.cameraSuspended = true;
    ['webcam-video', 'calib-video', 'tut-video'].forEach((id) => {
      const video = document.getElementById(id);
      if (video) video.srcObject = null;
    });
    this._latestPose = null;
    this._latestMotion = null;
    this._isInferringPose = false;
  }

  async resumeCameraFeed() {
    if (!this.cameraSuspended) return this.cameraReady;
    this.cameraSuspended = false;
    await this.initCamera();
    return this.cameraReady;
  }

  openSettings() {
    this.sound.ensureContext();
    this.syncSensitivityUI();
    const select = document.getElementById('select-prompts');
    if (select) select.value = this.settings.prompts || 'adaptive';
    this.ui.showModal('settings');
  }

  closeSettings() {
    this.ui.showModal(this.screen === 'home' ? 'none' : this.screen === 'paused' ? 'pause' : 'none');
    if (this.screen === 'home') document.getElementById('home-screen')?.classList.remove('hidden');
  }

  // ---- Camera ------------------------------------------------------------
  async initCamera() {
    const video = document.getElementById('calib-video');
    const success = await this.calibrator.setupCamera(video);
    this.cameraReady = Boolean(success);
    this.cameraError = success ? '' : (this.calibrator.cameraError || 'Camera unavailable');

    const pip = document.getElementById('webcam-pip');
    const pipVideo = document.getElementById('webcam-video');
    const tutVideo = document.getElementById('tut-video');

    if (success) {
      pip?.classList.remove('no-camera');
      if (pipVideo) {
        pipVideo.srcObject = this.calibrator.stream;
        pipVideo.play().catch(() => {});
      }
      if (tutVideo) {
        tutVideo.srcObject = this.calibrator.stream;
        tutVideo.play().catch(() => {});
      }
      // Camera permission may resolve after the wizard has opened. In that
      // case the no-camera fallback must not leave step 2 permanently skipped.
      if (this.screen === 'calibration') {
        this.calibAutoStart = this.settings.autoStart !== false;
        this.calibFast = Boolean(this.calibrator.isCalibrated);
        this.calib.baselineLocked = false;
        this.calib.framedFor = 0;
        this.calib.stableFor = 0;
        this.calib.holdRef = null;
        this.calib.tested = { jump: false, squat: false, step: false, punch: false };
        this.calib.moveTestArmed = false;
        this.calib.moveArmFor = 0;
        this.calib.previousMotion = null;
        this.calibrator.hasGuardBaseline = false;
        this.calibrator.resetMotionState();
        this.setStepState(1, 'active', 'WAIT');
        this.setStepState(2, 'active', 'HOLD');
        this.syncCalibrationUI();
        this.setCalibrationHint(1, 'Camera live — step into frame.');
        this.setCalibrationHint(2, 'Face the camera with both hands near your chest, then hold still.');
      }
    } else {
      pip?.classList.add('no-camera');
      this.ui.updatePipTag('KEYBOARD');
    }

    this.refreshHomeStats();
    this.setCalibrationHint(
      1,
      success
        ? 'Camera live — step into frame.'
        : `${this.cameraError} You can play on the keyboard instead.`
    );
    document.getElementById('btn-cal-retry')?.classList.toggle('hidden', this.cameraReady);
    if (!success && this.screen === 'calibration') {
      this.setStepState(1, 'wait', 'NO CAMERA');
      this.setStepState(2, 'wait', 'SKIP');
      this.setCalibrationHint(3, 'Camera is off: use W/Space, S, A/D and J/K to check moves, or choose KEYBOARD MODE.');
    }

    // Without a camera the wizard cannot validate, so never block the start button
    const startBtn = document.getElementById('btn-cal-start');
    if (startBtn && !this.cameraReady) startBtn.disabled = false;
    return success;
  }

  retryCamera() {
    document.getElementById('btn-cal-retry')?.classList.add('hidden');
    this.setCalibrationHint(1, 'Allow camera access, then step into the frame.');
    this.initCamera().then((ok) => {
      if (ok) this.sound.playComboChime(2);
    });
  }

  // ---- Calibration wizard ----------------------------------------------
  initCalibrationWizard() {
    document.getElementById('btn-cal-retry')?.addEventListener('click', () => this.retryCamera());
    document.getElementById('btn-cal-start')?.addEventListener('click', () => {
      this.controlMode = 'camera';
      this.startCountdown();
    });
    document.getElementById('btn-cal-keyboard')?.addEventListener('click', () => {
      // Never disable the camera permanently — this only skips the gate for
      // this run, so the next start can still use body tracking.
      this.controlMode = 'keyboard';
      this.startCountdown({ force: true, keyboard: true });
    });
    document.getElementById('btn-cal-cancel')?.addEventListener('click', () => this.showHome());
    document.getElementById('btn-open-tutorial')?.addEventListener('click', () => this.openTutorial());

    // Keyboard can complete the move test even without a camera
    window.addEventListener('keydown', (e) => {
      if (this.screen !== 'calibration') return;
      const map = { KeyW: 'jump', Space: 'jump', ArrowUp: 'jump', KeyS: 'squat', ArrowDown: 'squat', KeyA: 'step', KeyD: 'step', KeyJ: 'punch', KeyK: 'punch', KeyF: 'punch' };
      const move = map[e.code];
      if (move) this.markMoveTested(move);
    });

    // Auto-advance the wizard if the browser cannot use a camera at all
    setTimeout(() => {
      if (!this.cameraReady && this.screen === 'home') this.refreshHomeStats();
    }, 4000);
  }

  openCalibration({ autoStart = false } = {}) {
    // The setup wizard needs a live preview; wake the camera if a keyboard run
    // released it.
    if (this.cameraSuspended) this.resumeCameraFeed();
    this.screen = 'calibration';
    this.isRunning = false;
    this.isPaused = false;
    this.sound.stopMusic();
    this.ui.hideAllModals();
    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('webcam-pip')?.classList.add('hidden');
    this.ui.showHud(false);
    this.ui.showModal('calibration');

    // Reset the wizard each time it is opened
    this.calib.framedFor = 0;
    this.calib.stableFor = 0;
    this.calib.armFor = 0;
    this.calib.holdRef = null;
    this.calib.tested = { jump: false, squat: false, step: false, punch: false };
    this.calib.moveTestArmed = false;
    this.calib.moveArmFor = 0;
    this.calib.previousMotion = null;
    this.calibrator.resetMotionState();
    // Auto-start is a mode, not a first-run bonus: every camera run ends with the
    // move set, and the run starts when it is complete.
    this.calibAutoStart = Boolean(this.cameraReady && this.settings.autoStart !== false);
    // Returning player: shorter, but still a fresh lock — a baseline left over
    // from an earlier run is exactly what makes the controls feel wrong.
    this.calibFast = Boolean(this.cameraReady && this.calibrator.isCalibrated);
    // A missing camera skips calibration but must not masquerade as a locked
    // baseline if camera access becomes available moments later.
    this.calib.baselineLocked = false;
    this._autoStartFiring = false;
    this.setStepState(1, 'active', 'WAIT');
    this.setStepState(2, this.cameraReady ? (this.calib.baselineLocked ? 'ok' : 'active') : 'wait', this.cameraReady ? (this.calib.baselineLocked ? 'LOCKED' : 'HOLD') : 'SKIP');

    const progress = document.getElementById('cal-progress');
    if (progress) progress.style.width = '0%';

    this.syncCalibrationUI();
    if (!this.cameraReady && this.screen === 'calibration') {
      const remaining = this.requiredMoves().filter((name) => !this.calib.tested[name]);
      this.setCalibrationHint(3, remaining.length
        ? `Keyboard check: ${remaining.map((name) => this.moveLabel(name)).join(', ')} remaining.`
        : 'All moves checked - start your run when ready.');
    }

    if (!this.cameraReady) this.retryCamera();
    const hint = this.calibAutoStart
      ? 'Stand centred with your guard up. Then do four moves and the run starts.'
      : (this.cameraReady ? 'Camera live — step into frame.' : 'Enable your camera, or play on the keyboard.');
    this.setCalibrationHint(1, hint);
    this.setCalibrationHint(
      2,
      this.calibAutoStart
        ? 'Same guard stance as before: hands at your chest, body straight.'
        : 'Hands at your chest, body straight.'
    );

    const startBtn = document.getElementById('btn-cal-start');
    if (startBtn) startBtn.disabled = !(this.calib.baselineLocked || !this.cameraReady);
  }

  closeCalibration() {
    document.getElementById('calibration-modal')?.classList.add('hidden');
  }

  /**
   * True while the tracked body has barely moved since the hold started.
   * Stops a jump, wave or walk-around being captured as the neutral stance.
   */
  checkStanceStillness(pose) {
    const y = pose.midShoulderY ?? 0.5;
    const t = pose.torsoHeight || 0.3;
    // Hands count as movement too: raising them into position is a wave, raising
    // them mid-lock is a moving target.
    const lw = pose.leftWristY ?? 0;
    const rw = pose.rightWristY ?? 0;
    if (!this.calib.holdRef) {
      this.calib.holdRef = { y, t, lw, rw };
      return true;
    }
    const prev = this.calib.holdRef;
    const drift =
      Math.abs(y - prev.y) +
      Math.abs(t - prev.t) * 1.5 +
      Math.abs(lw - prev.lw) * 0.8 +
      Math.abs(rw - prev.rw) * 0.8;
    if (drift > 0.05) {
      // Big move: re-anchor and make them settle again
      this.calib.holdRef = { y, t, lw, rw };
      return false;
    }
    // Follow a slow natural settle so the reference never goes stale
    this.calib.holdRef.y = prev.y * 0.92 + y * 0.08;
    this.calib.holdRef.t = prev.t * 0.92 + t * 0.08;
    this.calib.holdRef.lw = prev.lw * 0.92 + lw * 0.08;
    this.calib.holdRef.rw = prev.rw * 0.92 + rw * 0.08;
    return true;
  }

  /** Human-readable reason the guard stance is not being held yet. */
  guardHint(guard) {
    switch (guard.reason) {
      case 'low':
        return 'Hands are too low — bring them up to your chest.';
      case 'high':
        return 'Lower your hands to chest height.';
      case 'wide':
        return 'Bring your hands in front of your chest, not out to the sides.';
      case 'hidden':
        return 'Keep both hands inside the frame and clearly visible.';
      case 'nobody':
        return 'No body detected — step back into shot.';
      default:
        return 'Raise both hands to your chest to lock the stance.';
    }
  }

  /** Called from renderCameraOverlays with live framing telemetry. */
  updateCalibrationFromPose(pose) {
    if (this.screen !== 'calibration' || !pose) return;
    const dt = this._lastCVDelta || 1 / 30;

    const centered = Math.abs((pose.midShoulderX ?? 0.5) - 0.5) < 0.2;
    const goodDistance = (pose.torsoHeight || 0) > 0.16 && (pose.torsoHeight || 0) < 0.62;
    const confident = (pose.confidence || 0) > 0.25;
    const framed = centered && goodDistance && confident;

    // --- Step 1: framing ---
    if (framed) {
      this.calib.framedFor += dt * 1000;
    } else {
      this.calib.framedFor = Math.max(0, this.calib.framedFor - dt * 900);
    }
    const frameNeed = this.calibFast ? 600 : 900;
    const framePct = Math.min(1, this.calib.framedFor / frameNeed);
    this.setStepState(1, framePct >= 1 ? 'ok' : 'wait', framePct >= 1 ? 'LOCKED' : 'WAIT');

    let frameHint = 'Step into frame.';
    if (!confident) frameHint = 'No body detected — step back into shot.';
    else if (!centered) frameHint = 'Centre yourself in the box.';
    else if (!goodDistance) frameHint = (pose.torsoHeight || 0) <= 0.16 ? 'Move closer to the camera.' : 'Step further back.';
    else frameHint = 'Framing is perfect — hold still.';
    this.setCalibrationHint(1, frameHint);
    document.getElementById('silhouette-guide')?.classList.toggle('aligned', framed);

    // --- Step 2: baseline hold ---
    // The baseline is only captured while the body is actually still, so a
    // mid-jump or mid-wave frame can never become "neutral".
    const still = this.checkStanceStillness(pose);
    // Hands up near the chest, or nothing is learned. This is the check that was
    // missing: a still body with arms hanging used to be accepted as "neutral".
    const guard = this.calibrator.guardStance(pose);
    this._lastGuard = guard;
    if (framed && framePct >= 1 && !this.calib.baselineLocked) {
      const stableNeed = this.calibFast ? 900 : 1400;
      if (guard.ready && still) {
        this.calib.stableFor += dt * 1000;
      } else {
        this.calib.stableFor = Math.max(0, this.calib.stableFor - dt * 1400);
      }
      const stablePct = Math.min(1, this.calib.stableFor / stableNeed);
      const fill = document.getElementById('cal-progress');
      if (fill) fill.style.width = `${stablePct * 100}%`;
      this.setCalibrationHint(
        2,
        guard.ready
          ? (still ? 'Perfect — hold that guard stance.' : 'Hold still — relax into your guard stance.')
          : this.guardHint(guard)
      );
      this.setStepState(2, 'active', guard.ready ? 'HOLD' : (guard.reason === 'low' ? 'HANDS UP' : 'WAIT'));
      if (stablePct >= 1 && guard.ready) {
        this.calibrator.lockBaselineFromPose(pose);
        this.calib.baselineLocked = true;
        this.calib.guardLocked = true;
        this.setStepState(2, 'ok', 'LOCKED');
        this.sound.playComboChime(3);
      }
    } else if (!this.calib.baselineLocked) {
      this.calib.stableFor = Math.max(0, this.calib.stableFor - dt * 600);
      this.calib.holdRef = null;
      const fill = document.getElementById('cal-progress');
      const stableNeed = this.calibFast ? 900 : 1400;
      if (fill) fill.style.width = `${Math.min(1, this.calib.stableFor / stableNeed) * 100}%`;
    }

    if (this.calib.baselineLocked && this.calibrator.hasGuardBaseline) {
      this.setStepState(2, 'ok', 'LOCKED');
      if (!this.calibAutoStart) {
        const fill = document.getElementById('cal-progress');
        if (fill) fill.style.width = '100%';
      }
    }
    // (the not-locked state is written above, with the real guard reason)

    // --- Step 3 / auto-start: do your four moves, the run starts by itself ---
    this.updateMoveSequence(guard);

    // --- Start button availability ---
    const startBtn = document.getElementById('btn-cal-start');
    if (startBtn) startBtn.disabled = !(this.calib.baselineLocked || !this.cameraReady);
  }

  /** Every camera run, these moves double as the "start the run" gesture set. */
  requiredMoves() {
    return ['jump', 'squat', 'step', 'punch'];
  }

  moveLabel(move) {
    return { jump: 'JUMP', squat: 'DUCK', step: 'DODGE', punch: 'PUNCH' }[move] || move;
  }

  /**
   * Auto-start: once the guard stance is locked, the run begins by itself as
   * soon as the player has performed the four moves. Order does not matter and
   * START RUN is still there to skip it.
   */
  updateMoveSequence(guard) {
    const autoStartOn = this.settings.autoStart !== false;

    if (!this.calibAutoStart || !this.calib.baselineLocked || !this.calibrator.hasGuardBaseline) return;

    if (!this.calib.moveTestArmed) {
      this.setStepState(3, 'active', 'WAIT');
      this.setCalibrationHint(3, guard.ready
        ? 'Hold your guard steady to arm move tracking.'
        : 'Bring both hands back to chest height.');
      return;
    }

    const required = this.requiredMoves();
    const done = required.filter((m) => this.calib.tested[m]);
    const missing = required.filter((m) => !this.calib.tested[m]);
    const complete = missing.length === 0;

    // The move test is the point of the gate, so it is always promoted to the
    // active step once the stance is locked.
    this.setStepState(3, complete ? 'ok' : 'active', complete ? 'READY' : `${done.length} / ${required.length}`);

    if (complete) {
      this.setCalibrationHint(3, 'All four moves tracked — starting now…');
      if (autoStartOn && !this._autoStartFiring) {
        this._autoStartFiring = true;
        this.calib.armFor = 1;
        this.sound.playComboChime(3);
        this.startCountdown();
      }
      return;
    }

    // Tell the player exactly which move is still missing, whether the run will
    // start by itself, and to keep the guard up.
    const next = missing[0];
    const tail = autoStartOn ? 'run starts automatically' : 'press START RUN when done';
    this.setCalibrationHint(
      3,
      guard.ready
        ? `Next: ${this.moveLabel(next)} · ${tail}`
        : `Hands back up to your chest · ${tail}`
    );
  }

  /** Called with classified motion while the wizard is open. */
  updateCalibrationFromMotion(motion) {
    if (this.screen !== 'calibration' || !motion) return;
    if (!this.calib.baselineLocked || !this.calibrator.hasGuardBaseline) {
      this.calib.moveArmFor = 0;
      this.calib.moveTestArmed = false;
      this.calib.previousMotion = null;
      this.updateMoveSequence(this._lastGuard || { ready: false, reason: '' });
      return;
    }

    const neutral = Boolean(
      this._lastGuard?.ready && !motion.isJumping && !motion.isSquatting &&
      Math.abs(motion.laneX || 0) < 1.4 && !motion.punchTriggered
    );
    if (!this.calib.moveTestArmed) {
      this.calib.moveArmFor = neutral
        ? this.calib.moveArmFor + (this._lastCVDelta || 1 / 30) * 1000
        : 0;
      if (this.calib.moveArmFor >= 450) {
        this.calib.moveTestArmed = true;
        this.calib.previousMotion = { ...motion };
      }
      this.updateMoveSequence(this._lastGuard || { ready: false, reason: '' });
      return;
    }

    const previous = this.calib.previousMotion || {};
    const pose = motion.pose;
    const previousPose = previous.pose;
    const torso = Math.max(0.16, pose?.torsoHeight || this.calibrator.torsoHeight || 0.3);
    const verticalDelta = pose ? pose.midShoulderY - this.calibrator.baselineY : 0;
    const ankleY = pose ? ((pose.leftAnkleY ?? this.calibrator.baselineAnkleY) + (pose.rightAnkleY ?? this.calibrator.baselineAnkleY)) / 2 : this.calibrator.baselineAnkleY;
    const ankleRise = this.calibrator.baselineAnkleY - ankleY;
    const kneeJump = Boolean(pose?.hasLegTracking && pose.avgKneeAngle > 150 && ankleRise > torso * 0.045);
    const jumpSignal = Boolean(motion.isJumping || verticalDelta < -torso * 0.075 || kneeJump);
    const squatSignal = Boolean(motion.isSquatting || verticalDelta > torso * 0.085 || (pose?.hasLegTracking && pose.avgKneeAngle < 148));
    if (jumpSignal && !previous._calJump) this.markMoveTested('jump');
    if (squatSignal && !previous._calSquat) this.markMoveTested('squat');
    if ((motion.laneChanged && !previous.laneChanged) ||
        (Math.abs(motion.laneX || 0) >= 1.4 && Math.abs(previous.laneX || 0) < 1.4)) this.markMoveTested('step');
    const reachExtended = (side) => {
      if (!pose || !previousPose) return false;
      const reach = this.calibrator.reachRatio(pose, side);
      const baselineReach = side === 'left' ? this.calibrator.baselineReachLeft : this.calibrator.baselineReachRight;
      return reach > Math.max(0.7, baselineReach + 0.1) &&
        reach - this.calibrator.reachRatio(previousPose, side) > 0.075;
    };
    const punchSignal = Boolean(motion.punchTriggered || reachExtended('left') || reachExtended('right'));
    if (punchSignal && !previous._calPunch) this.markMoveTested('punch');
    this.calib.previousMotion = {
      ...motion,
      _calJump: jumpSignal,
      _calSquat: squatSignal,
      _calPunch: punchSignal,
    };
    // Rotate the highlight to whatever is still missing (stage 4 of the wizard).
    this.updateMoveSequence(this._lastGuard || { ready: true, reason: '' });
  }

  markMoveTested(move) {
    if (!this.calib.tested[move]) {
      this.calib.tested[move] = true;
      this.sound.playComboChime(2);
    }
    const tile = document.getElementById(`cal-test-${move}`);
    if (tile) tile.classList.add('done');
    this.syncCalibrationUI();
    if (!this.cameraReady && this.screen === 'calibration') {
      const remaining = this.requiredMoves().filter((name) => !this.calib.tested[name]);
      this.setCalibrationHint(3, remaining.length
        ? `Keyboard check: ${remaining.map((name) => this.moveLabel(name)).join(', ')} remaining.`
        : 'All moves checked - start your run when ready.');
    }
  }

  syncCalibrationUI() {
    const required = this.requiredMoves();
    const count = required.filter((m) => this.calib.tested[m]).length;
    required.forEach((move) => {
      document.getElementById(`cal-test-${move}`)?.classList.toggle('done', Boolean(this.calib.tested[move]));
    });
    const label = document.getElementById('cal-state-3');
    if (label) label.textContent = `${count} / ${required.length}`;
    this.setStepState(3, count === required.length ? 'ok' : 'active', `${count} / ${required.length}`);
  }

  setStepState(step, state, label) {
    const card = document.getElementById(`cal-step-${step}`);
    if (card) {
      card.classList.toggle('active', state === 'active');
      card.classList.toggle('done', state === 'ok');
    }
    const stateEl = document.getElementById(`cal-state-${step}`);
    if (stateEl && label) stateEl.textContent = label;
  }

  setCalibrationHint(step, text) {
    const el = document.getElementById(`cal-hint-${step}`);
    if (el && text && el.textContent !== text) el.textContent = text;
    if (step === 1) {
      const status = document.getElementById('calib-status-text');
      if (status && text && status.textContent !== text) status.textContent = text;
    }
  }

  // ---- Countdown -> run ------------------------------------------------
  startCountdown({ force = false, keyboard = false } = {}) {
    this.pendingKeyboard = keyboard;
    if (!force && this.cameraReady && !this.calibrator.isCalibrated) {
      // No baseline yet: the wizard is still the right place to be
      this.openCalibration();
      return;
    }

    this.sound.ensureContext();
    clearTimeout(this._countdownTimer);
    clearInterval(this._countdownInterval);

    this.ui.hideAllModals();
    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('webcam-pip')?.classList.toggle('hidden', keyboard);
    this.ui.showHud(true);
    this.screen = 'countdown';
    this.isRunning = false;

    const box = document.getElementById('run-countdown');
    const num = document.getElementById('countdown-num');
    const sub = document.getElementById('countdown-sub');
    box?.classList.remove('hidden');

    let n = 3;
    const tick = () => {
      if (!num || !sub) return;
      if (n > 0) {
        num.textContent = String(n);
        sub.textContent = 'GET READY';
        num.classList.remove('pop');
        void num.offsetWidth;
        num.classList.add('pop');
        this.sound.playComboChime(1);
        n--;
      } else {
        num.textContent = 'GO';
        sub.textContent = 'RUN!';
        this.sound.playComboChime(4);
        clearInterval(this._countdownInterval);
        this._countdownTimer = setTimeout(() => {
          box?.classList.add('hidden');
          this.startRun();
        }, 520);
      }
    };
    tick();
    this._countdownInterval = setInterval(tick, 700);
  }

  initSensitivityControls() {
    this.syncSensitivityUI();

    const onJumpChange = (val) => {
      this.calibrator.setJumpSensitivity(parseFloat(val) / 100);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onSquatChange = (val) => {
      this.calibrator.setSquatSensitivity(parseFloat(val) / 100);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onStepChange = (val) => {
      this.calibrator.setStepSensitivity(parseFloat(val) / 100);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onPunchChange = (val) => {
      this.calibrator.setPunchSensitivity(parseFloat(val) / 100);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onInvertChange = (checked) => {
      this.calibrator.setInvertX(checked);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onRequireFistChange = (checked) => {
      this.calibrator.setRequireFist(checked);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onStepLockChange = (checked) => {
      this.calibrator.setSuppressPunchOnStep(checked);
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
    };

    const onReset = () => {
      this.calibrator.resetDefaults();
      this.syncSensitivityUI();
      this.redrawActiveCanvas();
      this.sound.playComboChime(1);
    };

    const onMirrorToggle = (checked) => {
      this.settings.rearMirror = Boolean(checked);
      this.saveSettings();
      this.applySettings();
    };

    const onVoiceToggle = (checked) => {
      this.settings.voice = Boolean(checked);
      this.sound.voiceEnabled = Boolean(checked);
      this.saveSettings();
    };

    // Calibration modal inputs
    document.getElementById('slider-jump')?.addEventListener('input', (e) => onJumpChange(e.target.value));
    document.getElementById('slider-squat')?.addEventListener('input', (e) => onSquatChange(e.target.value));
    document.getElementById('slider-step')?.addEventListener('input', (e) => onStepChange(e.target.value));
    document.getElementById('slider-punch')?.addEventListener('input', (e) => onPunchChange(e.target.value));
    document.getElementById('toggle-invert-x')?.addEventListener('change', (e) => onInvertChange(e.target.checked));
    document.getElementById('toggle-require-fist')?.addEventListener('change', (e) => onRequireFistChange(e.target.checked));
    document.getElementById('toggle-step-lock')?.addEventListener('change', (e) => onStepLockChange(e.target.checked));
    document.getElementById('btn-reset-sensitivity')?.addEventListener('click', onReset);
    document.getElementById('toggle-rear-mirror')?.addEventListener('change', (e) => onMirrorToggle(e.target.checked));
    document.getElementById('toggle-voice')?.addEventListener('change', (e) => onVoiceToggle(e.target.checked));
    document.getElementById('toggle-autostart')?.addEventListener('change', (e) => {
      this.settings.autoStart = e.target.checked;
      this.saveSettings();
    });
    document.getElementById('select-prompts')?.addEventListener('change', (e) => {
      this.settings.prompts = e.target.value;
      this.saveSettings();
      if (e.target.value === 'off') this.ui.hideActionPrompt();
    });

    // Tutorial modal inputs
    document.getElementById('tut-slider-jump')?.addEventListener('input', (e) => onJumpChange(e.target.value));
    document.getElementById('tut-slider-squat')?.addEventListener('input', (e) => onSquatChange(e.target.value));
    document.getElementById('tut-slider-step')?.addEventListener('input', (e) => onStepChange(e.target.value));
    document.getElementById('tut-slider-punch')?.addEventListener('input', (e) => onPunchChange(e.target.value));
    document.getElementById('tut-toggle-invert-x')?.addEventListener('change', (e) => onInvertChange(e.target.checked));
    document.getElementById('tut-toggle-require-fist')?.addEventListener('change', (e) => onRequireFistChange(e.target.checked));
    document.getElementById('tut-toggle-step-lock')?.addEventListener('change', (e) => onStepLockChange(e.target.checked));
    document.getElementById('btn-tut-reset-sensitivity')?.addEventListener('click', onReset);
  }

  syncSensitivityUI() {
    const jumpVal = Math.round(this.calibrator.jumpSensitivity * 100);
    const squatVal = Math.round(this.calibrator.squatSensitivity * 100);
    const stepVal = Math.round(this.calibrator.stepSensitivity * 100);
    const punchVal = Math.round(this.calibrator.punchSensitivity * 100);
    const invertVal = this.calibrator.invertX;
    const requireFistVal = this.calibrator.requireFist;
    const stepLockVal = this.calibrator.suppressPunchOnStep;

    // Sliders
    const sJump = document.getElementById('slider-jump');
    const sSquat = document.getElementById('slider-squat');
    const sStep = document.getElementById('slider-step');
    const sPunch = document.getElementById('slider-punch');
    const tInvert = document.getElementById('toggle-invert-x');
    const tFist = document.getElementById('toggle-require-fist');
    const tStepLock = document.getElementById('toggle-step-lock');

    const tutSJump = document.getElementById('tut-slider-jump');
    const tutSSquat = document.getElementById('tut-slider-squat');
    const tutSStep = document.getElementById('tut-slider-step');
    const tutSPunch = document.getElementById('tut-slider-punch');
    const tutTInvert = document.getElementById('tut-toggle-invert-x');
    const tutTFist = document.getElementById('tut-toggle-require-fist');
    const tutTStepLock = document.getElementById('tut-toggle-step-lock');

    if (sJump) sJump.value = jumpVal;
    if (sSquat) sSquat.value = squatVal;
    if (sStep) sStep.value = stepVal;
    if (sPunch) sPunch.value = punchVal;
    if (tInvert) tInvert.checked = invertVal;
    if (tFist) tFist.checked = requireFistVal;
    if (tStepLock) tStepLock.checked = stepLockVal;

    if (tutSJump) tutSJump.value = jumpVal;
    if (tutSSquat) tutSSquat.value = squatVal;
    if (tutSStep) tutSStep.value = stepVal;
    if (tutSPunch) tutSPunch.value = punchVal;
    if (tutTInvert) tutTInvert.checked = invertVal;
    if (tutTFist) tutTFist.checked = requireFistVal;
    if (tutTStepLock) tutTStepLock.checked = stepLockVal;

    // Game-level settings
    const tMirror = document.getElementById('toggle-rear-mirror');
    const tVoice = document.getElementById('toggle-voice');
    if (tMirror) tMirror.checked = this.settings.rearMirror !== false;
    if (tVoice) tVoice.checked = this.settings.voice === true;
    const tAuto = document.getElementById('toggle-autostart');
    if (tAuto) tAuto.checked = this.settings.autoStart !== false;
    const tPrompts = document.getElementById('select-prompts');
    if (tPrompts) tPrompts.value = this.settings.prompts || 'adaptive';

    // Numerical badges
    const setTxt = (id, txt) => {
      const el = document.getElementById(id);
      if (el) el.textContent = txt;
    };

    setTxt('val-jump', `${jumpVal}%`);
    setTxt('val-squat', `${squatVal}%`);
    setTxt('val-step', `${stepVal}%`);
    setTxt('val-punch', `${punchVal}%`);

    setTxt('tut-val-jump', `${jumpVal}%`);
    setTxt('tut-val-squat', `${squatVal}%`);
    setTxt('tut-val-step', `${stepVal}%`);
    setTxt('tut-val-punch', `${punchVal}%`);
  }

  redrawActiveCanvas() {
    if (!this._latestPose) return;
    const calibModal = document.getElementById('calibration-modal');
    if (calibModal && !calibModal.classList.contains('hidden')) {
      const calibCanvas = document.getElementById('calib-canvas');
      if (calibCanvas) this.calibrator.drawSkeleton(calibCanvas, this._latestPose, false);
    }
    if (this.isTutorialActive) {
      const tutCanvas = document.getElementById('tut-skeleton-canvas');
      if (tutCanvas) this.calibrator.drawSkeleton(tutCanvas, this._latestPose, true);
    }
  }

  getActiveVideo() {
    // If tutorial modal is visible, sample from tutorial video
    if (this.isTutorialActive) {
      const tutVideo = document.getElementById('tut-video');
      if (tutVideo && tutVideo.videoWidth > 0 && !tutVideo.paused) return tutVideo;
    }

    // If calibration modal is visible, sample from calib video
    const calibModal = document.getElementById('calibration-modal');
    if (calibModal && !calibModal.classList.contains('hidden')) {
      const calibVideo = document.getElementById('calib-video');
      if (calibVideo && calibVideo.videoWidth > 0) return calibVideo;
    }

    // While in-game or paused, sample from PIP video
    const pipVideo = document.getElementById('webcam-video');
    if (pipVideo && pipVideo.videoWidth > 0) return pipVideo;

    // Fallback to any ready video element
    const all = [
      document.getElementById('tut-video'),
      document.getElementById('webcam-video'),
      document.getElementById('calib-video'),
    ];
    return all.find((v) => v && v.videoWidth > 0) || null;
  }

  startRun() {
    if (this.tutAdvanceTimeout) {
      clearTimeout(this.tutAdvanceTimeout);
      this.tutAdvanceTimeout = null;
    }
    this.screen = 'playing';
    this.resetChaos();
    if (this.chaosMode) {
      this.chaosNextEffectIn = 8 + Math.random() * 5;
      this.chaosLastActionAt = performance.now();
    }
    this._lastRunPose = null;
    this.isTutorialActive = false;
    this.ui.hideAllModals();
    this.ui.hideActionPrompt();
    this.ui.showHud(true);
    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('run-countdown')?.classList.add('hidden');
    document.getElementById('caught-overlay')?.classList.add('hidden');

    // A keyboard run has no body tracker: hide the camera PIP and stop feeding
    // frames to the pose model until the player starts a camera run again.
    this.keyboardOnly = this.pendingKeyboard === true;
    const pip = document.getElementById('webcam-pip');
    if (pip) {
      pip.classList.toggle('hidden', this.keyboardOnly);
      pip.classList.toggle('keyboard-mode', this.keyboardOnly);
    }
    document.getElementById('kb-badge')?.classList.toggle('hidden', !this.keyboardOnly);
    if (this.keyboardOnly) {
      // Stop the media stream itself so the camera light actually goes out.
      this.releaseCameraFeed();
    } else {
      this.controlMode = 'camera';
      document.getElementById('kb-badge')?.classList.add('hidden');
    }

    // Guaranteed cleanup of any leftover backdrop or countdown
    ['calibration-modal', 'tutorial-modal', 'pause-modal', 'summary-modal', 'calib-countdown'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });

    // Reset game state
    this.playerZ = 0;
    this.runSpeed = 10.5;
    this.targetLaneX = 0;
    this.isJumping = false;
    this.isSquatting = false;
    this.keyboardJumpTimer = 0;
    this.keyboardSquatTimer = 0;
    this.score = 0;
    this.distance = 0;
    this.lives = this.maxLives;
    this.shieldTimer = 0;
    this.invulnerabilityTimer = 0;
    this.combo = 0;
    this.comboMultiplier = 1;
    this.maxCombo = 1;
    this.comboTimer = 0;
    this.elapsedSeconds = 0;
    this.caloriesBurned = 0;
    this.estimatedBpm = 120;
    this.caughtPending = false;
    this.heartbeatTimer = 0;

    this.reps = { jumps: 0, squats: 0, punches: 0, steps: 0 };
    this._recordNotified = false;
    this._hintsDimmed = false;
    document.querySelector('.keyboard-hints')?.classList.remove('dim');

    this.obstacleManager.reset();
    this.monsterManager.reset();
    this.pickupManager.reset();
    this.playerHands.resetPunches();
    this.calibrator.resetMotionState();
    this.chaser.reset();
    this.ui.updateChaseHud(CHASE.START_GAP);
    this.ui.updateChaseVfx(0);

    this.isRunning = true;
    this.isPaused = false;
    this.lastTime = performance.now();

    this.sound.setMenuMode(false);
    this.sound.startMusic();
    this.sound.speakPrompt('Run!');
  }

  resetChaos() {
    this.chaosEffect = null;
    this.chaosEffectTimer = 0;
    this.chaosNextEffectIn = 0;
    this.chaosSlipTimer = 0;
    this.chaosTurboUntil = 0;
    this._runFootSide = null;
    this._runFootSwitches = 0;
    this.sceneManager.shakeIntensity = 0;
    this.sceneManager.slipTimer = 0;
    document.getElementById('chaos-blackout')?.classList.remove('active');
    document.getElementById('chaos-slip')?.classList.remove('active');
    document.getElementById('chaos-turbo-badge')?.classList.add('hidden');
    document.getElementById('chaos-mode-badge')?.classList.toggle('hidden', !this.chaosMode);
  }

  noteChaosAction() {
    if (this.chaosMode) this.chaosLastActionAt = performance.now();
  }

  updateBodyRunTracking(pose, motion) {
    if (!this.isRunning || this.keyboardOnly || !this.chaosMode || !pose || pose === this._lastRunPose) return;
    this._lastRunPose = pose;
    const now = performance.now();
    if (motion?.isJumping || motion?.isSquatting || motion?.laneChanged || motion?.punchTriggered) {
      this.noteChaosAction();
    }

    const c = this.calibrator;
    const torso = Math.max(.16, pose.torsoHeight || c.torsoHeight || .3);
    const leftVisible = (pose.leftAnkleScore ?? 0) > .45;
    const rightVisible = (pose.rightAnkleScore ?? 0) > .45;
    let liftedSide = null;
    if (leftVisible && rightVisible) {
      const leftLift = c.baselineLeftAnkleY - pose.leftAnkleY;
      const rightLift = c.baselineRightAnkleY - pose.rightAnkleY;
      const liftThreshold = torso * .075;
      if (leftLift > liftThreshold && rightLift <= liftThreshold * .65) liftedSide = 'left';
      else if (rightLift > liftThreshold && leftLift <= liftThreshold * .65) liftedSide = 'right';
    }

    if (liftedSide) {
      this.noteChaosAction();
      if (this._runFootSide && liftedSide !== this._runFootSide) {
        const interval = now - this._lastRunFootSwitchAt;
        if (interval >= 120 && interval <= 1000) {
          this._runFootSwitches++;
          if (this._runFootSwitches >= 2) {
            this.chaosTurboUntil = now + 1100;
            this._runFootSwitches = 0;
          }
        } else {
          this._runFootSwitches = 0;
        }
        this._lastRunFootSwitchAt = now;
      } else if (!this._runFootSide) {
        this._lastRunFootSwitchAt = now;
      }
      this._runFootSide = liftedSide;
    } else if (!leftVisible || !rightVisible || this._runFootSide) {
      // Let the other foot become the next rising foot after landing.
      this._runFootSide = null;
    }
  }

  updateChaos(delta) {
    if (!this.chaosMode) return;
    const now = performance.now();
    if (this.chaosNextEffectIn <= 0) this.chaosNextEffectIn = 8 + Math.random() * 5;

    this.chaosNextEffectIn -= delta;
    if (this.chaosNextEffectIn <= 0 && !this.chaosEffect) {
      this.chaosEffect = Math.random() < .5 ? 'blackout' : 'shake';
      this.chaosEffectTimer = this.chaosEffect === 'blackout' ? 1 : .9;
      if (this.chaosEffect === 'blackout') {
        document.getElementById('chaos-blackout')?.classList.add('active');
      }
    }

    if (this.chaosEffect) {
      this.chaosEffectTimer -= delta;
      if (this.chaosEffect === 'shake') this.sceneManager.triggerShake(.72);
      if (this.chaosEffectTimer <= 0) {
        this.chaosEffect = null;
        document.getElementById('chaos-blackout')?.classList.remove('active');
        this.chaosNextEffectIn = 14 + Math.random() * 8;
      }
    }

    this.chaosSlipTimer = Math.max(0, this.chaosSlipTimer - delta);
    document.getElementById('chaos-slip')?.classList.toggle('active', this.chaosSlipTimer > 0);
    if (this.chaosSlipTimer > 0) this.sceneManager.triggerShake(.32);
    else if (now - this.chaosLastActionAt > 6000) {
      this.chaosSlipTimer = .8;
      this.chaosLastActionAt = now;
      this.sceneManager.triggerSlip(.8);
      this.ui.showFeedback('SLIPPED! KEEP MOVING', 'miss');
    }
  }

  toggleMute() {
    this.sound.ensureContext();
    const audible = this.sound.toggleMute();
    const btn = document.getElementById('btn-audio');
    if (btn) {
      btn.textContent = audible ? '🔊' : '🔇';
      btn.setAttribute('aria-label', audible ? 'Mute audio' : 'Unmute audio');
    }
    this.syncHomeAudioButton();
  }

  syncHomeAudioButton() {
    const btn = document.getElementById('home-audio');
    if (!btn) return;
    const audible = !this.sound.isMuted;
    btn.innerHTML = `${audible ? '♫' : '♪'} <span>${audible ? 'ON' : 'OFF'}</span>`;
    btn.setAttribute('aria-label', audible ? 'Mute audio' : 'Unmute audio');
    btn.setAttribute('aria-pressed', String(!audible));
    btn.title = audible ? 'Mute audio' : 'Unmute audio';
  }

  // =====================================================
  // TUTORIAL SYSTEM
  // =====================================================
  openTutorial() {
    document.getElementById('home-screen')?.classList.add('hidden');
    document.getElementById('webcam-pip')?.classList.add('hidden');
    this.screen = 'tutorial';
    this.startTutorial();
  }

  /** Leaving the tutorial returns to the flow, never straight into a run. */
  finishTutorial() {
    this.isTutorialActive = false;
    this.ui.hideAllModals();
    if (this.cameraReady && !this.calibrator.isCalibrated) {
      this.openCalibration();
    } else {
      this.showHome();
    }
  }

  startTutorial() {
    this.sound.ensureContext();
    if (this.tutAdvanceTimeout) {
      clearTimeout(this.tutAdvanceTimeout);
      this.tutAdvanceTimeout = null;
    }
    this.tutorialStep = 0;
    this.isTutorialActive = true;
    this.tutorialDetected = { jump: false, squat: false, step: false, punch: false };
    this.tutStep3StartLane = undefined;

    // Connect tutorial video element to camera stream
    const tutVideo = document.getElementById('tut-video');
    const tutViewport = document.getElementById('tut-cam-viewport');
    if (tutViewport) tutViewport.classList.toggle('no-camera', !this.calibrator.stream);
    if (tutVideo && this.calibrator.stream) {
      if (tutVideo.srcObject !== this.calibrator.stream) {
        tutVideo.srcObject = this.calibrator.stream;
      }
      tutVideo.play().catch(() => {});
    }

    // Auto-center baseline from current stance if available
    if (this._latestPose && !this.calibrator.isCalibrated) {
      this.calibrator.lockBaselineFromPose(this._latestPose);
    }

    this.ui.showModal('tutorial');
    this.updateTutorialUI();
    this.initTutorialEventListeners();
  }

  initTutorialEventListeners() {
    // Prevent double-binding
    if (this._tutListenersAdded) return;
    this._tutListenersAdded = true;

    document.getElementById('btn-tut-next')?.addEventListener('click', () => {
      this.tutorialNext();
    });

    document.getElementById('btn-tut-prev')?.addEventListener('click', () => {
      this.tutorialPrev();
    });

    document.getElementById('btn-skip-tutorial')?.addEventListener('click', () => {
      if (this.tutAdvanceTimeout) {
        clearTimeout(this.tutAdvanceTimeout);
        this.tutAdvanceTimeout = null;
      }
      this.finishTutorial();
    });

    // Re-center baseline button in tutorial camera window
    document.getElementById('btn-tut-recalibrate')?.addEventListener('click', () => {
      if (this._latestPose) {
        this.calibrator.lockBaselineFromPose(this._latestPose);
        const hint = document.getElementById('tut-cam-status-hint');
        if (hint) {
          hint.textContent = '✅ Baseline locked to your current standing height!';
          hint.style.color = '#00e676';
          setTimeout(() => {
            hint.textContent = 'Stand 5-7 ft back with head & torso visible';
            hint.style.color = '';
          }, 2500);
        }
        this.sound.playComboChime(2);
      } else {
        const hint = document.getElementById('tut-cam-status-hint');
        if (hint) {
          hint.textContent = 'Stand in frame first!';
        }
      }
    });
  }

  tutorialNext() {
    if (this.tutAdvanceTimeout) {
      clearTimeout(this.tutAdvanceTimeout);
      this.tutAdvanceTimeout = null;
    }

    if (this.tutorialStep < this.tutorialTotalSteps - 1) {
      this.tutorialStep++;
      if (this.tutorialStep === 3) {
        this.tutStep3StartLane = this.currentLaneX;
      }
      this.updateTutorialUI();
    } else {
      // Last step: hand control back to the normal flow
      this.finishTutorial();
    }
  }

  tutorialPrev() {
    if (this.tutAdvanceTimeout) {
      clearTimeout(this.tutAdvanceTimeout);
      this.tutAdvanceTimeout = null;
    }

    if (this.tutorialStep > 0) {
      this.tutorialStep--;
      if (this.tutorialStep === 3) {
        this.tutStep3StartLane = this.currentLaneX;
      }
      this.updateTutorialUI();
    }
  }

  updateTutorialUI() {
    // Update progress bar
    const progress = ((this.tutorialStep + 1) / this.tutorialTotalSteps) * 100;
    const progressFill = document.getElementById('tutorial-progress-fill');
    if (progressFill) progressFill.style.width = `${progress}%`;

    // Update step badge
    const badge = document.getElementById('tut-step-badge');
    if (badge) badge.textContent = `STEP ${this.tutorialStep + 1} / ${this.tutorialTotalSteps}`;

    // Show active step, hide others
    for (let i = 0; i < this.tutorialTotalSteps; i++) {
      const stepEl = document.getElementById(`tut-step-${i}`);
      if (stepEl) {
        stepEl.classList.toggle('active', i === this.tutorialStep);
      }
    }

    // Update nav button states
    const prevBtn = document.getElementById('btn-tut-prev');
    const nextBtn = document.getElementById('btn-tut-next');

    if (prevBtn) prevBtn.disabled = (this.tutorialStep === 0);
    if (nextBtn) {
      nextBtn.textContent = (this.tutorialStep === this.tutorialTotalSteps - 1) ? 'GOT IT ✓' : 'NEXT →';
    }

    // Pure visual sync of detection rings - NEVER call markTutDetected or set timers here!
    const practiceMoves = [
      { key: 'jump', name: 'JUMP' },
      { key: 'squat', name: 'SQUAT' },
      { key: 'step', name: 'SIDE-STEP' },
      { key: 'punch', name: 'PUNCH' },
    ];

    practiceMoves.forEach(({ key, name }) => {
      const ring = document.getElementById(`tut-detect-${key}`);
      const status = document.getElementById(`tut-status-${key}`);
      const isDetected = Boolean(this.tutorialDetected[key]);
      if (ring) {
        ring.classList.toggle('detected', isDetected);
      }
      if (status) {
        status.textContent = isDetected ? `${name} DETECTED! ✓` : `Waiting for ${name}...`;
      }
    });
  }

  markTutDetected(move) {
    const practiceSteps = { 1: 'jump', 2: 'squat', 3: 'step', 4: 'punch' };
    // Only accept detection for the CURRENT active practice step!
    if (practiceSteps[this.tutorialStep] !== move) return;

    const ringId = `tut-detect-${move}`;
    const statusId = `tut-status-${move}`;
    const ring = document.getElementById(ringId);
    const status = document.getElementById(statusId);

    if (ring && !ring.classList.contains('detected')) {
      ring.classList.add('detected');
      if (status) status.textContent = `${move.toUpperCase()} DETECTED! ✓`;
      this.sound.playComboChime(2);

      // Cancel any existing auto-advance timer to avoid stacking
      if (this.tutAdvanceTimeout) {
        clearTimeout(this.tutAdvanceTimeout);
      }

      // Auto-advance to the next step after a clear, satisfying 1.2s delay
      this.tutAdvanceTimeout = setTimeout(() => {
        this.tutAdvanceTimeout = null;
        if (this.isTutorialActive && practiceSteps[this.tutorialStep] === move) {
          this.tutorialNext();
        }
      }, 1200);
    }
  }

  // Called from the main update loop when tutorial is active
  processTutorialInput(motion) {
    if (!this.isTutorialActive) return;

    // Step 1 (index 1): Detect JUMP
    if (this.tutorialStep === 1 && motion.isJumping && !this.tutorialDetected.jump) {
      this.tutorialDetected.jump = true;
      this.markTutDetected('jump');
    }
    // Step 2 (index 2): Detect SQUAT
    else if (this.tutorialStep === 2 && motion.isSquatting && !this.tutorialDetected.squat) {
      this.tutorialDetected.squat = true;
      this.markTutDetected('squat');
    }
    // Step 3 (index 3): Detect SIDE STEP
    else if (this.tutorialStep === 3 && !this.tutorialDetected.step) {
      if (this.tutStep3StartLane === undefined) {
        this.tutStep3StartLane = this.currentLaneX;
      }
      const hasLaneSwitched = motion.laneChanged || (this.currentLaneX !== this.tutStep3StartLane);
      if (hasLaneSwitched) {
        this.tutorialDetected.step = true;
        this.markTutDetected('step');
      }
    }
    // Step 4 (index 4): Detect PUNCH
    else if (this.tutorialStep === 4 && (motion.punchTriggered || motion.action === 'PUNCH') && !this.tutorialDetected.punch) {
      this.tutorialDetected.punch = true;
      this.triggerPunch(motion.punchSide || 'right');
      this.markTutDetected('punch');
    }
  }

  // Handle keyboard-triggered tutorial detection
  processTutorialKeyboard(move) {
    if (!this.isTutorialActive) return;
    const stepMoveMap = { 1: 'jump', 2: 'squat', 3: 'step', 4: 'punch' };
    const expectedMove = stepMoveMap[this.tutorialStep];
    if (move === expectedMove && !this.tutorialDetected[move]) {
      this.tutorialDetected[move] = true;
      if (move === 'punch') {
        this.triggerPunch('right');
      }
      this.markTutDetected(move);
    }
  }

  togglePause() {
    if (!this.isRunning || this.screen === 'countdown') return;
    this.isPaused = !this.isPaused;
    if (this.isPaused) {
      this.screen = 'paused';
      this.sound.stopMusic();
      document.getElementById('btn-pause-camera')?.classList.toggle('hidden', !this.keyboardOnly);
      this.ui.showModal('pause');
      this.ui.updateSpeedVfx(0);
    } else {
      this.screen = 'playing';
      this.sound.startMusic();
      this.ui.hideAllModals();
      this.lastTime = performance.now();
    }
  }

  triggerJump() {
    this.noteChaosAction();
    this.isJumping = true;
    this.keyboardJumpTimer = 0.55;
    this.sound.playJumpWhoosh();
    this.reps.jumps++;
    this.ui.bumpRep('jumps');
  }

  triggerSquat() {
    this.noteChaosAction();
    this.isSquatting = true;
    this.keyboardSquatTimer = 0.65; // 650ms slide duration
    this.sound.playSlideScrape();
    this.reps.squats++;
    this.ui.bumpRep('squats');
  }

  triggerPunch(side = 'right') {
    this.noteChaosAction();
    this.playerHands.triggerPunch(side);
    this.sound.playPunchImpact();
    this.reps.punches++;
    this.ui.bumpRep('punches');

    // Check if monster in reach
    const hit = this.monsterManager.checkPunchHit(this.playerZ, this.targetLaneX);
    if (hit) {
      this.ui.hideActionPrompt();
      this.noteClear('punch');
      this.sound.playMonsterShatter();
      this.sceneManager.triggerShake(0.5);
      this.ui.triggerHitFlash();
      this.addCombo(hit.remaining > 0 ? 125 : 250);
      if (hit.remaining === 0) this.chaser.pushBack(CHASE.KILL_PUSH);
      this.ui.updateChaseHud(this.chaser.gap);
      if (hit.remaining > 0) {
        this.ui.showFeedback('PAIR HIT · ONE LEFT', 'crushed');
      } else {
        this.ui.showFeedback('CRUSHED! +250', 'crushed');
      }
    }
  }

  addCombo(points = 100) {
    this.combo++;
    this.comboTimer = 3.5; // Combo hold window
    this.comboMultiplier = Math.min(8, 1 + Math.floor(this.combo / 4));
    if (this.comboMultiplier > this.maxCombo) {
      this.maxCombo = this.comboMultiplier;
    }
    this.score += points * this.comboMultiplier;
    this.sound.playComboChime(this.comboMultiplier);
    this.sound.setBpm(128 + this.comboMultiplier * 3);
  }

  resetCombo() {
    this.combo = 0;
    this.comboMultiplier = 1;
    this.sound.setBpm(128);
  }

  collectPickup(type) {
    if (type === 'shield') {
      this.shieldTimer = 5;
      this.sound.playComboChime(3);
      this.ui.showFeedback('SHIELD ONLINE · 5s', 'perfect');
    } else if (type === 'heart' && this.lives < this.maxLives) {
      this.lives = Math.min(this.maxLives, this.lives + 1);
      this.sound.playComboChime(2);
      this.ui.showFeedback('EXTRA LIFE +1', 'perfect');
    }
  }

  takeDamage() {
    if (!this.isRunning) return false;
    if (this.shieldTimer > 0) {
      this.sceneManager.triggerShake(.24);
      this.ui.triggerHitFlash();
      this.ui.showFeedback('SHIELD DEFLECT!', 'perfect');
      this.sound.playPunchImpact();
      return false;
    }
    if (this.invulnerabilityTimer > 0) return false;
    this.lives--;
    this.resetCombo();
    this.sound.playDamage();
    this.sceneManager.triggerShake(0.65);
    this.ui.triggerDamageVfx();
    this.ui.showFeedback('HIT! -1 STAMINA', 'miss');

    if (this.lives > 0) {
      this.invulnerabilityTimer = 1.5;
      this.chaser.pushBack(CHASE.HIT_LUNGE + CHASE.CATCH_GAP + 1);
      this.ui.showFeedback('LIFE SAVED · 1.5s', 'miss');
      this.ui.updateChaseHud(this.chaser.gap);
      return true;
    }

    // The beast punishes the final mistake immediately.
    this.chaser.lunge(CHASE.HIT_LUNGE);
    this.sound.playBeastRoar();
    this.ui.updateChaseHud(this.chaser.gap);

    this.caughtByBeast();
    return true;
  }

  /** The beast reaches you: short cinematic lunge, then the run ends. */
  caughtByBeast() {
    if (this.caughtPending || !this.isRunning) return;
    this.caughtPending = true;
    this.resetChaos();
    this.isRunning = false;
    this.screen = 'caught';
    this.sound.stopMusic();
    this.sound.playBeastRoar();
    this.sceneManager.triggerShake(1.2);
    this.ui.hideActionPrompt();

    const overlay = document.getElementById('caught-overlay');
    overlay?.classList.remove('hidden');
    this.chaser.caught = true;

    setTimeout(() => {
      overlay?.classList.add('hidden');
      this.endRun({ caught: true });
    }, 1150);
  }

  endRun({ caught = false, quit = false } = {}) {
    this.resetChaos();
    this.isRunning = false;
    this.isPaused = false;
    this.screen = 'over';
    this.caughtPending = false;
    this.chaser.caught = false;
    this.sound.stopMusic();
    this.ui.hideActionPrompt();
    document.getElementById('kb-badge')?.classList.add('hidden');
    this.sound.speakPrompt(caught ? 'Caught!' : 'Workout complete!');

    // Persist personal best + last run
    const isNewBest = this.score > this.bestScore;
    if (isNewBest) {
      this.bestScore = Math.floor(this.score);
      this.saveBestScore(this.bestScore);
    }
    try {
      localStorage.setItem('reflexrun_last_run', JSON.stringify({
        score: Math.floor(this.score),
        distance: Math.round(this.distance),
        caught,
        at: Date.now(),
      }));
    } catch (e) {
      // ignore
    }
    this.ui.showHud(false);
    this.ui.updateChaseVfx(0);
    document.getElementById('webcam-pip')?.classList.add('hidden');

    if (quit) {
      this.showHome();
      return;
    }

    // Preserve the run result values while returning the 3D background itself
    // to the title-screen corridor composition.
    this.resetTempleBackdrop();

    this.ui.showWorkoutSummary({
      score: this.score,
      bestScore: this.bestScore,
      isNewBest,
      caught,
      distance: this.distance,
      maxCombo: this.maxCombo,
      elapsedSeconds: this.elapsedSeconds,
      caloriesBurned: this.caloriesBurned,
      reps: this.reps,
    });
  }

  returnToCalibration() {
    this.isRunning = false;
    this.isPaused = false;
    this.sound.stopMusic();
    this.ui.hideActionPrompt();
    this.ui.showHud(false);
    this.openCalibration();
  }

  loadBestScore() {
    try {
      const raw = Number(window.localStorage.getItem('reflexrun_best_score'));
      return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
    } catch (e) {
      return 0;
    }
  }

  saveBestScore(value) {
    try {
      window.localStorage.setItem('reflexrun_best_score', String(Math.floor(value)));
    } catch (e) {
      // Storage unavailable (private mode) — best score stays session-only
    }
  }

  // Obstacle event handler
  handleObstacleEvent(event, type, obs) {
    const kind = this.obstacleKind(type);

    if (event === 'APPROACHING') {
      // Silent side-rail cue, and only while this move is still being learned.
      // Nothing is ever spoken here — obstacle warnings arrive every ~2 s and
      // voice-over made the game impossible to concentrate on.
      if (!this.cueEnabled(kind)) return;
      if (type === 'JUMP') {
        this.ui.showActionPrompt('JUMP', 'HOP THE SPIKES', 0);
      } else if (type === 'SLIDE') {
        this.ui.showActionPrompt('SLIDE', 'DUCK NOW', 0);
      } else if (type === 'STEP') {
        const laneName = ['LEFT', 'CENTER', 'RIGHT'][obs?.openLane ?? 1];
        this.ui.showActionPrompt('DODGE', `MOVE ${laneName}`, 'THEN PUNCH THE BLOCK');
      }
    } else if (event === 'SUCCESS') {
      this.ui.hideActionPrompt();
      this.noteClear(kind);
      this.addCombo(150);
      this.chaser.pushBack(CHASE.CLEAR_PUSH);
      this.ui.updateChaseHud(this.chaser.gap);
      this.ui.showFeedback('PERFECT! +150', 'perfect');
    } else if (event === 'HIT') {
      this.ui.hideActionPrompt();
      this.noteMiss(kind);
      this.obstacleManager.removeObstacle(obs);
      this.takeDamage();
    }
  }

  handleMonsterEvent(event, monster) {
    if (event === 'APPROACHING') {
      if (!this.cueEnabled('punch')) return;
      const laneName = ['LEFT', 'CENTER', 'RIGHT'][monster?.laneIdx ?? 1];
      this.ui.showActionPrompt('PUNCH', `${laneName} LANE`, 'THROW A PUNCH');
    } else if (event === 'ATTACK') {
      this.ui.hideActionPrompt();
      this.noteMiss('punch');
      this.takeDamage();
    } else if (event === 'PASSED') {
      this.ui.hideActionPrompt();
    }
  }

  // Asynchronous camera vision pipeline (completely decoupled from 60 FPS 3D render loop)
  scheduleCameraProcessing() {
    if (this.keyboardOnly) return; // keyboard run: tracker is off
    if (this._isInferringPose) return;
    const activeVideo = this.getActiveVideo();
    if (!activeVideo || activeVideo.videoWidth === 0 || activeVideo.paused) return;
    if (activeVideo !== this._lastPoseVideo || activeVideo.currentTime < this._lastPoseVideoTime) {
      this._lastPoseProcessedAt = 0;
      this._lastPoseVideoTime = -1;
    }
    if (activeVideo.currentTime === this._lastPoseVideoTime) return;
    this._lastPoseVideo = activeVideo;
    this._lastPoseVideoTime = activeVideo.currentTime;

    this._isInferringPose = true;
    this.poseDetector.estimatePose(activeVideo).then((pose) => {
      this._isInferringPose = false;
      if (!pose) return;

      this._latestPose = pose;
      const poseProcessedAt = performance.now();
      this._lastCVDelta = this._lastPoseProcessedAt
        ? Math.min(.12, (poseProcessedAt - this._lastPoseProcessedAt) / 1000)
        : 1 / 30;
      this._lastPoseProcessedAt = poseProcessedAt;
      const motion = this.calibrator.processFrame(pose);
      this._latestMotion = motion;
      this.updateBodyRunTracking(pose, motion);

      // Render camera canvas overlays & UI meters
      this.renderCameraOverlays(pose, motion);

      // In-game pose action triggers
      if (this.isRunning && !this.isPaused) {
        // Continuous squat tracking (motion tracking holds squat naturally without timer cutoff)
        if (this.keyboardSquatTimer <= 0) {
          if (motion.isSquatting && !this.isSquatting) {
            this.sound.playSlideScrape();
            this.reps.squats++;
            this.ui.bumpRep('squats');
          }
          this.isSquatting = Boolean(motion.isSquatting);
        }

        // Continuous jump tracking
        if (this.keyboardJumpTimer <= 0) {
          if (motion.isJumping && !this.isJumping) {
            this.sound.playJumpWhoosh();
            this.reps.jumps++;
            this.ui.bumpRep('jumps');
          }
          this.isJumping = Boolean(motion.isJumping);
        }

        if (motion.punchTriggered) {
          this.triggerPunch(motion.punchSide || 'right');
        }
        // Lateral lane tracking from body position
        const trackedLane = motion.laneX;
        if (Math.abs(trackedLane - this.targetLaneX) > 1.5) {
          this.targetLaneX = trackedLane;
          this.reps.steps++;
          this.ui.bumpRep('steps');
        }
      }
    }).catch((err) => {
      this._isInferringPose = false;
      console.warn('Pose inference error:', err);
    });
  }

  /**
   * Where the video image actually lands inside its box for object-fit: cover.
   * Used so the skeleton overlay stays glued to the body when the preview is
   * cropped instead of stretched.
   */
  getObjectFitView(video, boxW, boxH) {
    const vw = video?.videoWidth || 640;
    const vh = video?.videoHeight || 480;
    if (!boxW || !boxH) return null;
    const scale = Math.max(boxW / vw, boxH / vh);
    const w = vw * scale;
    const h = vh * scale;
    return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
  }

  renderCameraOverlays(pose, motion) {
    if (!pose || !motion) return;

    // 1. Calibration Screen: Render live skeleton and diagnostic meters
    const calibModal = document.getElementById('calibration-modal');
    if (calibModal && !calibModal.classList.contains('hidden')) {
      const calibCanvas = document.getElementById('calib-canvas');
      const calibVideo = document.getElementById('calib-video');
      if (calibCanvas && calibVideo) {
        const targetW = calibVideo.clientWidth || 400;
        const targetH = calibVideo.clientHeight || 300;
        if (calibCanvas.width !== targetW) calibCanvas.width = targetW;
        if (calibCanvas.height !== targetH) calibCanvas.height = targetH;
        this.calibrator.drawSkeleton(calibCanvas, pose, false, this.getObjectFitView(calibVideo, targetW, targetH));
      }

      // Live skeleton + wizard validation for the calibration screen
      this.updateCalibrationFromPose(pose);
      this.updateCalibrationFromMotion(motion);
    }

    // 2. Tutorial Screen: Render live skeleton, camera action pill, and motion levels
    if (this.isTutorialActive) {
      const tutCanvas = document.getElementById('tut-skeleton-canvas');
      const tutVideo = document.getElementById('tut-video');
      if (tutCanvas && tutVideo) {
        const targetW = tutVideo.clientWidth || 320;
        const targetH = tutVideo.clientHeight || 220;
        if (tutCanvas.width !== targetW) tutCanvas.width = targetW;
        if (tutCanvas.height !== targetH) tutCanvas.height = targetH;
        this.calibrator.drawSkeleton(tutCanvas, pose, true, this.getObjectFitView(tutVideo, targetW, targetH));
      }

      // Action badge in tutorial camera
      const tutActionPill = document.getElementById('tut-cam-action-pill');
      if (tutActionPill) {
        tutActionPill.textContent = motion.action;
        tutActionPill.className = `tut-cam-action-pill ${motion.action.toLowerCase().replace(/\s+/g, '-')}`;
      }

      // Vertical height pin
      const heightPin = document.getElementById('tut-height-pin');
      if (heightPin) {
        const hPercent = Math.max(0, Math.min(100, 50 + (motion.deltaY / 0.25) * 50));
        heightPin.style.top = `${hPercent}%`;
      }

      // Lateral pin
      const latPin = document.getElementById('tut-lat-pin');
      if (latPin) {
        const lPercent = Math.max(5, Math.min(95, 50 + (motion.deltaX / 0.25) * 50));
        latPin.style.left = `${lPercent}%`;
      }

      // Punch reach fill
      const tutPunchFill = document.getElementById('tut-punch-fill');
      if (tutPunchFill) {
        tutPunchFill.style.width = `${Math.round(motion.punchReach || 0)}%`;
      }

      // Lane marks in tutorial viewport
      const markLeft = document.getElementById('tut-mark-left');
      const markCenter = document.getElementById('tut-mark-center');
      const markRight = document.getElementById('tut-mark-right');
      if (markLeft && markCenter && markRight) {
        markLeft.classList.toggle('active', motion.laneX < -1);
        markCenter.classList.toggle('active', Math.abs(motion.laneX) <= 1);
        markRight.classList.toggle('active', motion.laneX > 1);
      }

      // Feed motion to tutorial step detector
      this.processTutorialInput(motion);
    }

    // 3. Game Run / In-Game HUD: Render on PIP canvas
    const pipCanvas = document.getElementById('webcam-skeleton-canvas');
    const pipVideo = document.getElementById('webcam-video');
    if (pipCanvas && pipVideo) {
      const targetW = pipVideo.clientWidth || 220;
      const targetH = pipVideo.clientHeight || 150;
      if (pipCanvas.width !== targetW) pipCanvas.width = targetW;
      if (pipCanvas.height !== targetH) pipCanvas.height = targetH;
      this.calibrator.drawSkeleton(pipCanvas, pose, false, this.getObjectFitView(pipVideo, targetW, targetH));
    }

    // Update PIP tag
    this.ui.updatePipTag(motion.action);
  }

  // 60 FPS Continuous 3D Game Render Loop (Never blocked by CV inference)
  update() {
    const now = performance.now();
    const delta = Math.min(0.06, (now - this.lastTime) / 1000);
    this.lastTime = now;
    this._lastFrameDelta = delta;

    // Asynchronously dispatch camera pose detection in background
    this.scheduleCameraProcessing();

    // Process Game Loop if Running
    if (this.isRunning && !this.isPaused) {
      this.updateChaos(delta);
      this.runSpeed = Math.min(18.0, 10.5 + (this.distance / 250));
      const speedScale = this.chaosMode && performance.now() < this.chaosTurboUntil ? 1.5 : 1;
      document.getElementById('chaos-turbo-badge')?.classList.toggle('hidden', speedScale <= 1);
      // Progress forward distance
      this.playerZ -= this.runSpeed * speedScale * delta;
      this.distance += this.runSpeed * speedScale * delta;
      this.elapsedSeconds += delta;
      if (!this._hintsDimmed && this.elapsedSeconds > 18) {
        this._hintsDimmed = true;
        document.querySelector('.keyboard-hints')?.classList.add('dim');
      }

      // Accelerate speed slightly as distance increases

      // Handle keyboard jump/squat timers
      if (this.keyboardJumpTimer > 0) {
        this.keyboardJumpTimer -= delta;
        if (this.keyboardJumpTimer <= 0) this.isJumping = false;
      }
      if (this.keyboardSquatTimer > 0) {
        this.keyboardSquatTimer -= delta;
        if (this.keyboardSquatTimer <= 0) this.isSquatting = false;
      }
      this.shieldTimer = Math.max(0, this.shieldTimer - delta);
      this.invulnerabilityTimer = Math.max(0, this.invulnerabilityTimer - delta);

      // Combo cooldown
      if (this.comboTimer > 0) {
        this.comboTimer -= delta;
        if (this.comboTimer <= 0) this.resetCombo();
      }

      // Workout Science Calorie & Heart Rate Formula
      // MET values: Average high intensity workout MET = 7.5
      // Calorie burn rate = (7.5 * 3.5 * 70kg / 200) / 60 = ~0.15 kcal/second
      if (!this.keyboardOnly) {
        const intensity = 1.0 + (this.comboMultiplier * 0.25) + (this.runSpeed / 20);
        this.caloriesBurned += (0.13 * intensity) * delta;
      }
      this.estimatedBpm = Math.min(175, 120 + this.comboMultiplier * 6 + (this.reps.jumps + this.reps.squats) * 0.5);

      // Update 3D Subsystems
      this.environment.update(this.playerZ, delta);
      this.obstacleManager.update(
        this.playerZ,
        this.targetLaneX,
        this.isJumping,
        this.isSquatting,
        delta,
        (ev, type, obs) => this.handleObstacleEvent(ev, type, obs), this.distance, this.score
      );
      this.pickupManager.update(
        this.playerZ, this.targetLaneX, this.distance, this.lives, delta,
        (type) => this.collectPickup(type)
      );
      this.monsterManager.update(
        this.playerZ,
        this.targetLaneX,
        delta,
        (ev, monster) => this.handleMonsterEvent(ev, monster), this.distance, this.score
      );
      this.playerHands.update(this.runSpeed, delta);

      // Update UI Stats
      this.ui.updateStats({
        score: this.score,
        bestScore: Math.max(this.bestScore, this.score),
        distance: this.distance,
        speed: this.runSpeed * speedScale,
        comboMultiplier: this.comboMultiplier,
        comboProgress: this.comboTimer / 3.5,
        caloriesBurned: this.caloriesBurned,
        estimatedBpm: this.estimatedBpm,
        lives: this.lives,
        shieldRemaining: this.shieldTimer,
        invulnerabilityRemaining: this.invulnerabilityTimer,
        reps: this.reps,
      });

      // Beat-your-own-record moment (once per run)
      if (!this._recordNotified && this.bestScore > 0 && this.score > this.bestScore) {
        this._recordNotified = true;
        this.ui.showNewBest();
        this.sound.playComboChime(4);
      }
    }

    // Update FPV Camera and Render 3D Scene
    this.sceneManager.update(
      this.playerZ,
      this.runSpeed,
      this.isJumping,
      this.isSquatting,
      this.targetLaneX,
      delta
    );
    this.sceneManager.render();

    // ---- Chaser: the beast behind you -------------------------------------
    const chaseActive = this.isRunning && !this.isPaused;
    this.chaser.update(this.playerZ, this.targetLaneX, this.runSpeed, delta, chaseActive);

    if (chaseActive) {
      const gap = this.chaser.gap;
      this.ui.updateChaseHud(gap);
      this.ui.updateChaseVfx(this.chaser.closeness());

      // Heartbeat accelerates as the beast closes in
      if (gap < 10) {
        this.heartbeatTimer -= delta;
        if (this.heartbeatTimer <= 0) {
          this.sound.playHeartbeat(1 - gap / 10);
          this.heartbeatTimer = 0.45 + (gap / 10) * 1.0;
        }
      }

      if (gap <= CHASE.CATCH_GAP && this.isRunning) {
        if (this.lives <= 0) this.caughtByBeast();
        else if (this.invulnerabilityTimer <= 0) this.takeDamage();
        else this.chaser.pushBack(CHASE.CATCH_GAP + 1);
      }
    }

    // Rear-view mirror: its own small renderer inside the HUD panel. Throttled
    // to ~30 fps — the canvas keeps the last frame, so there is no flicker and
    // the extra scene pass costs roughly half as much.
    if (this.settings.rearMirror !== false) {
      this.mirrorAccum = (this.mirrorAccum || 0) + delta;
      if (this.mirrorAccum >= 0.033) {
        this.mirrorAccum = 0;
        this.sceneManager.renderRearMirror(this.ui.mirrorEl, this.chaser.gap);
      }
    }

    // Velocity vignette (also clears itself when paused / not running)
    const speedIntensity = (this.isRunning && !this.isPaused)
      ? ((this.runSpeed - 10.5) / 7.5) * 0.6
      : 0;
    this.ui.updateSpeedVfx(speedIntensity);

    // Performance auto-tuner: monitors FPS and switches model quality tier
    this.performanceMonitor.update();

    requestAnimationFrame(() => this.update());
  }
}
