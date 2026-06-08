import * as THREE from 'three';

export class SceneManager {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000818);
    this.scene.fog = new THREE.FogExp2(0x000818, 0.03);

    this.collidableMeshes = [];
    this.collidableBoxes  = [];

    this.collidableMeshes = [];
    this.collidableBoxes  = [];
    this.currentLayout = -1;

    // Cache for updateFog() — avoids Color allocation every frame
    this._fogWave  = -1;
    this._fogColorA = new THREE.Color(0x000818);
    this._fogColorB = new THREE.Color(0x330011);

    this.setupLighting();
    this.buildStaticMap();
    this.changeLayout(1);
    this.buildSkybox();
  }

  setupLighting() {
    const ambient = new THREE.AmbientLight(0x0a0a15, 0.8);
    this.scene.add(ambient);
  }

  buildSkybox() {
    const skyGeo = new THREE.SphereGeometry(200, 16, 16);
    // Outer starry layer
    const starsMat = new THREE.MeshBasicMaterial({
      color: 0x000818,
      side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeo, starsMat);
    this.scene.add(sky);

    // Inner Grid layer
    const gridGeo = new THREE.SphereGeometry(190, 12, 12);
    const gridMat = new THREE.MeshBasicMaterial({
      color: 0x004466,
      wireframe: true,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.15
    });
    const grid = new THREE.Mesh(gridGeo, gridMat);
    this.scene.add(grid);
  }

  buildStaticMap() {
    const darkMat = new THREE.MeshBasicMaterial({ color: 0x1a1a24 });
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x0a0a14 });

    // Floor
    const floorGeo = new THREE.PlaneGeometry(100, 100);
    const floor = new THREE.Mesh(floorGeo, darkMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.collidableMeshes.push(floor);

    // Floor Grid
    const gridHelper = new THREE.GridHelper(100, 50, 0x00f3ff, 0x003344);
    gridHelper.position.y = 0.01;
    this.scene.add(gridHelper);

    // Outer Boundary Walls (80x80 playable area)
    const wallThickness = 2;
    const wallHeight = 20;
    const wallLength = 80;
    const wallGeo = new THREE.BoxGeometry(wallLength + wallThickness * 2, wallHeight, wallThickness);
    
    const walls = [
      { pos: [0, wallHeight/2, -40], rot: [0, 0, 0] },
      { pos: [0, wallHeight/2, 40], rot: [0, 0, 0] },
      { pos: [-40, wallHeight/2, 0], rot: [0, Math.PI / 2, 0] },
      { pos: [40, wallHeight/2, 0], rot: [0, Math.PI / 2, 0] }
    ];

    walls.forEach(w => {
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(...w.pos);
      wall.rotation.set(...w.rot);
      this.scene.add(wall);
      this.collidableMeshes.push(wall);
      
      wall.updateMatrixWorld();
      wall.geometry.computeBoundingBox();
      this.collidableBoxes.push(new THREE.Box3().copy(wall.geometry.boundingBox).applyMatrix4(wall.matrixWorld));

      const edgeGeo = new THREE.BoxGeometry(wallLength, 0.5, wallThickness + 0.5);
      const edge = new THREE.Mesh(edgeGeo, new THREE.MeshBasicMaterial({ color: 0x00f3ff }));
      edge.position.set(0, wallHeight/2, 0);
      wall.add(edge);
    });
  }

  changeLayout(layoutIndex) {
    if (this.currentLayout === layoutIndex) return;
    this.currentLayout = layoutIndex;

    // Clean up previous dynamic layout
    if (this.dynamicGroup) {
      this.dynamicGroup.forEach(obj => this.scene.remove(obj));
      this.collidableMeshes = this.collidableMeshes.filter(m => !m.userData.isDynamic);
      
      // Rebuild collidableBoxes from remaining static meshes
      this.collidableBoxes = [];
      this.collidableMeshes.forEach(mesh => {
        mesh.updateMatrixWorld();
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        this.collidableBoxes.push(new THREE.Box3().copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
      });
    }

    this.dynamicGroup = [];

    const darkMat = new THREE.MeshBasicMaterial({ color: 0x1a1a24 });
    const wallMat = new THREE.MeshBasicMaterial({ color: 0x0a0a14 });

    // Helper for adding generic meshes
    const addDynamicMesh = (mesh) => {
      mesh.userData.isDynamic = true;
      this.scene.add(mesh);
      this.dynamicGroup.push(mesh);
      this.collidableMeshes.push(mesh);
      mesh.updateMatrixWorld();
      mesh.geometry.computeBoundingBox();
      this.collidableBoxes.push(new THREE.Box3().copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));
    };

    if (layoutIndex === 1) {
      // 4 City Blocks
      const blockGeo = new THREE.BoxGeometry(26, 4, 26);
      const blockPositions = [[23, 23], [-23, 23], [23, -23], [-23, -23]];
      blockPositions.forEach(p => {
        const block = new THREE.Mesh(blockGeo, darkMat);
        block.position.set(p[0], 2, p[1]);
        const blockEdges = new THREE.EdgesGeometry(blockGeo);
        block.add(new THREE.LineSegments(blockEdges, new THREE.LineBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.5 })));
        addDynamicMesh(block);
      });

      // Bridges
      const bridgeGeo = new THREE.BoxGeometry(6, 0.5, 20);
      const bridgeGeoX = new THREE.BoxGeometry(20, 0.5, 6);
      const bridges = [
        { geo: bridgeGeo, pos: [23, 3.8, 0] },
        { geo: bridgeGeo, pos: [-23, 3.8, 0] },
        { geo: bridgeGeoX, pos: [0, 3.8, 23] },
        { geo: bridgeGeoX, pos: [0, 3.8, -23] }
      ];
      bridges.forEach(b => {
        const bridge = new THREE.Mesh(b.geo, darkMat);
        bridge.position.set(...b.pos);
        const bEdges = new THREE.EdgesGeometry(b.geo);
        bridge.add(new THREE.LineSegments(bEdges, new THREE.LineBasicMaterial({ color: 0xff00ff, transparent: true, opacity: 0.5 })));
        addDynamicMesh(bridge);
      });

      // Central Monument
      const centerGeo = new THREE.BoxGeometry(8, 15, 8);
      const centerMesh = new THREE.Mesh(centerGeo, wallMat);
      centerMesh.position.set(0, 7.5, 0);
      const centerEdges = new THREE.EdgesGeometry(centerGeo);
      centerMesh.add(new THREE.LineSegments(centerEdges, new THREE.LineBasicMaterial({ color: 0x00f3ff })));
      addDynamicMesh(centerMesh);

      for(let i=0; i<3; i++) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(6, 0.2, 8, 16), new THREE.MeshBasicMaterial({ color: 0xff00ff }));
        ring.rotation.x = Math.PI / 2;
        ring.position.set(0, 4 + i*4, 0);
        this.scene.add(ring);
        this.dynamicGroup.push(ring);
      }

      // Cover
      this.createLBarricade(25, 25, 0, 4);
      this.createLBarricade(-25, 25, Math.PI / 2, 4);
      this.createLBarricade(-25, -25, Math.PI, 4);
      this.createLBarricade(25, -25, -Math.PI / 2, 4);

      this.createCoverBox(new THREE.Vector3(15, 6, 15), new THREE.Vector3(4, 4, 4), 0x00f3ff);
      this.createCoverBox(new THREE.Vector3(-15, 6, 15), new THREE.Vector3(4, 4, 4), 0x00f3ff);
      this.createCoverBox(new THREE.Vector3(15, 6, -15), new THREE.Vector3(4, 4, 4), 0x00f3ff);
      this.createCoverBox(new THREE.Vector3(-15, 6, -15), new THREE.Vector3(4, 4, 4), 0x00f3ff);
      this.createCoverBox(new THREE.Vector3(0, 1.5, 12), new THREE.Vector3(8, 3, 2), 0xff00ff);
      this.createCoverBox(new THREE.Vector3(0, 1.5, -12), new THREE.Vector3(8, 3, 2), 0xff00ff);
      this.createCoverBox(new THREE.Vector3(12, 1.5, 0), new THREE.Vector3(2, 3, 8), 0xff00ff);
      this.createCoverBox(new THREE.Vector3(-12, 1.5, 0), new THREE.Vector3(2, 3, 8), 0xff00ff);

    } else if (layoutIndex === 2) {
      // THE GRID: A clean, symmetrical, monolithic arena
      
      // Central high ground
      this.createCoverBox(new THREE.Vector3(0, 1.5, 0), new THREE.Vector3(20, 3, 20), 0x00f3ff);
      
      // 4 Bridges extending out from the center
      this.createCoverBox(new THREE.Vector3(0, 1.5, 20), new THREE.Vector3(8, 3, 20), 0x00f3ff);
      this.createCoverBox(new THREE.Vector3(0, 1.5, -20), new THREE.Vector3(8, 3, 20), 0x00f3ff);
      this.createCoverBox(new THREE.Vector3(20, 1.5, 0), new THREE.Vector3(20, 3, 8), 0x00f3ff);
      this.createCoverBox(new THREE.Vector3(-20, 1.5, 0), new THREE.Vector3(20, 3, 8), 0x00f3ff);
      
      // Central cover block to break line of sight across the map
      this.createCoverBox(new THREE.Vector3(0, 5, 0), new THREE.Vector3(8, 10, 8), 0xff00ff);
      
      // Corner monolithic towers
      this.createCoverBox(new THREE.Vector3(25, 4, 25), new THREE.Vector3(12, 8, 12), 0xff00ff);
      this.createCoverBox(new THREE.Vector3(-25, 4, 25), new THREE.Vector3(12, 8, 12), 0xff00ff);
      this.createCoverBox(new THREE.Vector3(25, 4, -25), new THREE.Vector3(12, 8, 12), 0xff00ff);
      this.createCoverBox(new THREE.Vector3(-25, 4, -25), new THREE.Vector3(12, 8, 12), 0xff00ff);
      
      // Outer edge solid barricades
      this.createCoverBox(new THREE.Vector3(0, 2, 35), new THREE.Vector3(16, 4, 4), 0x00f3ff);
      this.createCoverBox(new THREE.Vector3(0, 2, -35), new THREE.Vector3(16, 4, 4), 0x00f3ff);
      this.createCoverBox(new THREE.Vector3(35, 2, 0), new THREE.Vector3(4, 4, 16), 0x00f3ff);
      this.createCoverBox(new THREE.Vector3(-35, 2, 0), new THREE.Vector3(4, 4, 16), 0x00f3ff);

    } else if (layoutIndex === 3) {
      // SCATTERED: randomly placed boxes
      // We use a deterministic pseudo-random to keep it consistent
      let seed = 12345;
      const random = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
      };

      for (let i = 0; i < 25; i++) {
        const w = 2 + random() * 8;
        const d = 2 + random() * 8;
        const h = 2 + random() * 6;
        const x = -30 + random() * 60;
        const z = -30 + random() * 60;
        // avoid center spawn
        if (Math.abs(x) < 5 && Math.abs(z) < 5) continue;

        const color = random() > 0.5 ? 0x00f3ff : 0xff00ff;
        this.createCoverBox(new THREE.Vector3(x, h/2, z), new THREE.Vector3(w, h, d), color);
      }
    }
  }

  createCoverBox(pos, size, color) {
    const geo = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1a24 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.userData.isDynamic = true;
    this.scene.add(mesh);
    this.dynamicGroup.push(mesh);
    this.collidableMeshes.push(mesh);
    
    mesh.updateMatrixWorld();
    mesh.geometry.computeBoundingBox();
    this.collidableBoxes.push(new THREE.Box3().copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld));

    const edges = new THREE.EdgesGeometry(geo);
    const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.5 }));
    mesh.add(line);
  }

  createLBarricade(x, z, rotation, yOffset = 0) {
    const group = new THREE.Group();
    group.position.set(x, 1.5 + yOffset, z);
    group.rotation.y = rotation;
    
    const wall1geo = new THREE.BoxGeometry(8, 3, 2);
    const wall1 = new THREE.Mesh(wall1geo, new THREE.MeshBasicMaterial({ color: 0x1a1a24 }));
    wall1.position.set(0, 0, 0);
    group.add(wall1);
    
    const edges1 = new THREE.EdgesGeometry(wall1geo);
    wall1.add(new THREE.LineSegments(edges1, new THREE.LineBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.5 })));

    const wall2geo = new THREE.BoxGeometry(2, 3, 6);
    const wall2 = new THREE.Mesh(wall2geo, new THREE.MeshBasicMaterial({ color: 0x1a1a24 }));
    wall2.position.set(3, 0, 4);
    group.add(wall2);
    
    const edges2 = new THREE.EdgesGeometry(wall2geo);
    wall2.add(new THREE.LineSegments(edges2, new THREE.LineBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.5 })));

    this.scene.add(group);
    this.dynamicGroup.push(group);
    
    wall1.userData.isDynamic = true;
    wall1.updateMatrixWorld();
    wall1.geometry.computeBoundingBox();
    this.collidableBoxes.push(new THREE.Box3().copy(wall1.geometry.boundingBox).applyMatrix4(wall1.matrixWorld));
    this.collidableMeshes.push(wall1);

    wall2.userData.isDynamic = true;
    wall2.updateMatrixWorld();
    wall2.geometry.computeBoundingBox();
    this.collidableBoxes.push(new THREE.Box3().copy(wall2.geometry.boundingBox).applyMatrix4(wall2.matrixWorld));
    this.collidableMeshes.push(wall2);
  }

  getScene() {
    return this.scene;
  }

  updateFog(wave) {
    if (wave === this._fogWave) return; // no change — skip Color lerp
    this._fogWave = wave;
    const t = Math.min((wave - 1) * 0.1, 1.0);
    this.scene.fog.color.copy(this._fogColorA).lerp(this._fogColorB, t);
  }
}
