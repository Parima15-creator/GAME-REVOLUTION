// ==========================================================================
// REFLEXRUN 3D - SCENE & FPV CAMERA MANAGER
// ==========================================================================

import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export class SceneManager {
  constructor(container) {
    this.container = container;
    this.width = container.clientWidth || window.innerWidth;
    this.height = container.clientHeight || window.innerHeight;

    // Core Three.js components
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, this.width / this.height, 0.1, 150);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });

    // Rear-view camera used for the "beast is behind you" mirror strip.
    // Deliberately telephoto (28°): a wide lens makes the beast a speck.
    // It gets its own tiny renderer whose canvas lives inside the HUD panel, so
    // the mirror is a real element instead of a scissored hole in the main canvas
    // (that trick flickered and was smeared by the panel's backdrop blur).
    this.rearCamera = new THREE.PerspectiveCamera(44, 2.4, 0.5, 70);
    this.rearRenderer = null;
    this.rearTargetEl = null;
    this.mirrorFrame = 0;
    this.mirrorEnabled = true;

    // FPV Camera movement state
    this.playerLaneX = 0; // Target X lane (-2.8, 0, 2.8)
    this.currentCameraX = 0;
    this.playerY = 1.75; // Standard eye level (1.75m)
    this.currentCameraY = 1.75;
    this.cameraRoll = 0;

    // Dynamic head-bobbing & effects
    this.bobPhase = 0;
    this.shakeIntensity = 0;
    this.hitStopFrames = 0;

    this.init();
  }

  init() {
    this.renderer.setSize(this.width, this.height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    // Deep atmospheric fog
    // PBR metal (blades, iron spikes, the beast's plates) has nothing to reflect
    // without an environment, so it rendered as flat brown. A dim studio probe
    // gives every standard material a believable sheen for ~10 ms at startup.
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.05).texture;
    this.scene.environmentIntensity = 0.12;
    pmrem.dispose();

    this.scene.background = new THREE.Color(0x0b1018);
    // Fog used to swallow the corridor 25 m out, so the track read as a void.
    this.scene.fog = new THREE.FogExp2(0x0b1018, 0.0185);

    // The camera MUST be part of the scene graph, otherwise its children
    // (the first-person boxing gloves) are never traversed and never rendered.
    this.scene.add(this.camera);

    this.setupLighting();
    this.setupResizeHandler();
  }

  setupLighting() {
    // Ambient light
    // Art direction: cool blue-grey stone, warm amber firelight. Everything used
    // to be lit by one warm directional, which turned granite, wood and leather
    // into the same shade of brown.
    const ambientLight = new THREE.AmbientLight(0x2f3d55, 0.7);
    this.scene.add(ambientLight);

    const hemi = new THREE.HemisphereLight(0x4a5f7c, 0x11151b, 0.4);
    this.scene.add(hemi);

    // Directional moonbeam / chasm light
    const dirLight = new THREE.DirectionalLight(0xa9c2e4, 1.3); // cool key light
    dirLight.position.set(10, 25, 10);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 80;
    dirLight.shadow.camera.left = -15;
    dirLight.shadow.camera.right = 15;
    dirLight.shadow.camera.top = 25;
    dirLight.shadow.camera.bottom = -5;
    this.scene.add(dirLight);
    this.dirLight = dirLight;
    if ('intensity' in dirLight.shadow) dirLight.shadow.intensity = 0.5;

    // Moving headlight attached to player camera
    // Warm rim from behind the player so columns separate from the fog.
    this.rimLight = new THREE.DirectionalLight(0xff8a4a, 0.6);
    this.rimLight.position.set(0, 7, 30);
    this.scene.add(this.rimLight);

    // Kept low and ahead of the player so it paints the floor, not the gloves
    this.playerLight = new THREE.PointLight(0xff6622, 1.2, 20, 1.5);
    this.playerLight.position.set(0, 0.5, -2.4);
    this.scene.add(this.playerLight);

    // Warm rim light behind the player: makes the chasing beast readable in the
    // rear-view mirror. Created once at boot so shaders compile a single time.
    this.rearLight = new THREE.PointLight(0xffb27a, 11, 34, 2);
    this.rearLight.position.set(0, 3.0, 3.0);
    this.scene.add(this.rearLight);
  }

  setupResizeHandler() {
    window.addEventListener('resize', () => {
      this.width = this.container.clientWidth || window.innerWidth;
      this.height = this.container.clientHeight || window.innerHeight;
      this.camera.aspect = this.width / this.height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(this.width, this.height);
    });
  }

  triggerShake(amount = 0.4) {
    this.shakeIntensity = amount;
  }

  triggerHitStop(frames = 0) {
    // Punch impacts use screen shake and flash instead of visual freezing
  }

  update(playerZ, runSpeed, isJumping, isSquatting, targetLaneX, delta) {
    // Smooth lateral lane tracking (A/D or side-step)
    this.playerLaneX = targetLaneX;
    this.currentCameraX += (this.playerLaneX - this.currentCameraX) * Math.min(1.0, delta * 12.0);

    // Compute target Y height based on workout actions
    let targetY = 1.75; // Standard standing eye height
    if (isJumping) {
      targetY = 2.85; // Jump leap
    } else if (isSquatting) {
      targetY = 0.75; // Deep squat / slide drop
    }

    // Ultra-smooth, responsive vertical tracking for squats & jumps
    this.currentCameraY += (targetY - this.currentCameraY) * Math.min(1.0, delta * 16.0);

    // Running head-bobbing oscillation
    let bobY = 0;
    let bobX = 0;
    if (runSpeed > 0 && !isJumping && !isSquatting) {
      this.bobPhase += delta * runSpeed * 0.45;
      bobY = Math.sin(this.bobPhase * 2.0) * 0.05;
      bobX = Math.cos(this.bobPhase) * 0.035;
    }

    // Camera lean / roll when dodging lanes
    const lateralVel = (this.playerLaneX - this.currentCameraX);
    const targetRoll = -lateralVel * 0.08;
    this.cameraRoll += (targetRoll - this.cameraRoll) * Math.min(1.0, delta * 10.0);

    // Screen shake decay
    let shakeX = 0;
    let shakeY = 0;
    if (this.shakeIntensity > 0.005) {
      shakeX = (Math.random() - 0.5) * this.shakeIntensity;
      shakeY = (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= Math.pow(0.05, delta);
    } else {
      this.shakeIntensity = 0;
    }

    // Apply to camera
    this.camera.position.set(
      this.currentCameraX + bobX + shakeX,
      this.currentCameraY + bobY + shakeY,
      playerZ
    );

    this.camera.rotation.set(0, 0, this.cameraRoll);

    // Update player point light position
    this.playerLight.position.set(
      this.currentCameraX,
      this.currentCameraY - 0.2,
      playerZ - 1.0
    );

    // Update directional light to follow player
    if (this.dirLight) {
      this.dirLight.position.z = playerZ + 10;
      this.dirLight.target.position.z = playerZ - 20;
      this.dirLight.target.updateMatrixWorld();
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Creates the dedicated rear-view renderer inside `targetEl`. Called once when
   * a run starts; safe to call repeatedly.
   */
  initRearMirror(targetEl) {
    if (!targetEl) return;
    if (this.rearRenderer && this.rearTargetEl === targetEl) {
      this.resizeRearMirror();
      return;
    }

    if (!this.rearRenderer) {
      this.rearRenderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: 'low-power',
      });
      this.rearRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
      this.rearRenderer.outputColorSpace = this.renderer.outputColorSpace;
      this.rearRenderer.toneMapping = this.renderer.toneMapping;
      this.rearRenderer.toneMappingExposure = this.renderer.toneMappingExposure;
      this.rearRenderer.shadowMap.enabled = false;

      const canvas = this.rearRenderer.domElement;
      canvas.style.position = 'absolute';
      canvas.style.inset = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.display = 'block';
      canvas.style.borderRadius = '8px';
    }

    this.rearTargetEl = targetEl;
    targetEl.innerHTML = '';
    targetEl.appendChild(this.rearRenderer.domElement);
    this.resizeRearMirror();

    if (!this._rearResizeBound) {
      this._rearResizeBound = true;
      window.addEventListener('resize', () => this.resizeRearMirror());
    }
  }

  resizeRearMirror() {
    if (!this.rearRenderer || !this.rearTargetEl) return;
    const w = Math.max(80, Math.round(this.rearTargetEl.clientWidth || 320));
    const h = Math.max(60, Math.round(this.rearTargetEl.clientHeight || 150));
    this.rearRenderer.setSize(w, h, false);
    this.rearCamera.aspect = w / h;
    this.rearCamera.updateProjectionMatrix();
  }

  /**
   * Draws the backwards-looking view of the beast. Cheap enough to run every
   * frame: ~320x150 pixels, no shadows, no post-processing.
   */
  renderRearMirror(targetEl, beastGap = 12) {
    if (!this.mirrorEnabled) return;
    if (targetEl) this.initRearMirror(targetEl);
    if (!this.rearRenderer || !this.rearTargetEl) return;
    const cw = Math.round(this.rearTargetEl.clientWidth);
    const ch = Math.round(this.rearTargetEl.clientHeight);
    if (cw < 8 || ch < 8) return;

    // Keep the renderer in sync with the panel (it is hidden until a run starts)
    const size = this.rearRenderer.getSize(new THREE.Vector2());
    if (Math.abs(size.x - cw) > 1 || Math.abs(size.y - ch) > 1) this.resizeRearMirror();

    // Sit at the player's head, lifted slightly, looking back up the track.
    // When the beast is on your heels the mirror camera eases forward so you
    // always see the whole creature instead of a wall of chest.
    const cam = this.camera;
    const gap = Math.max(2, Math.min(30, beastGap));
    const pullBack = Math.max(0, 7.5 - gap);
    this.rearCamera.position.set(
      cam.position.x,
      cam.position.y + 0.6 + pullBack * 0.1,
      cam.position.z + 0.3 - pullBack
    );
    // Level gaze: the lens centre sits on the beast's chest so the whole
    // creature (feet, chest, horns) stays inside the strip.
    this.rearCamera.rotation.set(0, Math.PI, 0);
    this.rearCamera.updateMatrixWorld();

    // Park the warm rim light in front of the beast so it reads against the
    // dark temple. It sits behind the player, so the forward view is untouched.
    if (this.rearLight) {
      const gz = cam.position.z + Math.max(3, Math.min(18, beastGap * 0.6));
      this.rearLight.position.set(cam.position.x, cam.position.y + 2.4, gz);
    }

    this.rearRenderer.render(this.scene, this.rearCamera);
  }
}
