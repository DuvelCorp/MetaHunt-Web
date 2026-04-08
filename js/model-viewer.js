// model-viewer.js — Three.js GLB model viewer for beast detail panel
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

// Cache loaded models
const modelCache = new Map();

class ModelViewer {
  constructor(container) {
    this.container = container;
    this.currentDisplayId = null;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x1a1e26, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 2, 5);

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 2.0;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 20;
    this.controls.target.set(0, 1, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const light1 = new THREE.DirectionalLight(0xffffff, 1.0);
    light1.position.set(5, 10, 7);
    this.scene.add(light1);

    const light2 = new THREE.DirectionalLight(0x8888ff, 0.4);
    light2.position.set(-5, 5, -5);
    this.scene.add(light2);

    // Model group
    this.modelGroup = new THREE.Group();
    this.scene.add(this.modelGroup);

    // Animation
    this._animating = false;
    this._animate = this._animate.bind(this);

    // Resize observer
    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(container);

    this._resize();
  }

  _resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    if (!this._animating) return;
    requestAnimationFrame(this._animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  start() {
    if (!this._animating) {
      this._animating = true;
      this._animate();
    }
  }

  stop() {
    this._animating = false;
  }

  async loadModel(displayId) {
    if (this.currentDisplayId === displayId) return;
    this.currentDisplayId = displayId;

    // Clear existing model
    while (this.modelGroup.children.length) {
      const child = this.modelGroup.children[0];
      this.modelGroup.remove(child);
      child.traverse?.(c => {
        c.geometry?.dispose();
        if (c.material) {
          if (Array.isArray(c.material)) c.material.forEach(m => m.dispose());
          else c.material.dispose();
        }
      });
    }

    if (!displayId) return;

    try {
      let gltf;
      if (modelCache.has(displayId)) {
        gltf = modelCache.get(displayId);
      } else {
        gltf = await new Promise((resolve, reject) => {
          loader.load(
            `models/${displayId}.glb`,
            resolve,
            undefined,
            reject
          );
        });
        modelCache.set(displayId, gltf);
      }

      // Clone the scene to avoid issues with cached models
      const model = gltf.scene.clone(true);
      this.modelGroup.add(model);

      // Center and scale model
      const box = new THREE.Box3().setFromObject(model);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);

      // Scale to fit in ~3 units
      const scale = 3 / maxDim;
      model.scale.setScalar(scale);

      // Recalculate after scale
      box.setFromObject(model);
      const sizeScaled = box.getSize(new THREE.Vector3());
      box.getCenter(center);

      // Center the model
      model.position.sub(center);
      model.position.y += sizeScaled.y / 2;

      // Adaptive camera framing
      const targetY = sizeScaled.y / 2;
      const camDist = 4.5;
      this.controls.target.set(0, targetY, 0);
      this.camera.position.set(0, targetY + camDist * 0.3, camDist * 0.9);
      this.controls.update();

      this.start();
    } catch (err) {
      // Model not available — silently handle
      console.debug(`Model ${displayId}.glb not found`);
    }
  }

  dispose() {
    this.stop();
    this._resizeObserver.disconnect();
    this.renderer.dispose();
    this.controls.dispose();
  }
}

// ── Integration with app.js ──────────────────────────────────────────────────

const viewers = new Map();  // container element → ModelViewer

function ensureViewer(container) {
  if (viewers.has(container)) return viewers.get(container);
  const v = new ModelViewer(container);
  viewers.set(container, v);
  return v;
}

// Load a model into a specific container element
window.loadBeastModelIn = function(container, displayId) {
  if (!container) return;
  // Dispose any viewers whose containers are no longer in the DOM
  for (const [el, v] of viewers) {
    if (!el.isConnected) { v.dispose(); viewers.delete(el); }
  }
  const v = ensureViewer(container);
  v.loadModel(displayId);
};

// Legacy API — targets #model-viewer-container
window.loadBeastModel = function(displayId) {
  const container = document.getElementById('model-viewer-container');
  if (!container) return;
  window.loadBeastModelIn(container, displayId);
};

// Stop all viewers
window.stopModelViewer = function() {
  for (const v of viewers.values()) v.stop();
};
