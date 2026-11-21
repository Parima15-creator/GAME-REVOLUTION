// ==========================================================================
// REFLEXRUN 3D - FIRST-PERSON 3D BOXING GLOVES & PUNCH ANIMATIONS
// ==========================================================================

import * as THREE from 'three';

export class PlayerHands {
  constructor(camera) {
    this.camera = camera;
    this.handsGroup = new THREE.Group();
    this.camera.add(this.handsGroup);

    // Punch state
    this.punchProgressLeft = 0;
    this.punchProgressRight = 0;
    this.isPunchingLeft = false;
    this.isPunchingRight = false;
    this.idleBobTimer = 0;

    this.createGloves();
  }

  createGloves() {
    // Athletic Boxing Glove Material
    const gloveMat = new THREE.MeshStandardMaterial({
      color: 0x3f0e16, // Dark oxblood leather
      roughness: 0.88,
      metalness: 0.02,
    });

    const wrapMat = new THREE.MeshStandardMaterial({
      color: 0x11161f, // Tactical matte black wrap
      roughness: 0.8,
    });

    const knuckleMat = new THREE.MeshStandardMaterial({
      color: 0xc9762a, // Warm metal knuckle guard
      roughness: 0.35,
      metalness: 0.55,
    });

    // Left Fist Group
    this.leftHand = new THREE.Group();
    this.basePosLeft = new THREE.Vector3(-0.54, -0.7, -1.1);
    this.leftHand.position.copy(this.basePosLeft);

    // Right Fist Group
    this.rightHand = new THREE.Group();
    this.basePosRight = new THREE.Vector3(0.54, -0.7, -1.1);
    this.rightHand.position.copy(this.basePosRight);

    // Helper to build 3D fist geometry. A long forearm angled down out of frame
    // is what sells "these are my hands"; a floating ball reads as fruit.
    const buildGlove = (handGroup, isLeft) => {
      // Forearm: tapered, long enough to leave the bottom of the screen
      const armGeo = new THREE.CylinderGeometry(0.115, 0.165, 0.62, 12);
      const arm = new THREE.Mesh(armGeo, wrapMat);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(0, -0.07, 0.42);
      handGroup.add(arm);

      // Fist
      const mainGeo = new THREE.IcosahedronGeometry(0.2, 1);
      const mainMesh = new THREE.Mesh(mainGeo, gloveMat);
      mainMesh.scale.set(1.02, 0.98, 1.12);
      mainMesh.castShadow = true;
      handGroup.add(mainMesh);

      // Knuckle strap (dark leather, not an orange beak)
      const knuckleGeo = new THREE.BoxGeometry(0.25, 0.085, 0.08);
      const knuckleMesh = new THREE.Mesh(knuckleGeo, wrapMat);
      knuckleMesh.position.set(0, 0.055, -0.16);
      knuckleMesh.rotation.x = -0.2;
      handGroup.add(knuckleMesh);

      // Thumb, tucked to the inside of the fist
      const thumbGeo = new THREE.IcosahedronGeometry(0.075, 0);
      const thumb = new THREE.Mesh(thumbGeo, gloveMat);
      thumb.position.set(isLeft ? 0.155 : -0.155, -0.04, 0.0);
      thumb.scale.set(1, 1.2, 1);
      handGroup.add(thumb);

      // Cuff collar
      const cuffGeo = new THREE.CylinderGeometry(0.15, 0.125, 0.1, 14);
      const cuff = new THREE.Mesh(cuffGeo, gloveMat);
      cuff.rotation.x = Math.PI / 2;
      cuff.position.set(0, -0.05, 0.15);
      handGroup.add(cuff);
    };

    buildGlove(this.leftHand, true);
    buildGlove(this.rightHand, false);

    // Guard pose: forearms angled down and inwards so they leave frame at the
    // bottom corners instead of pointing their end caps at the camera.
    this.baseRotLeft = new THREE.Euler(0.86, 0.34, -0.12);
    this.baseRotRight = new THREE.Euler(0.86, -0.34, 0.12);
    this.leftHand.rotation.copy(this.baseRotLeft);
    this.rightHand.rotation.copy(this.baseRotRight);

    // Slightly smaller so the gloves frame the track instead of covering it
    this.leftHand.scale.setScalar(0.6);
    this.rightHand.scale.setScalar(0.6);

    this.handsGroup.add(this.leftHand);
    this.handsGroup.add(this.rightHand);
  }

  triggerPunch(side = 'right') {
    if (side === 'left') {
      this.isPunchingLeft = true;
      this.punchProgressLeft = 0.01;
    } else {
      this.isPunchingRight = true;
      this.punchProgressRight = 0.01;
    }
  }

  // Clear any in-flight punch animation (called when a run restarts)
  resetPunches() {
    this.isPunchingLeft = false;
    this.isPunchingRight = false;
    this.punchProgressLeft = 0;
    this.punchProgressRight = 0;
  }

  update(runSpeed, delta) {
    this.idleBobTimer += delta * runSpeed * 0.4;
    const idleBobY = Math.sin(this.idleBobTimer * 2.0) * 0.025;
    const idleBobX = Math.cos(this.idleBobTimer) * 0.015;

    // 1. Left Hand Punch Animation
    if (this.isPunchingLeft) {
      this.punchProgressLeft += delta * 7.5; // Fast punch snap
      if (this.punchProgressLeft >= 1.0) {
        this.punchProgressLeft = 0;
        this.isPunchingLeft = false;
      }
      // Sinusoidal extension and retraction curve
      const extend = Math.sin(this.punchProgressLeft * Math.PI);
      this.leftHand.position.set(
        this.basePosLeft.x + extend * 0.25,
        this.basePosLeft.y + extend * 0.15,
        this.basePosLeft.z - extend * 0.85 // Snaps forward towards center
      );
      // Straighten out of guard as the fist drives forward
      this.leftHand.rotation.set(
        this.baseRotLeft.x * (1 - extend * 0.85),
        this.baseRotLeft.y * (1 - extend * 0.5),
        this.baseRotLeft.z - extend * 0.35
      );
    } else {
      // Natural guard idle
      this.leftHand.position.set(
        this.basePosLeft.x + idleBobX,
        this.basePosLeft.y + idleBobY,
        this.basePosLeft.z
      );
      this.leftHand.rotation.copy(this.baseRotLeft);
    }

    // 2. Right Hand Punch Animation
    if (this.isPunchingRight) {
      this.punchProgressRight += delta * 7.5;
      if (this.punchProgressRight >= 1.0) {
        this.punchProgressRight = 0;
        this.isPunchingRight = false;
      }
      const extend = Math.sin(this.punchProgressRight * Math.PI);
      this.rightHand.position.set(
        this.basePosRight.x - extend * 0.25,
        this.basePosRight.y + extend * 0.15,
        this.basePosRight.z - extend * 0.85
      );
      this.rightHand.rotation.set(
        this.baseRotRight.x * (1 - extend * 0.85),
        this.baseRotRight.y * (1 - extend * 0.5),
        this.baseRotRight.z + extend * 0.35
      );
    } else {
      this.rightHand.position.set(
        this.basePosRight.x - idleBobX,
        this.basePosRight.y + idleBobY,
        this.basePosRight.z
      );
      this.rightHand.rotation.copy(this.baseRotRight);
    }
  }
}
