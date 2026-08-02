import { useEffect, useRef } from 'react';
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
  className?: string;
}

export function Viewer({ group, className }: ViewerProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const contentRef = useRef<THREE.Group | null>(null);
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

  // Swap in the current mesh and frame the camera to fit it.
  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    if (contentRef.current) {
      scene.remove(contentRef.current);
      contentRef.current = null;
    }
    if (!group) return;

    scene.add(group);
    contentRef.current = group;

    const sphere = new THREE.Box3()
      .setFromObject(group)
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
  }, [group]);

  // relative so the absolutely-positioned canvas anchors to this box.
  return <div ref={mountRef} className={cn('relative', className)} />;
}
