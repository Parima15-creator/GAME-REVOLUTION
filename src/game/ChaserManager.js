// ==========================================================================
// REFLEXRUN 3D - THE BEAST THAT HUNTS YOU (endless-runner chaser)
// Lives behind the player, creeps closer over time, lunges on mistakes and
// gets shoved back every time you clear an obstacle cleanly.
// ==========================================================================

import * as THREE from 'three';

export const CHASE = {
  START_GAP: 12,      // metres behind the player at the start of a run
  MAX_GAP: 22,        // it never falls further behind than this
  CATCH_GAP: 2.2,     // reaches this -> you are caught
  CREEP: 0.28,        // passive m/s the gap closes while running
  SPEED_CREEP: 0.05,  // extra creep per m/s above the base run speed
  HIT_LUNGE: 3.4,     // gap lost when you collide with an obstacle
  CLEAR_PUSH: 0.9,    // gap regained when you clear something cleanly
  KILL_PUSH: 1.8,     // extra gap regained when you shatter a golem
};

export class ChaserManager {
  constructor(scene) {
    this.scene = scene;
    this.gap = CHASE.START_GAP;
    this.laneX = 0;
    this.cycle = 0;
    this.visibility = 0;
    this.caught = false;

    this.group = new THREE.Group();
    this.buildBeast();
    this.group.visible = false;
    this.scene.add(this.group);
  }

  buildBeast() {
    const hide = new THREE.MeshStandardMaterial({
      color: 0x1b212b,
      roughness: 0.9,
      metalness: 0.1,
      emissive: 0x180703,
      emissiveIntensity: 0.9,
    });
    const plate = new THREE.MeshStandardMaterial({
      color: 0x2a3341,
      roughness: 0.7,
      metalness: 0.3,
      emissive: 0x220a04,
      emissiveIntensity: 0.8,
    });
    const magma = new THREE.MeshBasicMaterial({ color: 0xff2d00 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffe066 });

    this.bodyMatRefs = [hide, plate, magma];

    // ---- Torso -------------------------------------------------------------
    const torso = new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.7, 3.4), hide);
    torso.position.set(0, 2.05, 0);
    torso.castShadow = true;
    this.group.add(torso);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.2, 2.2), plate);
    chest.position.set(0, 2.25, -0.9);
    this.group.add(chest);

    // Magma cracks glowing through the hide
    for (let i = 0; i < 4; i++) {
      const crack = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.7 + Math.random() * 0.5, 0.1), magma);
      crack.position.set(-0.7 + i * 0.45, 2.2 + Math.random() * 0.3, -2.02);
      this.group.add(crack);
    }

    // ---- Head --------------------------------------------------------------
    const head = new THREE.Group();
    head.position.set(0, 2.85, -2.35);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.05, 1.5), hide);
    head.add(skull);

    const snout = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.55, 0.7), plate);
    snout.position.set(0, -0.22, -0.95);
    head.add(snout);

    // Eyes
    const eyeGeo = new THREE.BoxGeometry(0.26, 0.13, 0.08);
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
    eyeL.position.set(-0.33, 0.16, -0.78);
    head.add(eyeL);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.33;
    head.add(eyeR);
    this.eyes = [eyeL, eyeR];

    // Horns
    const hornGeo = new THREE.ConeGeometry(0.17, 0.95, 5);
    const hornL = new THREE.Mesh(hornGeo, plate);
    hornL.position.set(-0.5, 0.75, 0.1);
    hornL.rotation.z = 0.35;
    head.add(hornL);
    const hornR = new THREE.Mesh(hornGeo, plate);
    hornR.position.set(0.5, 0.75, 0.1);
    hornR.rotation.z = -0.35;
    head.add(hornR);

    // Teeth
    const toothGeo = new THREE.ConeGeometry(0.07, 0.24, 4);
    for (let i = 0; i < 6; i++) {
      const tooth = new THREE.Mesh(toothGeo, eyeMat);
      tooth.position.set(-0.4 + i * 0.16, -0.42, -1.28);
      tooth.rotation.x = Math.PI;
      head.add(tooth);
    }

    this.head = head;
    this.group.add(head);

    // ---- Back spikes -------------------------------------------------------
    const spikeGeo = new THREE.ConeGeometry(0.22, 0.85, 5);
    for (let i = 0; i < 5; i++) {
      const spike = new THREE.Mesh(spikeGeo, plate);
      spike.position.set(0, 3.0 - i * 0.03, -1.1 + i * 0.62);
      spike.rotation.x = -0.35;
      this.group.add(spike);
    }

    // ---- Legs (4 animated) -------------------------------------------------
    this.legs = [];
    const upperGeo = new THREE.BoxGeometry(0.42, 1.35, 0.42);
    const lowerGeo = new THREE.BoxGeometry(0.34, 1.1, 0.34);
    const legOffsets = [
      [-0.85, -1.15], [0.85, -1.15], [-0.85, 1.15], [0.85, 1.15],
    ];
    for (const [x, z] of legOffsets) {
      const pivot = new THREE.Group();
      pivot.position.set(x, 1.55, z);

      const upper = new THREE.Mesh(upperGeo, hide);
      upper.position.y = -0.55;
      upper.castShadow = true;
      pivot.add(upper);

      const knee = new THREE.Group();
      knee.position.y = -1.2;
      const lower = new THREE.Mesh(lowerGeo, hide);
      lower.position.y = -0.5;
      knee.add(lower);

      const claw = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.35, 4), plate);
      claw.position.set(0, -1.15, -0.15);
      claw.rotation.x = Math.PI / 2;
      knee.add(claw);

      pivot.add(knee);
      this.group.add(pivot);
      this.legs.push({ pivot, knee, phase: z > 0 ? Math.PI : 0 });
    }

    // ---- Glow --------------------------------------------------------------
    this.glow = new THREE.PointLight(0xff3a00, 0, 14, 1.6);
    this.glow.position.set(0, 2.2, -1.6);
    this.group.add(this.glow);

    // Additive aura so the beast reads as a silhouette in the mirror
    const auraCanvas = document.createElement('canvas');
    auraCanvas.width = auraCanvas.height = 64;
    const actx = auraCanvas.getContext('2d');
    const grad = actx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 70, 0, 0.55)');
    grad.addColorStop(1, 'rgba(255, 40, 0, 0)');
    actx.fillStyle = grad;
    actx.fillRect(0, 0, 64, 64);
    const auraMat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(auraCanvas),
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    const aura = new THREE.Sprite(auraMat);
    aura.scale.set(7, 6, 1);
    aura.position.set(0, 2.2, -1.2);
    this.group.add(aura);
  }

  reset() {
    this.gap = CHASE.START_GAP;
    this.laneX = 0;
    this.cycle = 0;
    this.caught = false;
    this.group.visible = false;
    this.glow.intensity = 0;
  }

  /** A collision: the beast lunges forward. */
  lunge(metres = CHASE.HIT_LUNGE) {
    this.gap = Math.max(0.6, this.gap - metres);
  }

  /** A clean dodge/kill: shove it back. */
  pushBack(metres = CHASE.CLEAR_PUSH) {
    this.gap = Math.min(CHASE.MAX_GAP, this.gap + metres);
  }

  isDangerous() {
    return this.gap <= CHASE.CATCH_GAP + 3.5;
  }

  /** 0 = far away, 1 = right on your heels. */
  closeness() {
    const t = 1 - Math.min(1, Math.max(0, (this.gap - CHASE.CATCH_GAP) / (CHASE.MAX_GAP - CHASE.CATCH_GAP)));
    return t;
  }

  update(playerZ, playerLaneX, runSpeed, delta, active) {
    if (active) {
      const speedFactor = Math.max(0, runSpeed - 10.5) * CHASE.SPEED_CREEP;
      this.gap -= (CHASE.CREEP + speedFactor) * delta;
    }

    if (this.caught) {
      // Final lunge animation straight into the camera
      this.gap = Math.max(0, this.gap - 22 * delta);
    }

    this.gap = Math.max(0, Math.min(CHASE.MAX_GAP, this.gap));

    // Lateral tracking: the beast mirrors your lane, with a lag so dodging feels
    // like you actually gained ground on it.
    this.laneX += (playerLaneX - this.laneX) * Math.min(1, delta * 1.8);

    this.cycle += delta * (6 + (1 - this.closeness()) * 6);

    this.group.position.set(this.laneX, 0, playerZ + this.gap);
    // The model is built facing -Z (head/snout/eyes on the negative side), and
    // the player is at a lower Z, so no yaw is needed to look straight at you.
    this.group.rotation.y = 0;

    // Visibility: fade in inside the mirror range
    const visible = this.gap < 34;
    this.group.visible = visible;
    if (visible) {
      const fade = Math.min(1, (34 - this.gap) / 8);
      this.group.scale.setScalar(0.9 + fade * 0.15);
      this.glow.intensity = 0.8 + this.closeness() * 2.6;

      // Gallop animation
      for (let i = 0; i < this.legs.length; i++) {
        const leg = this.legs[i];
        const swing = Math.sin(this.cycle + leg.phase);
        leg.pivot.rotation.x = swing * 0.55;
        leg.knee.rotation.x = Math.max(0, -swing) * 0.7;
      }
      this.group.position.y = Math.abs(Math.sin(this.cycle * 0.9)) * 0.12;

      if (this.head) {
        this.head.rotation.x = Math.sin(this.cycle * 0.7) * 0.08;
        this.head.rotation.z = Math.sin(this.cycle * 0.5) * 0.06;
      }
      if (this.eyes) {
        const pulse = 0.7 + Math.abs(Math.sin(this.cycle * 2)) * 0.3;
        this.eyes.forEach((e) => e.scale.setScalar(pulse));
      }
    } else {
      this.glow.intensity = 0;
    }
  }
}
