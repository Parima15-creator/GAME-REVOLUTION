// ==========================================================================
// REFLEXRUN 3D - PROCEDURAL ANCIENT TEMPLE / CHASM ENVIRONMENT
// ==========================================================================

import * as THREE from 'three';

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.segmentLength = 24; // 24m per modular segment
    this.totalSegments = 8;
    this.segments = [];
    this.currentFrontZ = 0;

    this.createProceduralTextures();
    this.initEnvironment();
    this.createAtmosphericEmbers();
  }

  createProceduralTextures() {
    // 1. Procedural Stone Floor Texture
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');

    // Base granite (a touch lighter so the track is readable at speed)
    ctx.fillStyle = '#1f242d';
    ctx.fillRect(0, 0, 512, 512);

    // Stone tile grid lines
    ctx.strokeStyle = '#141922';
    ctx.lineWidth = 6;
    for (let x = 0; x <= 512; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, 512);
      ctx.stroke();
    }
    for (let y = 0; y <= 512; y += 64) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
    }

    // Noise speckles & worn edges
    for (let i = 0; i < 4000; i++) {
      const px = Math.random() * 512;
      const py = Math.random() * 512;
      const val = Math.floor(Math.random() * 40 + 20);
      ctx.fillStyle = `rgb(${val},${val + 4},${val + 10})`;
      ctx.fillRect(px, py, 2, 2);
    }

    // Glowing subtle rune lines on floor
    ctx.strokeStyle = 'rgba(255, 120, 40, 0.15)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(256, 0);
    ctx.lineTo(256, 512);
    ctx.stroke();

    this.floorTexture = new THREE.CanvasTexture(canvas);
    this.floorTexture.wrapS = THREE.RepeatWrapping;
    this.floorTexture.wrapT = THREE.RepeatWrapping;
    this.floorTexture.repeat.set(2, 4);

    // 2. Procedural Carved Stone Wall Texture
    const wallCanvas = document.createElement('canvas');
    wallCanvas.width = 256;
    wallCanvas.height = 256;
    const wCtx = wallCanvas.getContext('2d');
    wCtx.fillStyle = '#262d38';
    wCtx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 2000; i++) {
      const wx = Math.random() * 256;
      const wy = Math.random() * 256;
      const c = Math.floor(Math.random() * 30 + 30);
      wCtx.fillStyle = `rgb(${c},${c},${c + 4})`;
      wCtx.fillRect(wx, wy, 2, 2);
    }
    this.wallTexture = new THREE.CanvasTexture(wallCanvas);
    this.wallTexture.wrapS = THREE.RepeatWrapping;
    this.wallTexture.wrapT = THREE.RepeatWrapping;
    // 1 x 4 stretched a 256px tile across 24 m of wall, which smeared into
    // diagonal streaks. 6 x 2 gives roughly 4 m stones.
    this.wallTexture.repeat.set(6, 2);

    // Shared materials
    this.floorMaterial = new THREE.MeshStandardMaterial({
      map: this.floorTexture,
      roughness: 0.55, // slight sheen: reads as polished temple stone
      metalness: 0.25,
    });

    this.wallMaterial = new THREE.MeshStandardMaterial({
      map: this.wallTexture,
      roughness: 0.85,
      metalness: 0.1,
    });

    this.columnMaterial = new THREE.MeshStandardMaterial({
      color: 0x333b47,
      roughness: 0.7,
      metalness: 0.2,
    });

    this.flameMaterial = new THREE.MeshBasicMaterial({
      color: 0xff7711,
    });

    this.torchGlowMaterial = new THREE.SpriteMaterial({
      map: this.createGlowTexture(),
      color: 0xffaa55,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
  }

  // Soft radial glow texture (one shared texture for every torch)
  createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 210, 150, 0.95)');
    grad.addColorStop(0.35, 'rgba(255, 140, 40, 0.45)');
    grad.addColorStop(1, 'rgba(255, 90, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
  }

  initEnvironment() {
    this.environmentGroup = new THREE.Group();
    this.scene.add(this.environmentGroup);

    // Pre-build modular segments stretching forward
    for (let i = 0; i < this.totalSegments; i++) {
      const zPos = -i * this.segmentLength;
      const segment = this.buildSegment(zPos);
      this.segments.push(segment);
      this.environmentGroup.add(segment);
      this.currentFrontZ = zPos;
    }
  }

  buildSegment(z) {
    const group = new THREE.Group();
    group.position.z = z;

    // Floor track (width: 9m, length: 24m)
    const floorGeo = new THREE.PlaneGeometry(9.6, this.segmentLength);
    const floorMesh = new THREE.Mesh(floorGeo, this.floorMaterial);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0;
    floorMesh.receiveShadow = true;
    group.add(floorMesh);

    // Ceiling: without it the arch tops opened onto flat black and the tunnel
    // read as an unfinished void.
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(11.4, this.segmentLength),
      this.wallMaterial
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = 9.6;
    group.add(ceil);

    // Glowing lane dividers: the cheapest way to sell forward speed
    const dividerMat = new THREE.MeshBasicMaterial({
      color: 0xffa257,
      transparent: true,
      opacity: 0.32,
      fog: true,
    });
    for (const dx of [-1.4, 1.4]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.012, this.segmentLength - 2), dividerMat);
      strip.position.set(dx, 0.02, 0);
      group.add(strip);
    }
    // Bright lane edges
    for (const dx of [-4.55, 4.55]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, this.segmentLength - 2), dividerMat);
      strip.position.set(dx, 0.02, 0);
      group.add(strip);
    }

    // Lane border curbs
    const curbGeo = new THREE.BoxGeometry(0.5, 0.4, this.segmentLength);
    const leftCurb = new THREE.Mesh(curbGeo, this.columnMaterial);
    leftCurb.position.set(-4.8, 0.2, 0);
    group.add(leftCurb);

    const rightCurb = leftCurb.clone();
    rightCurb.position.x = 4.8;
    group.add(rightCurb);

    // Side temple walls with carved reliefs
    const wallGeo = new THREE.BoxGeometry(1.2, 9, this.segmentLength);
    const leftWall = new THREE.Mesh(wallGeo, this.wallMaterial);
    leftWall.position.set(-5.6, 4.5, 0);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    group.add(leftWall);

    const rightWall = new THREE.Mesh(wallGeo, this.wallMaterial);
    rightWall.position.set(5.6, 4.5, 0);
    rightWall.castShadow = true;
    rightWall.receiveShadow = true;
    group.add(rightWall);

    // Stone Pillars & Archways
    const archInterval = 12;
    for (let offset = -this.segmentLength / 2 + 6; offset < this.segmentLength / 2; offset += archInterval) {
      // Left Column
      const colGeo = new THREE.CylinderGeometry(0.45, 0.55, 8, 8);
      const colL = new THREE.Mesh(colGeo, this.columnMaterial);
      colL.position.set(-4.6, 4, offset);
      colL.castShadow = true;
      group.add(colL);

      // Right Column
      const colR = colL.clone();
      colR.position.x = 4.6;
      group.add(colR);

      // Overhead Stone Arch Beam
      const archGeo = new THREE.BoxGeometry(10.5, 0.9, 1.2);
      const archMesh = new THREE.Mesh(archGeo, this.columnMaterial);
      archMesh.position.set(0, 8.0, offset);
      // No shadow: the overhead beams painted huge black wedges across the walls
      archMesh.castShadow = false;
      group.add(archMesh);

      // Torch Sconces on columns
      const torchL = this.createTorch();
      torchL.position.set(-4.1, 2.6, offset);
      group.add(torchL);

      const torchR = this.createTorch();
      torchR.position.set(4.1, 2.6, offset);
      group.add(torchR);
    }

    return group;
  }

  createTorch() {
    const group = new THREE.Group();
    // Iron bracket
    const bracketGeo = new THREE.BoxGeometry(0.15, 0.4, 0.3);
    const bracket = new THREE.Mesh(bracketGeo, this.columnMaterial);
    group.add(bracket);

    // Flame: a tapered cone reads as fire; a dodecahedron read as a gold nugget
    const flameGeo = new THREE.ConeGeometry(0.11, 0.42, 7);
    const flame = new THREE.Mesh(flameGeo, this.flameMaterial);
    flame.position.set(0, 0.3, 0.15);
    group.add(flame);

    // Additive glow sprite instead of a real PointLight.
    // 32 torch PointLights forced every standard material in the scene to
    // evaluate 32 extra light loops per fragment — pure GPU waste for the
    // same look. Sprites cost one draw call and no lighting math.
    const glow = new THREE.Sprite(this.torchGlowMaterial);
    glow.scale.set(1.5, 1.5, 1);
    glow.position.set(0, 0.3, 0.15);
    group.add(glow);

    return group;
  }

  createAtmosphericEmbers() {
    // 300 floating dust & fire embers drifting in the chasm
    const count = 350;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 12;
      positions[i * 3 + 1] = Math.random() * 7 + 0.5;
      positions[i * 3 + 2] = -Math.random() * (this.segmentLength * this.totalSegments);

      // Warm ember colors (orange to golden yellow)
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.35 + Math.random() * 0.45;
      colors[i * 3 + 2] = 0.05;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Soft round motes instead of hard yellow squares
    const material = new THREE.PointsMaterial({
      size: 0.1,
      map: this.createGlowTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.emberParticles = new THREE.Points(geometry, material);
    this.scene.add(this.emberParticles);
  }

  update(playerZ, delta) {
    // Infinite track recycling
    // As player runs forward (Z decreases), recycle segments behind the player to the far front
    for (let i = 0; i < this.segments.length; i++) {
      const seg = this.segments[i];
      if (seg.position.z > playerZ + this.segmentLength * 1.5) {
        this.currentFrontZ -= this.segmentLength;
        seg.position.z = this.currentFrontZ;
      }
    }

    // Animate atmospheric embers drifting
    if (this.emberParticles) {
      const pos = this.emberParticles.geometry.attributes.position.array;
      for (let i = 0; i < pos.length; i += 3) {
        pos[i + 1] += Math.sin(Date.now() * 0.001 + i) * 0.003; // Gentle float
        // Keep particles around player
        if (pos[i + 2] > playerZ + 10) {
          pos[i + 2] = playerZ - (this.segmentLength * this.totalSegments) + Math.random() * 10;
        }
      }
      this.emberParticles.geometry.attributes.position.needsUpdate = true;
    }
  }
}
