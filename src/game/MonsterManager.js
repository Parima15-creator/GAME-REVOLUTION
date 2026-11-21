// ==========================================================================
// REFLEXRUN 3D - 3D MONSTER COMBAT & SHATTER DESTRUCTION ENGINE
// ==========================================================================

import * as THREE from 'three';

export class MonsterManager {
  constructor(scene) {
    this.scene = scene;
    this.monsters = [];
    this.shards = [];
    this.lanes = [-2.8, 0, 2.8];
    this.nextSpawnZ = -45;
    this.minDistanceBetweenMonsters = 38;

    this.createMonsterMaterials();
  }

  createMonsterMaterials() {
    this.golemBodyMat = new THREE.MeshStandardMaterial({
      color: 0x4a4a55, // volcanic rock: dark, but light enough to hold a silhouette
      roughness: 0.92,
      metalness: 0.05,
      emissive: 0x2a0d06, // faint heat from inside the rock
      emissiveIntensity: 0.55,
    });

    this.golemMagmaMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
    });

    this.golemEyeMat = new THREE.MeshBasicMaterial({
      color: 0xffea00,
    });

    this.shardMat = new THREE.MeshStandardMaterial({
      color: 0x2b323d,
      roughness: 0.8,
      metalness: 0.2,
    });

    // Pre-allocated shared geometries for zero-allocation, zero-lag shatter explosions
    this.shardGeos = [
      new THREE.DodecahedronGeometry(0.32, 0),
      new THREE.DodecahedronGeometry(0.24, 0),
      new THREE.BoxGeometry(0.32, 0.32, 0.32),
      new THREE.TetrahedronGeometry(0.36, 0),
    ];

    // Pre-allocated object pool for rock shards: 100% zero runtime GC allocation & zero GPU stutter
    this.shardPool = [];
    this.shardPoolSize = 32;
    for (let i = 0; i < this.shardPoolSize; i++) {
      const geo = this.shardGeos[i % this.shardGeos.length];
      const isGlowing = (i % 3 === 0);
      const mat = isGlowing ? this.golemMagmaMat : this.shardMat;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.shardPool.push({
        mesh,
        velocity: new THREE.Vector3(),
        rotSpeed: new THREE.Vector3(),
        life: 0,
        active: false,
      });
    }
  }

  // Create detailed 3D Magma Golem
  createMagmaGolem(laneIdx, z) {
    const group = new THREE.Group();
    group.laneIdx = laneIdx;
    group.z = z;
    group.alive = true;
    group.walkCycle = Math.random() * Math.PI * 2;

    // 1. Torso
    const torsoGeo = new THREE.BoxGeometry(1.6, 1.8, 1.2);
    const torso = new THREE.Mesh(torsoGeo, this.golemBodyMat);
    torso.position.y = 2.0;
    torso.castShadow = true;
    group.add(torso);

    // Magma Core in chest
    const coreGeo = new THREE.BoxGeometry(0.42, 0.72, 0.12);
    const core = new THREE.Mesh(coreGeo, this.golemMagmaMat);
    core.position.set(0, 2.05, 0.62);
    group.add(core);
    group.core = core;

    // Shoulder plates break up the box silhouette
    const plateGeo = new THREE.BoxGeometry(0.55, 0.4, 1.05);
    const plateL = new THREE.Mesh(plateGeo, this.golemBodyMat);
    plateL.position.set(-0.72, 2.78, 0);
    plateL.rotation.z = 0.18;
    group.add(plateL);
    const plateR = plateL.clone();
    plateR.position.x = 0.72;
    plateR.rotation.z = -0.18;
    group.add(plateR);

    // 2. Horned Head
    const headGeo = new THREE.BoxGeometry(1.0, 0.9, 0.9);
    const head = new THREE.Mesh(headGeo, this.golemBodyMat);
    head.position.set(0, 3.2, 0);
    head.castShadow = true;
    group.add(head);

    // Glowing Eyes
    const eyeL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.1), this.golemEyeMat);
    eyeL.position.set(-0.25, 3.25, 0.46);
    group.add(eyeL);

    const eyeR = eyeL.clone();
    eyeR.position.x = 0.25;
    group.add(eyeR);

    // Magma Horns
    const hornGeo = new THREE.ConeGeometry(0.18, 0.7, 5);
    const hornL = new THREE.Mesh(hornGeo, this.golemMagmaMat);
    hornL.position.set(-0.45, 3.8, 0);
    hornL.rotation.z = 0.4;
    group.add(hornL);

    const hornR = hornL.clone();
    hornR.position.x = 0.45;
    hornR.rotation.z = -0.4;
    group.add(hornR);

    // 3. Heavy Armored Arms
    const armGeo = new THREE.BoxGeometry(0.6, 1.8, 0.7);
    const armL = new THREE.Mesh(armGeo, this.golemBodyMat);
    armL.position.set(-1.25, 1.8, 0);
    armL.castShadow = true;
    group.add(armL);
    group.armL = armL;

    const armR = armL.clone();
    armR.position.x = 1.25;
    group.add(armR);
    group.armR = armR;

    // Target reticle: four thin corner brackets, not a filled orange ring.
    // The old ring read as a "no entry" sign pinned to the middle of the track.
    const reticle = new THREE.Group();
    const bracketMat = new THREE.MeshBasicMaterial({
      color: 0xff5a1f,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    const armLen = 0.34;
    const armThick = 0.055;
    const half = 0.62;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(armLen, armThick, 0.01), bracketMat);
      h.position.set(sx * (half - armLen / 2), sy * half, 0);
      reticle.add(h);
      const v = new THREE.Mesh(new THREE.BoxGeometry(armThick, armLen, 0.01), bracketMat);
      v.position.set(sx * half, sy * (half - armLen / 2), 0);
      reticle.add(v);
    }
    reticle.position.set(0, 2.15, 0.72);
    group.add(reticle);
    group.reticle = reticle;

    // Point light radiating from monster
    const glow = new THREE.PointLight(0xff4a10, 1.1, 9, 1.8);
    glow.position.set(0, 2.0, 0.5);
    group.add(glow);

    group.position.set(this.lanes[laneIdx], 0, z);
    this.scene.add(group);
    return group;
  }

  // Shatter Golem into exploding 3D fragments (zero allocation runtime)
  shatterMonster(monster) {
    monster.alive = false;
    const origin = monster.position.clone();
    origin.y += 2.0;

    // Remove original model
    this.scene.remove(monster);

    // Activate up to 16 pooled rock shards (zero allocation, zero hitch!)
    let spawned = 0;
    for (let i = 0; i < this.shardPool.length && spawned < 16; i++) {
      const shard = this.shardPool[i];
      if (shard.active) continue;

      const scale = 0.75 + Math.random() * 0.55;
      shard.mesh.scale.set(scale, scale, scale);
      shard.mesh.position.copy(origin);
      shard.mesh.position.x += (Math.random() - 0.5) * 1.1;
      shard.mesh.position.y += (Math.random() - 0.5) * 1.1;

      // Random explosion velocity (bursting forward, up, and outward)
      const speed = 7.0 + Math.random() * 8.0;
      const angleX = (Math.random() - 0.5) * 2.0;
      const angleY = 0.6 + Math.random() * 1.2;
      const angleZ = -0.5 - Math.random() * 1.5; // Fly backwards towards depth

      shard.velocity.set(angleX, angleY, angleZ).normalize().multiplyScalar(speed);
      shard.rotSpeed.set(
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12,
        (Math.random() - 0.5) * 12
      );
      shard.life = 0.95;
      shard.active = true;
      shard.mesh.visible = true;
      spawned++;
    }
  }

  // Try to hit any monster near the player's punch
  checkPunchHit(playerZ, playerLaneX) {
    for (let i = 0; i < this.monsters.length; i++) {
      const monster = this.monsters[i];
      if (!monster.alive) continue;

      const distZ = monster.z - playerZ;
      // Generous punch range: from 7.5m ahead to 1.8m close-quarters
      if (distZ > -7.5 && distZ < 1.8) {
        const monsterLaneX = this.lanes[monster.laneIdx];
        const lateralDist = Math.abs(monsterLaneX - playerLaneX);

        // Can punch monster in current lane or adjacent lane reach
        if (lateralDist <= 3.2) {
          this.shatterMonster(monster);
          this.monsters.splice(i, 1);
          return true; // Successfully punched monster!
        }
      }
    }
    return false;
  }

  update(playerZ, playerLaneX, delta, onMonsterEvent) {
    // 1. Procedurally spawn monsters ahead
    if (playerZ - 70 < this.nextSpawnZ) {
      const randomLane = Math.floor(Math.random() * 3);
      const monster = this.createMagmaGolem(randomLane, this.nextSpawnZ);
      this.monsters.push(monster);
      this.nextSpawnZ -= this.minDistanceBetweenMonsters + Math.random() * 14;
    }

    // 2. Animate and track active monsters
    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const monster = this.monsters[i];
      if (!monster.alive) continue;

      // Charge forward towards player slightly
      monster.walkCycle += delta * 7.0;
      monster.z += delta * 3.0; // Moves towards player
      monster.position.z = monster.z;

      // Arm swing animation
      if (monster.armL && monster.armR) {
        monster.armL.rotation.x = Math.sin(monster.walkCycle) * 0.45;
        monster.armR.rotation.x = -Math.sin(monster.walkCycle) * 0.45;
      }

      // Reticle pulse & spin
      if (monster.reticle) {
        monster.reticle.rotation.z += delta * 3.0;
        const scale = 1.0 + Math.sin(monster.walkCycle * 2) * 0.15;
        monster.reticle.scale.set(scale, scale, 1.0);
      }

      const distToPlayer = monster.z - playerZ;

      // Monster approaching cue (distToPlayer is negative while it is ahead)
      if (distToPlayer > -28 && distToPlayer < -10 && !monster.cued) {
        monster.cued = true;
        if (onMonsterEvent) {
          onMonsterEvent('APPROACHING', monster);
        }
      }

      // Player let the golem slip past in another lane — clear the prompt
      if (!monster.passed && distToPlayer > 1.8) {
        monster.passed = true;
        if (onMonsterEvent) {
          onMonsterEvent('PASSED', monster);
        }
      }

      // Collision hit if player didn't punch in time.
      // This must stay a tight close-range window: with no upper bound the monster
      // "attacked" the player the instant it spawned 45m away.
      const MONSTER_REACH = 1.8;
      if (monster.alive && distToPlayer > -MONSTER_REACH && distToPlayer < MONSTER_REACH) {
        const monsterLaneX = this.lanes[monster.laneIdx];
        const playerInLane = Math.abs(monsterLaneX - playerLaneX) < 1.5;

        if (playerInLane) {
          // Monster hits player!
          monster.alive = false;
          this.scene.remove(monster);
          this.monsters.splice(i, 1);
          if (onMonsterEvent) {
            onMonsterEvent('ATTACK', monster);
          }
          continue;
        }
      }

      // Clean up past monsters
      if (monster.z > playerZ + 15) {
        this.scene.remove(monster);
        this.monsters.splice(i, 1);
      }
    }

    // 3. Update exploding shatter shards physics (zero allocation loop)
    if (this.shardPool) {
      for (let i = 0; i < this.shardPool.length; i++) {
        const shard = this.shardPool[i];
        if (!shard.active) continue;

        shard.life -= delta * 1.5;

        // Gravity and movement
        shard.velocity.y -= 18.0 * delta; // Gravity
        shard.mesh.position.addScaledVector(shard.velocity, delta);

        // Rotation
        shard.mesh.rotation.x += shard.rotSpeed.x * delta;
        shard.mesh.rotation.y += shard.rotSpeed.y * delta;
        shard.mesh.rotation.z += shard.rotSpeed.z * delta;

        // Bounce on floor (y = 0.2)
        if (shard.mesh.position.y < 0.2) {
          shard.mesh.position.y = 0.2;
          shard.velocity.y = -shard.velocity.y * 0.4; // Bounce damping
          shard.velocity.x *= 0.7;
          shard.velocity.z *= 0.7;
        }

        // Hide when expired (zero garbage collection)
        if (shard.life <= 0) {
          shard.active = false;
          shard.mesh.visible = false;
        }
      }
    }
  }

  reset() {
    for (const m of this.monsters) {
      this.scene.remove(m);
    }
    this.monsters = [];

    if (this.shardPool) {
      for (const s of this.shardPool) {
        s.active = false;
        s.mesh.visible = false;
      }
    }
    this.shards = [];
    this.nextSpawnZ = -45;
  }
}
