// ==========================================================================
// REFLEXRUN 3D - PROCEDURAL OBSTACLE SYSTEM (JUMP, SLIDE, SIDE-STEP)
// ==========================================================================

import * as THREE from 'three';

export class ObstacleManager {
  constructor(scene) {
    this.scene = scene;
    this.obstacles = [];
    this.lanes = [-2.8, 0, 2.8]; // Left, Center, Right lanes
    this.spawnDistanceAhead = 65; // Spawn 65m ahead
    this.nextSpawnZ = -30;
    this.minDistanceBetweenObstacles = 24;

    this.createSharedMaterials();
  }

  createSharedMaterials() {
    this.spikedWoodMat = new THREE.MeshStandardMaterial({
      color: 0x5c3a21,
      roughness: 0.9,
    });

    this.ironSpikeMat = new THREE.MeshStandardMaterial({
      color: 0x99aab5,
      metalness: 0.8,
      roughness: 0.3,
    });

    this.dangerGlowMat = new THREE.MeshBasicMaterial({
      color: 0xff3300,
    });

    this.bladeMat = new THREE.MeshStandardMaterial({
      color: 0xdde5ed,
      metalness: 0.95,
      roughness: 0.15,
    });

    this.stonePillarMat = new THREE.MeshStandardMaterial({
      color: 0x3d4552,
      roughness: 0.85,
    });
  }

  // 1. Spiked Hurdle Log (Requires JUMP)
  createSpikeHurdle(z, laneIdx = null) {
    const group = new THREE.Group();
    group.obstacleType = 'JUMP';
    group.z = z;
    group.resolved = false;
    group.scored = false;

    // Span all 3 lanes or a specific lane
    const isFullWidth = (laneIdx === null);
    group.isFullWidth = isFullWidth;
    group.lane = laneIdx !== null ? this.lanes[laneIdx] : 0;
    const width = isFullWidth ? 9.2 : 2.7;

    // Main horizontal log
    const logGeo = new THREE.CylinderGeometry(0.26, 0.26, width, 14);
    const log = new THREE.Mesh(logGeo, this.spikedWoodMat);
    log.rotation.z = Math.PI / 2;
    log.position.y = 0.45;
    log.castShadow = true;
    group.add(log);
    group.rotatingLog = log;

    // Danger Spikes on log
    const spikeCount = isFullWidth ? 14 : 5;
    const spacing = width / (spikeCount + 1);
    for (let i = 1; i <= spikeCount; i++) {
      const spikeGeo = new THREE.ConeGeometry(0.13, 0.55, 6);
      const spike = new THREE.Mesh(spikeGeo, this.ironSpikeMat);
      const posX = -width / 2 + i * spacing;
      spike.position.set(posX, 0.45, 0);
      spike.rotation.x = (i % 2 === 0 ? 0.4 : -0.4);
      group.add(spike);
    }

    // Danger warning strip under hurdle
    const stripGeo = new THREE.PlaneGeometry(width, 0.4);
    const strip = new THREE.Mesh(stripGeo, this.dangerGlowMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.y = 0.02;
    group.add(strip);

    group.position.set(group.lane, 0, z);
    this.scene.add(group);
    return group;
  }

  // 2. Hanging Guillotine / Blade Arch (Requires SLIDE / SQUAT)
  createHangingBlade(z) {
    const group = new THREE.Group();
    group.obstacleType = 'SLIDE';
    group.z = z;
    group.resolved = false;
    group.scored = false;
    group.isFullWidth = true;
    group.lane = 0;

    // Overhead iron support bar
    const barGeo = new THREE.BoxGeometry(9.6, 0.3, 0.4);
    const bar = new THREE.Mesh(barGeo, this.ironSpikeMat);
    bar.position.y = 4.8;
    group.add(bar);

    // Hanging swinging blade pivot
    const pendulumGroup = new THREE.Group();
    pendulumGroup.position.set(0, 4.8, 0);

    // Support rod
    const rodGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.2);
    const rod = new THREE.Mesh(rodGeo, this.ironSpikeMat);
    rod.position.y = -1.6;
    pendulumGroup.add(rod);

    // Giant curved crescent axe blade
    const bladeGeo = new THREE.BoxGeometry(4.5, 0.8, 0.1);
    const blade = new THREE.Mesh(bladeGeo, this.bladeMat);
    blade.position.y = -3.2;
    blade.castShadow = true;
    pendulumGroup.add(blade);

    // Danger barrier: a soft red haze with two hard emissive rails, so it reads
    // as a laser line to duck under instead of a floating translucent slab.
    const laserGeo = new THREE.BoxGeometry(9.2, 1.2, 0.08);
    const laserMat = new THREE.MeshBasicMaterial({
      color: 0xff1744,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const laser = new THREE.Mesh(laserGeo, laserMat);
    laser.position.y = 1.9;
    group.add(laser);

    const railMat = new THREE.MeshBasicMaterial({ color: 0xff3355 });
    for (const ry of [1.3, 2.5]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(9.2, 0.07, 0.1), railMat);
      rail.position.y = ry;
      group.add(rail);
    }

    group.add(pendulumGroup);
    group.pendulum = pendulumGroup;

    group.position.set(0, 0, z);
    this.scene.add(group);
    return group;
  }

  // 3. Ancient Monolith / Blockade (Requires SIDE STEP)
  createPillarBlockade(z, blockedLanes) {
    const group = new THREE.Group();
    group.obstacleType = 'STEP';
    group.z = z;
    group.resolved = false;
    group.scored = false;
    group.blockedLanes = blockedLanes; // Array of lane indices, e.g. [0, 1] (blocks Left and Center)
    group.openLane = [0, 1, 2].find((i) => !blockedLanes.includes(i)) ?? 1;

    for (const laneIdx of blockedLanes) {
      const laneX = this.lanes[laneIdx];
      // Tall crumbling stone obelisk
      const pillarGeo = new THREE.BoxGeometry(2.2, 5.0, 1.8);
      const pillar = new THREE.Mesh(pillarGeo, this.stonePillarMat);
      pillar.position.set(laneX, 2.5, 0);
      pillar.castShadow = true;
      group.add(pillar);

      // Glowing danger cracks
      const crackGeo = new THREE.BoxGeometry(0.1, 3.5, 1.85);
      const crack = new THREE.Mesh(crackGeo, this.dangerGlowMat);
      crack.position.set(laneX, 2.5, 0);
      group.add(crack);
    }

    group.position.set(0, 0, z);
    this.scene.add(group);
    return group;
  }

  createNailStrip(z, lanes = [1]) {
    const group = new THREE.Group();
    group.obstacleType = 'JUMP'; group.z = z; group.resolved = false; group.scored = false;
    group.blockedLanes = lanes;
    for (const idx of lanes) {
      const x = this.lanes[idx];
      const bed = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.1, 1.15), this.dangerGlowMat);
      bed.position.set(x, 0.06, 0); group.add(bed);
      for (let i = 0; i < 7; i++) {
        const nail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.48, 5), this.ironSpikeMat);
        nail.position.set(x - 1.05 + i * 0.35, 0.32, 0); group.add(nail);
      }
    }
    group.position.z = z; this.scene.add(group); return group;
  }

  createPhaseGhost(z, laneIdx) {
    const group = new THREE.Group(); group.obstacleType = 'GHOST'; group.z = z;
    group.resolved = false; group.scored = false; group.phase = Math.random() * Math.PI * 2;
    group.laneIdx = laneIdx; group.visiblePhase = true;
    const mat = new THREE.MeshBasicMaterial({ color: 0x9af7ff, transparent: true, opacity: 0.48, wireframe: true });
    const ghost = new THREE.Mesh(new THREE.OctahedronGeometry(1.15, 1), mat); ghost.position.y = 1.7; group.add(ghost);
    const glow = new THREE.PointLight(0x65eaff, 1.5, 6); glow.position.y = 1.7; group.add(glow);
    group.ghostMesh = ghost; group.position.set(this.lanes[laneIdx], 0, z); this.scene.add(group); return group;
  }

  createCombo(z, barLane, nailLane) {
    const group = new THREE.Group(); group.obstacleType = 'COMBO'; group.z = z;
    group.resolved = false; group.scored = false;
    group.actions = [{ lane: barLane, type: 'SLIDE' }, { lane: nailLane, type: 'JUMP' }];
    // A third lane is intentionally left open as the fair route.
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.34, 0.45), this.ironSpikeMat);
    bar.position.set(this.lanes[barLane], 1.45, 0); group.add(bar);
    for (let i = 0; i < 7; i++) {
      const nail = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.5, 5), this.ironSpikeMat);
      nail.position.set(this.lanes[nailLane] - 1.0 + i * 0.34, 0.3, 0); group.add(nail);
    }
    const warning = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.06, 0.08), this.dangerGlowMat);
    warning.position.set(this.lanes[barLane], 1.18, 0); group.add(warning);
    group.position.z = z; this.scene.add(group); return group;
  }

  update(playerZ, playerLaneX, isJumping, isSquatting, delta, onObstacleEvent, distance = 0, score = 0) {
    // 1. Procedurally spawn obstacles ahead.
    // Spacing tightens gradually with distance travelled so the course ramps up.
    if (playerZ - this.spawnDistanceAhead < this.nextSpawnZ) {
      this.spawnNextObstacle(this.nextSpawnZ, distance, score);
      const travelled = Math.max(0, -playerZ);
      const gap = Math.max(18, this.minDistanceBetweenObstacles - travelled * 0.012);
      this.nextSpawnZ -= gap + Math.random() * 8;
    }

    // 2. Animate and check collisions for all active obstacles
    for (let i = this.obstacles.length - 1; i >= 0; i--) {
      const obs = this.obstacles[i];

      // Obstacle specific animations
      if (obs.rotatingLog) {
        obs.rotatingLog.rotation.x += delta * 6.0;
      }
      if (obs.pendulum) {
        obs.pendulum.rotation.z = Math.sin(Date.now() * 0.0035) * 0.45;
      }

      // Check collision window (|obs.z - playerZ| <= 1.2m)
      const distToPlayer = obs.z - playerZ;
      if (obs.obstacleType === 'GHOST') {
        obs.phase += delta * 2.1;
        const alpha = 0.12 + (Math.sin(obs.phase) + 1) * 0.31;
        obs.ghostMesh.material.opacity = alpha;
        obs.visiblePhase = Math.sin(obs.phase) > -0.35;
        obs.ghostMesh.rotation.y += delta * 0.9;
      }

      // When obstacle is in front approaching, trigger cue notification.
      // distToPlayer is negative while the obstacle is still ahead of you.
      // Only the NEAREST unresolved obstacle may cue, otherwise a later
      // obstacle overwrites the warning for the one you are about to hit.
      if (distToPlayer > -32 && distToPlayer < -14 && !obs.cued) {
        const nearestAhead = this.obstacles
          .filter((o) => !o.resolved && o.z < playerZ)
          .sort((a, b) => b.z - a.z)[0];
        if (!nearestAhead || nearestAhead === obs) {
          obs.cued = true;
          if (onObstacleEvent) {
            onObstacleEvent('APPROACHING', obs.obstacleType, obs);
          }
        }
      }

      // Collision trigger zone
      if (Math.abs(distToPlayer) < 1.1 && !obs.resolved) {
        let isHit = false;

        if (obs.obstacleType === 'JUMP') {
          // Player must be jumping
          const playerLaneIdx = this.getClosestLaneIndex(playerLaneX);
          if (obs.blockedLanes && !obs.blockedLanes.includes(playerLaneIdx)) { obs.scored = true; }
          else if (!isJumping) {
            isHit = true;
          } else {
            obs.scored = true;
          }
        } else if (obs.obstacleType === 'SLIDE') {
          // Player must be squatting/sliding
          if (!isSquatting) {
            isHit = true;
          } else {
            obs.scored = true;
          }
        } else if (obs.obstacleType === 'STEP') {
          // Check if player is in one of the blocked lanes
          const playerLaneIdx = this.getClosestLaneIndex(playerLaneX);
          if (obs.blockedLanes.includes(playerLaneIdx)) {
            isHit = true;
          } else {
            obs.scored = true;
          }
        } else if (obs.obstacleType === 'GHOST') {
          const inLane = this.getClosestLaneIndex(playerLaneX) === obs.laneIdx;
          isHit = inLane && obs.visiblePhase;
          if (!isHit) obs.scored = true;
        } else if (obs.obstacleType === 'COMBO') {
          const lane = this.getClosestLaneIndex(playerLaneX);
          const action = obs.actions.find((item) => item.lane === lane);
          if (action) isHit = action.type === 'JUMP' ? !isJumping : !isSquatting;
          if (!action || !isHit) obs.scored = true;
        }

        obs.resolved = true;
        if (onObstacleEvent) {
          if (isHit) {
            onObstacleEvent('HIT', obs.obstacleType, obs);
          } else {
            onObstacleEvent('SUCCESS', obs.obstacleType, obs);
          }
        }
      }

      // Clean up obstacles far behind player (more than 15m behind)
      if (obs.z > playerZ + 15) {
        this.scene.remove(obs);
        this.obstacles.splice(i, 1);
      }
    }
  }

  getClosestLaneIndex(x) {
    let closestIdx = 1;
    let minDist = 999;
    for (let i = 0; i < this.lanes.length; i++) {
      const dist = Math.abs(x - this.lanes[i]);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = i;
      }
    }
    return closestIdx;
  }

  removeObstacle(obstacle) {
    const index = this.obstacles.indexOf(obstacle);
    if (index < 0) return;
    this.scene.remove(obstacle);
    this.obstacles.splice(index, 1);
  }

  spawnNextObstacle(z, distance = 0, score = 0) {
    // Choose random obstacle type
    const roll = Math.random();
    let obs = null;

    if (distance >= 230 && Math.random() < 0.15) {
      obs = this.createPhaseGhost(z, Math.floor(Math.random() * 3));
    } else if (distance >= 300 && Math.random() < 0.16) {
      const barLane = Math.floor(Math.random() * 3);
      const nailLane = (barLane + 1) % 3;
      obs = this.createCombo(z, barLane, nailLane);
    } else if (distance >= 120 && roll < 0.28) {
      const nailLane = Math.floor(Math.random() * 3);
      obs = this.createNailStrip(z, Math.random() < 0.25 ? [nailLane, (nailLane + 1) % 3] : [nailLane]);
    } else if (roll < 0.35) {
      // JUMP Hurdle
      obs = this.createSpikeHurdle(z);
    } else if (roll < 0.70) {
      // SLIDE Guillotine
      obs = this.createHangingBlade(z);
    } else {
      // SIDE STEP (blocks 1 or 2 lanes, leaving at least 1 lane open)
      const blockPattern = Math.random();
      let blocked = [];
      if (blockPattern < 0.33) {
        blocked = [0, 1]; // Only Right lane open
      } else if (blockPattern < 0.66) {
        blocked = [1, 2]; // Only Left lane open
      } else {
        blocked = [0, 2]; // Only Center lane open
      }
      obs = this.createPillarBlockade(z, blocked);
    }

    this.obstacles.push(obs);
  }

  reset() {
    for (const obs of this.obstacles) {
      this.scene.remove(obs);
    }
    this.obstacles = [];
    this.nextSpawnZ = -30;
  }
}
