import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { cn } from '../lib/cn';

/** Reads a design token so the 3D view matches the surrounding chrome. */
function token(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

interface ViewerProps {
  group: THREE.Group | null;
  /**
   * Index of the layer to isolate, matching the child order of `group`.
   * buildMesh emits one mesh per layer in layer order, so a row's index in the
   * sidebar is the same index here.
   */
  highlightIndex?: number | null;
  className?: string;
}

export interface ViewerHandle {
  /** Re-frames the camera on the mesh — the way back from panning into empty space. */
  resetView: () => void;
}

export const Viewer = forwardRef<ViewerHandle, ViewerProps>(function Viewer(
  { group, highlightIndex = null, className },
  ref,
) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const contentRef = useRef<THREE.Group | null>(null);
  /** Tilts printer space (Z up) into three.js view space (Y up). */
  const pivotRef = useRef<THREE.Object3D | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  // Scene is created once and reused; only its contents change per build.
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(token('--color-mat', '#0f1a1c'));
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 5000);
    camera.position.set(0, 90, 120);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    /*
     * Take the canvas out of layout entirely.
     *
     * setSize(w, h, false) leaves the CSS size unset, so the canvas lays out at
     * its buffer size — which is w × devicePixelRatio. On any HiDPI display
     * that made the canvas wider than its container, growing it, which
     * retriggered the ResizeObserver and doubled it again. The buffer ran away
     * to millions of pixels, WebGL failed to allocate, and the viewer went
     * blank. Absolute positioning at 100% means the element can never influence
     * the size it's measured against.
     */
    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    mount.appendChild(canvas);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    /*
     * Stop just above horizontal. A sign is flat, so its underside carries no
     * information, and orbiting beneath the bed puts the grid between the
     * camera and the model — which reads as the preview breaking rather than as
     * a viewpoint the user chose.
     */
    controls.maxPolarAngle = Math.PI / 2 - 0.05;
    controlsRef.current = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 1.5));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(60, 120, 80);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.7);
    fill.position.set(-80, 40, -60);
    scene.add(fill);

    const grid = new THREE.GridHelper(400, 40, token('--color-rule-strong', '#375357'), token('--color-rule', '#24393d'));
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    scene.add(grid);

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    // ResizeObserver rather than a window listener: the canvas is laid out by
    // its container, which changes size without the window doing so.
    const resize = new ResizeObserver(() => {
      const { clientWidth: w, clientHeight: h } = mount;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    resize.observe(mount);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  /** Frames whatever is currently in the scene. Shared by mesh changes and the reset control. */
  const frameCamera = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const content = contentRef.current;
    if (!camera || !controls || !content) return;

    const sphere = new THREE.Box3()
      .setFromObject(content)
      .getBoundingSphere(new THREE.Sphere());
    const distance = (sphere.radius * 1.35) / Math.tan((camera.fov * Math.PI) / 360);

    controls.target.copy(sphere.center);
    camera.position.set(
      sphere.center.x,
      sphere.center.y + distance * 0.62,
      sphere.center.z + distance * 0.78,
    );
    camera.near = Math.max(distance / 500, 0.05);
    camera.far = distance * 12;
    camera.updateProjectionMatrix();

    // Keep zoom inside useful bounds so the user can't end up inside the mesh
    // or so far out that it becomes a speck.
    controls.minDistance = sphere.radius * 0.4;
    controls.maxDistance = distance * 4;
    controls.update();
  }, []);

  useImperativeHandle(ref, () => ({ resetView: frameCamera }), [frameCamera]);

  // Swap in the current mesh, then frame it.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    if (pivotRef.current) {
      scene.remove(pivotRef.current);
      pivotRef.current = null;
      contentRef.current = null;
    }
    if (!group) return;

    /*
     * Presentation only. Meshes stay in printer coordinates so exports are
     * oriented for a print bed; the tilt to three.js's Y-up world lives here.
     */
    const pivot = new THREE.Object3D();
    pivot.rotation.x = -Math.PI / 2;
    pivot.add(group);
    scene.add(pivot);
    pivot.updateMatrixWorld(true);

    pivotRef.current = pivot;
    contentRef.current = group;
    frameCamera();
  }, [group, frameCamera]);

  /*
   * Isolate the hovered layer by fading the rest back.
   *
   * Materials are created per layer in buildMesh, so writing to them here
   * affects only that layer. depthWrite goes off with transparency, otherwise
   * a faded layer still occludes the highlighted one behind it and the effect
   * reads as flicker rather than depth.
   */
  useEffect(() => {
    const content = contentRef.current;
    if (!content) return;

    content.children.forEach((child, index) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshStandardMaterial;
      const faded = highlightIndex !== null && highlightIndex !== index;

      material.transparent = faded;
      material.opacity = faded ? 0.12 : 1;
      material.depthWrite = !faded;
      material.needsUpdate = true;
    });
  }, [highlightIndex, group]);

  // relative so the absolutely-positioned canvas anchors to this box.
  return <div ref={mountRef} className={cn('relative', className)} />;
});
