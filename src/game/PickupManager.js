// ========================================================================
// TEMPLE PICKUPS: SHIELD ORBS AND DISTANCE MILESTONE HEARTS
// ========================================================================
import * as THREE from 'three';

export class PickupManager {
  constructor(scene) {
    this.scene = scene;
    this.lanes = [-2.8, 0, 2.8];
    this.pickups = [];
    this.reset();
    this.createMaterials();
  }

  createMaterials() {
    this.shieldMat = new THREE.MeshStandardMaterial({ color: 0x79f4ff, emissive: 0x16cfe5, emissiveIntensity: 2.2, metalness: .35, roughness: .22 });
    this.goldMat = new THREE.MeshStandardMaterial({ color: 0xffcf69, emissive: 0xff9c27, emissiveIntensity: 1.4, metalness: .65, roughness: .25 });
    this.heartMat = new THREE.MeshStandardMaterial({ color: 0xff315d, emissive: 0x9d092d, emissiveIntensity: 1.7, metalness: .12, roughness: .3 });
  }

  createPickup(type, z, laneIdx) {
    const group = new THREE.Group();
    group.pickupType = type;
    group.z = z;
    group.laneIdx = laneIdx;
    group.baseY = type === 'shield' ? 1.4 : 1.25;
    if (type === 'shield') {
      const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(.52, 1), this.shieldMat);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.72, .07, 8, 32), this.goldMat);
      ring.rotation.x = Math.PI / 2.7;
      group.add(orb, ring);
      group.userData.ring = ring;
      group.add(new THREE.PointLight(0x61efff, 2, 7));
    } else {
      const shape = new THREE.Shape();
      shape.moveTo(0, -.45); shape.bezierCurveTo(-.3, -.15, -.72, .17, -.6, .52);
      shape.bezierCurveTo(-.47, .91, -.05, .8, 0, .52);
      shape.bezierCurveTo(.1, .82, .54, .86, .66, .5);
      shape.bezierCurveTo(.78, .16, .3, -.18, 0, -.45);
      const heart = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.heartMat);
      heart.rotation.x = -.12;
      group.add(heart);
      group.add(new THREE.PointLight(0xff315d, 1.8, 6));
    }
    group.position.set(this.lanes[laneIdx], group.baseY, z);
    this.scene.add(group);
    this.pickups.push(group);
    return group;
  }

  update(playerZ, playerLaneX, distance, lives, delta, onCollect) {
    while (distance >= this.nextShieldDistance) {
      this.createPickup('shield', playerZ - 58, Math.floor(Math.random() * 3));
      this.nextShieldDistance += 155 + Math.random() * 45;
    }
    while (distance >= this.nextHeartDistance) {
      if (lives < 3) this.createPickup('heart', playerZ - 58, Math.floor(Math.random() * 3));
      this.nextHeartDistance += 450;
    }

    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const item = this.pickups[i];
      item.rotation.y += delta * (item.pickupType === 'shield' ? 1.8 : 1.15);
      item.position.y = item.baseY + Math.sin(performance.now() * .002 + item.z) * .12;
      if (item.userData.ring) item.userData.ring.rotation.z += delta * 1.1;
      if (Math.abs(item.z - playerZ) < 1.15 && Math.abs(this.lanes[item.laneIdx] - playerLaneX) < 1.55) {
        this.scene.remove(item);
        this.pickups.splice(i, 1);
        onCollect?.(item.pickupType);
      } else if (item.z > playerZ + 12) {
        this.scene.remove(item);
        this.pickups.splice(i, 1);
      }
    }
  }

  reset() {
    for (const item of this.pickups || []) this.scene.remove(item);
    this.pickups = [];
    this.nextShieldDistance = 90;
    this.nextHeartDistance = 400;
  }
}
