import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, Compass, RotateCcw } from 'lucide-react';
import type { Country } from '../types';

interface Globe3DExplorerProps {
  countries: Country[];
  onSelectCountryHub: (slug: string) => void;
}

interface CountryCoord {
  slug: string;
  lat: number;
  lng: number;
  hubCity: string;
}

const COUNTRY_COORDS: Record<string, CountryCoord> = {
  germany: { slug: 'germany', lat: 51.16, lng: 10.45, hubCity: 'Munich & Berlin' },
  'united-kingdom': { slug: 'united-kingdom', lat: 52.35, lng: -1.17, hubCity: 'London & Manchester' },
  canada: { slug: 'canada', lat: 45.42, lng: -75.69, hubCity: 'Toronto & Vancouver' },
  'united-states': { slug: 'united-states', lat: 39.82, lng: -98.57, hubCity: 'Boston & Austin' },
  australia: { slug: 'australia', lat: -33.86, lng: 151.2, hubCity: 'Sydney & Melbourne' },
  ireland: { slug: 'ireland', lat: 53.34, lng: -6.26, hubCity: 'Dublin' },
  netherlands: { slug: 'netherlands', lat: 52.36, lng: 4.9, hubCity: 'Amsterdam & Delft' },
  france: { slug: 'france', lat: 48.85, lng: 2.35, hubCity: 'Paris & Lyon' },
  sweden: { slug: 'sweden', lat: 59.32, lng: 18.06, hubCity: 'Stockholm' },
  singapore: { slug: 'singapore', lat: 1.35, lng: 103.81, hubCity: 'Singapore' },
  japan: { slug: 'japan', lat: 35.67, lng: 139.65, hubCity: 'Tokyo' },
  'south-korea': { slug: 'south-korea', lat: 37.56, lng: 126.97, hubCity: 'Seoul' },
  'new-zealand': { slug: 'new-zealand', lat: -36.84, lng: 174.76, hubCity: 'Auckland' },
  uae: { slug: 'uae', lat: 25.2, lng: 55.27, hubCity: 'Dubai' },
  switzerland: { slug: 'switzerland', lat: 47.37, lng: 8.54, hubCity: 'Zurich' },
  austria: { slug: 'austria', lat: 48.2, lng: 16.37, hubCity: 'Vienna' },
  italy: { slug: 'italy', lat: 45.46, lng: 9.19, hubCity: 'Milan & Rome' },
};

const INDIA_ORIGIN = { lat: 20.59, lng: 78.96 };

function latLngToVec3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const z = radius * Math.sin(phi) * Math.sin(theta);
  const y = radius * Math.cos(phi);
  return new THREE.Vector3(x, y, z);
}

function detectSoftwareGl(gl: WebGLRenderingContext | WebGL2RenderingContext | null): boolean {
  if (!gl) return true;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (ext) {
      const renderer = String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
      return /SwiftShader|llvmpipe|Mesa|Software/i.test(renderer);
    }
  } catch {
    return false;
  }
  return false;
}

function createEarthTextures(maxAnisotropy: number) {
  const width = 1024;
  const height = 512;

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = width;
  colorCanvas.height = height;
  const ctx = colorCanvas.getContext('2d')!;

  const oceanGrad = ctx.createLinearGradient(0, 0, 0, height);
  oceanGrad.addColorStop(0, '#13315c');
  oceanGrad.addColorStop(0.5, '#0b2545');
  oceanGrad.addColorStop(1, '#102a4c');
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle latitude / longitude graticule lines
  ctx.strokeStyle = 'rgba(148, 197, 255, 0.14)';
  ctx.lineWidth = 1;
  for (let lat = -60; lat <= 60; lat += 30) {
    const y = ((90 - lat) / 180) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
  for (let lng = -150; lng <= 180; lng += 30) {
    const x = ((lng + 180) / 360) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  // Stylized landmasses for recognizable continental geography
  const landPolygons: Array<Array<[number, number]>> = [
    // North America
    [[-168, 66], [-140, 70], [-95, 68], [-55, 52], [-75, 36], [-82, 25], [-98, 20], [-105, 22], [-125, 48], [-152, 60]],
    // South America
    [[-80, 10], [-60, 10], [-35, -6], [-40, -22], [-66, -54], [-74, -46], [-81, -4]],
    // Europe
    [[-10, 36], [0, 44], [-5, 58], [18, 69], [42, 66], [42, 46], [28, 41], [14, 38]],
    // Africa
    [[-17, 15], [-6, 35], [32, 31], [51, 12], [40, -14], [26, -34], [15, -26], [8, 4], [-15, 10]],
    // Asia & India
    [[38, 42], [68, 70], [135, 68], [172, 64], [142, 42], [122, 30], [108, 12], [96, 16], [80, 8], [72, 22], [58, 25], [36, 32]],
    // Australia
    [[114, -22], [132, -12], [152, -24], [148, -38], [128, -33], [115, -34]],
    // Japan / UK / NZ islands
    [[130, 31], [141, 41], [145, 44], [139, 35]],
    [[-6, 50], [-2, 58], [2, 53], [-1, 50]],
    [[166, -46], [178, -37], [175, -42]],
  ];

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = width;
  roughCanvas.height = height;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = '#3c3c3c'; // specular ocean
  rCtx.fillRect(0, 0, width, height);

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = width;
  bumpCanvas.height = height;
  const bCtx = bumpCanvas.getContext('2d')!;
  bCtx.fillStyle = '#202020';
  bCtx.fillRect(0, 0, width, height);

  landPolygons.forEach((poly) => {
    const drawPoly = (target: CanvasRenderingContext2D) => {
      target.beginPath();
      poly.forEach(([lng, lat], idx) => {
        const x = ((lng + 180) / 360) * width;
        const y = ((90 - lat) / 180) * height;
        if (idx === 0) target.moveTo(x, y);
        else target.lineTo(x, y);
      });
      target.closePath();
      target.fill();
    };

    ctx.fillStyle = '#2d7a6e';
    ctx.strokeStyle = '#5eead4';
    ctx.lineWidth = 1.6;
    drawPoly(ctx);
    ctx.stroke();

    rCtx.fillStyle = '#d4d4d4'; // matte land
    drawPoly(rCtx);

    bCtx.fillStyle = '#b0b0b0'; // elevated terrain
    drawPoly(bCtx);
  });

  const colorMap = new THREE.CanvasTexture(colorCanvas);
  colorMap.colorSpace = THREE.SRGBColorSpace;
  colorMap.anisotropy = maxAnisotropy;

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.colorSpace = THREE.NoColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.colorSpace = THREE.NoColorSpace;

  return { colorMap, roughnessMap, bumpMap };
}

function createSkyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#091122');
  grad.addColorStop(0.55, '#132347');
  grad.addColorStop(1, '#1d325c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 126);
  grad.addColorStop(0, 'rgba(3, 7, 18, 0.58)');
  grad.addColorStop(0.55, 'rgba(3, 7, 18, 0.24)');
  grad.addColorStop(1, 'rgba(3, 7, 18, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const Globe3DExplorer: React.FC<Globe3DExplorerProps> = ({ countries, onSelectCountryHub }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [selectedSlug, setSelectedSlug] = useState<string>('germany');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [cameraMode, setCameraMode] = useState<'orbit' | 'corridor' | 'close'>('orbit');
  const flyTargetRef = useRef<THREE.Vector3 | null>(null);
  const selectedSlugRef = useRef<string>('germany');
  const resetTriggerRef = useRef<number>(0);

  const selectedCountry = countries.find((c) => c.slug === selectedSlug) || countries[0];
  const activeCoord = COUNTRY_COORDS[selectedSlug] || COUNTRY_COORDS.germany;

  useEffect(() => {
    selectedSlugRef.current = selectedSlug;
  }, [selectedSlug]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 540;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    const gl = renderer.getContext();
    const isSoftwareGl = detectSoftwareGl(gl);
    const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2('#101d38', 0.028);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    scene.environmentIntensity = 0.65;

    const skyTex = createSkyTexture();
    const skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(28, 32, 24),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false })
    );
    scene.add(skyDome);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(0.8, 3.2, 5.4);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 2.8;
    controls.maxDistance = 9.5;
    controls.maxPolarAngle = Math.PI * 0.56;
    controls.target.set(0, 1.85, 0);

    // Three-point natural lighting
    const hemiLight = new THREE.HemisphereLight('#c8e0ff', '#2b3345', 0.95);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight('#fff2dc', 2.3);
    keyLight.position.set(5.2, 7.5, 4.8);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 22;
    keyLight.shadow.bias = -0.0006;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#7dd3fc', 0.85);
    rimLight.position.set(-4.5, 3.0, -4.5);
    scene.add(rimLight);

    // Ground plane + subtle radial studio floor
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#111b33',
      roughness: 0.85,
      metalness: 0.08,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(14, 48), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const shadowTex = createContactShadowTexture();
    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(3.2, 3.2),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false })
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = 0.005;
    scene.add(contactShadow);

    // Grounded Armillary Pedestal Assembly (pivot at y = 0)
    const armillaryRoot = new THREE.Group();
    scene.add(armillaryRoot);

    const marbleMat = new THREE.MeshStandardMaterial({
      color: '#1e293b',
      roughness: 0.35,
      metalness: 0.15,
    });
    const brassMat = new THREE.MeshStandardMaterial({
      color: '#d4a64b',
      roughness: 0.24,
      metalness: 0.88,
    });

    const baseTier1 = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.18, 0.14, 48), marbleMat);
    baseTier1.position.y = 0.07;
    baseTier1.castShadow = true;
    baseTier1.receiveShadow = true;
    armillaryRoot.add(baseTier1);

    const baseTier2 = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.92, 0.12, 48), marbleMat);
    baseTier2.position.y = 0.2;
    baseTier2.castShadow = true;
    armillaryRoot.add(baseTier2);

    const brassCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.34, 0.28, 36), brassMat);
    brassCollar.position.y = 0.4;
    brassCollar.castShadow = true;
    armillaryRoot.add(brassCollar);

    // Outer meridian cradle ring resting on pedestal
    const outerGimbal = new THREE.Mesh(new THREE.TorusGeometry(1.56, 0.036, 20, 72), brassMat);
    outerGimbal.position.y = 1.9;
    outerGimbal.castShadow = true;
    armillaryRoot.add(outerGimbal);

    const eqGimbal = new THREE.Mesh(new THREE.TorusGeometry(1.48, 0.022, 16, 72), brassMat);
    eqGimbal.position.y = 1.9;
    eqGimbal.rotation.x = Math.PI / 2;
    eqGimbal.rotation.y = 0.32;
    armillaryRoot.add(eqGimbal);

    // Finials at poles of outer meridian
    const finialProfile = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.08, 0.02),
      new THREE.Vector2(0.05, 0.09),
      new THREE.Vector2(0.02, 0.19),
      new THREE.Vector2(0, 0.23),
    ];
    const topFinial = new THREE.Mesh(new THREE.LatheGeometry(finialProfile, 24), brassMat);
    topFinial.position.set(0, 3.46, 0);
    armillaryRoot.add(topFinial);

    // Tilted rotating globe assembly
    const globeRadius = 1.32;
    const globeGroup = new THREE.Group();
    globeGroup.position.set(0, 1.9, 0);
    globeGroup.rotation.z = THREE.MathUtils.degToRad(14);
    armillaryRoot.add(globeGroup);

    const { colorMap, roughnessMap, bumpMap } = createEarthTextures(maxAnisotropy);
    const globeMat = new THREE.MeshStandardMaterial({
      map: colorMap,
      roughnessMap,
      bumpMap,
      bumpScale: 0.025,
      roughness: 0.72,
      metalness: 0.08,
    });
    const globeMesh = new THREE.Mesh(new THREE.SphereGeometry(globeRadius, 64, 48), globeMat);
    globeMesh.castShadow = true;
    globeMesh.receiveShadow = true;
    globeGroup.add(globeMesh);

    const atmoMesh = new THREE.Mesh(
      new THREE.SphereGeometry(globeRadius * 1.03, 48, 32),
      new THREE.MeshBasicMaterial({
        color: '#60a5fa',
        transparent: true,
        opacity: 0.08,
        side: THREE.BackSide,
      })
    );
    globeGroup.add(atmoMesh);

    // Instanced hub beacons for all mapped countries
    const coordList = Object.values(COUNTRY_COORDS);
    const pinGeom = new THREE.CylinderGeometry(0.018, 0.032, 0.1, 14);
    const pinMat = new THREE.MeshStandardMaterial({
      color: '#f8fafc',
      roughness: 0.25,
      metalness: 0.55,
    });
    const instancedPins = new THREE.InstancedMesh(pinGeom, pinMat, coordList.length);
    const dummy = new THREE.Object3D();
    const normalUp = new THREE.Vector3(0, 1, 0);

    coordList.forEach((c, idx) => {
      const surfacePos = latLngToVec3(c.lat, c.lng, globeRadius + 0.04);
      dummy.position.copy(surfacePos);
      dummy.quaternion.setFromUnitVectors(normalUp, surfacePos.clone().normalize());
      dummy.updateMatrix();
      instancedPins.setMatrixAt(idx, dummy.matrix);
    });
    instancedPins.instanceMatrix.needsUpdate = true;
    globeGroup.add(instancedPins);

    // 4-part architectural landmark beacon on selected destination
    const activeLandmark = new THREE.Group();
    const lmMat = new THREE.MeshStandardMaterial({ color: '#f59e0b', roughness: 0.25, metalness: 0.7 });
    const lmGlassMat = new THREE.MeshStandardMaterial({ color: '#38bdf8', roughness: 0.1, metalness: 0.3, emissive: '#0284c7', emissiveIntensity: 0.35 });
    const lmPlinth = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.04, 16), brassMat);
    const lmTower = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.18, 16), lmMat);
    lmTower.position.y = 0.1;
    const lmAtrium = new THREE.Mesh(new THREE.SphereGeometry(0.046, 16, 12), lmGlassMat);
    lmAtrium.position.y = 0.22;
    const lmSpire = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.09, 12), brassMat);
    lmSpire.position.y = 0.29;
    activeLandmark.add(lmPlinth, lmTower, lmAtrium, lmSpire);
    globeGroup.add(activeLandmark);

    // Stylized 5-part aircraft flying India -> Target corridor
    const planeGroup = new THREE.Group();
    const planeBodyMat = new THREE.MeshStandardMaterial({ color: '#f8fafc', roughness: 0.28, metalness: 0.65 });
    const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(0.022, 0.09, 6, 12), planeBodyMat);
    fuselage.rotation.x = Math.PI / 2;
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.008, 0.036), brassMat);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.007, 0.02), brassMat);
    tail.position.set(0, 0.012, -0.048);
    const tailFin = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.034, 0.022), brassMat);
    tailFin.position.set(0, 0.022, -0.048);
    const nacelleL = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.032, 10), planeBodyMat);
    nacelleL.rotation.x = Math.PI / 2;
    nacelleL.position.set(-0.042, -0.006, 0.005);
    const nacelleR = nacelleL.clone();
    nacelleR.position.x = 0.042;
    planeGroup.add(fuselage, wing, tail, tailFin, nacelleL, nacelleR);
    globeGroup.add(planeGroup);

    let flightCurve: THREE.QuadraticBezierCurve3 | null = null;
    let arcLine: THREE.Line | null = null;

    const rebuildCorridor = (slug: string) => {
      const target = COUNTRY_COORDS[slug] || COUNTRY_COORDS.germany;
      const startVec = latLngToVec3(INDIA_ORIGIN.lat, INDIA_ORIGIN.lng, globeRadius + 0.02);
      const endVec = latLngToVec3(target.lat, target.lng, globeRadius + 0.02);

      // Position active landmark
      activeLandmark.position.copy(endVec);
      activeLandmark.quaternion.setFromUnitVectors(normalUp, endVec.clone().normalize());

      // Midpoint elevated above globe surface
      const midVec = startVec
        .clone()
        .add(endVec)
        .multiplyScalar(0.5)
        .normalize()
        .multiplyScalar(globeRadius + 0.56);

      flightCurve = new THREE.QuadraticBezierCurve3(startVec, midVec, endVec);
      const arcPoints = flightCurve.getPoints(48);
      const arcGeom = new THREE.BufferGeometry().setFromPoints(arcPoints);
      const arcMat = new THREE.LineBasicMaterial({ color: '#38bdf8', transparent: true, opacity: 0.85 });

      if (arcLine) {
        arcLine.geometry.dispose();
        (arcLine.material as THREE.Material).dispose();
        globeGroup.remove(arcLine);
      }
      arcLine = new THREE.Line(arcGeom, arcMat);
      globeGroup.add(arcLine);

      // Compute world fly-to camera target facing the target landmark
      globeGroup.updateMatrixWorld();
      const worldEnd = endVec.clone().applyMatrix4(globeGroup.matrixWorld);
      const dir = worldEnd.clone().sub(new THREE.Vector3(0, 1.9, 0)).normalize();
      flyTargetRef.current = new THREE.Vector3(0, 1.9, 0).add(dir.multiplyScalar(4.8));
    };

    rebuildCorridor(selectedSlugRef.current);

    // Raycaster picking with pointerdown-to-pointerup click guard
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const onPointerDown = (ev: PointerEvent) => {
      downX = ev.clientX;
      downY = ev.clientY;
    };

    const onPointerUp = (ev: PointerEvent) => {
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6) return;
      const rect = renderer.domElement.getBoundingClientRect();
      pointerNdc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObject(instancedPins, false);
      if (hits.length > 0 && typeof hits[0].instanceId === 'number') {
        const picked = coordList[hits[0].instanceId];
        if (picked) {
          setSelectedSlug(picked.slug);
          rebuildCorridor(picked.slug);
          requestRender();
        }
      }
    };

    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    let rafId = 0;
    let needsRender = true;
    let flightProgress = 0;
    let lastTime = performance.now();

    const requestRender = () => {
      needsRender = true;
    };

    controls.addEventListener('change', requestRender);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 540;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    };
    window.addEventListener('resize', onResize);

    let currentObservedSlug = selectedSlugRef.current;
    let currentResetCount = resetTriggerRef.current;

    const animate = (now: number) => {
      rafId = requestAnimationFrame(animate);
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      if (currentObservedSlug !== selectedSlugRef.current) {
        currentObservedSlug = selectedSlugRef.current;
        rebuildCorridor(currentObservedSlug);
        requestRender();
      }
      if (currentResetCount !== resetTriggerRef.current) {
        currentResetCount = resetTriggerRef.current;
        flyTargetRef.current = new THREE.Vector3(0.8, 3.2, 5.4);
        controls.target.set(0, 1.85, 0);
        requestRender();
      }

      if (!isSoftwareGl) {
        flightProgress = (flightProgress + dt * 0.14) % 1;
        if (flightCurve) {
          const pos = flightCurve.getPointAt(flightProgress);
          const tangent = flightCurve.getTangentAt(flightProgress);
          planeGroup.position.copy(pos);
          planeGroup.lookAt(pos.clone().add(tangent));
        }
        needsRender = true;
      } else if (flightCurve) {
        planeGroup.position.copy(flightCurve.getPointAt(0.55));
        planeGroup.lookAt(flightCurve.getPointAt(0.55).add(flightCurve.getTangentAt(0.55)));
      }

      if (flyTargetRef.current) {
        const alpha = 1 - Math.exp(-4.5 * dt);
        camera.position.lerp(flyTargetRef.current, alpha);
        if (camera.position.distanceTo(flyTargetRef.current) < 0.05) {
          flyTargetRef.current = null;
        }
        needsRender = true;
      }

      if (needsRender) {
        controls.update();
        renderer.render(scene, camera);
        if (isSoftwareGl) {
          needsRender = false;
        }
      }
    };

    rafId = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      controls.removeEventListener('change', requestRender);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      envTarget.dispose();
      pmrem.dispose();
      skyTex.dispose();
      shadowTex.dispose();
      colorMap.dispose();
      roughnessMap.dispose();
      bumpMap.dispose();
      scene.traverse((obj) => {
        if ((obj as THREE.Mesh).geometry) {
          (obj as THREE.Mesh).geometry.dispose();
        }
        const mat = (obj as THREE.Mesh).material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) mat.dispose();
      });
      renderer.dispose();
    };
  }, []);

  const handlePresetCamera = (mode: 'orbit' | 'corridor' | 'close') => {
    setCameraMode(mode);
    const coord = COUNTRY_COORDS[selectedSlug] || COUNTRY_COORDS.germany;
    const vec = latLngToVec3(coord.lat, coord.lng, 1.32);
    const dist = mode === 'close' ? 3.3 : mode === 'corridor' ? 4.4 : 5.4;
    flyTargetRef.current = new THREE.Vector3(0, 1.9, 0).add(vec.normalize().multiplyScalar(dist));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A] dark:text-white flex items-center gap-2">
            <Compass className="w-6 h-6 text-[#2563EB]" />
            <span>Interactive 3D Destination Globe</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Drag to orbit, scroll to zoom, or click any destination pin on the armillary globe to trace pathways from India.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {(['orbit', 'corridor', 'close'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => handlePresetCamera(m)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition-colors ${
                cameraMode === m
                  ? 'bg-[#142B5F] text-white border-[#142B5F] dark:bg-[#2563EB] dark:border-[#2563EB]'
                  : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {m === 'orbit' ? 'Global Orbit' : m === 'corridor' ? 'Flight Corridor' : 'Close Inspect'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              resetTriggerRef.current += 1;
              setCameraMode('orbit');
            }}
            aria-label="Reset 3D camera"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset</span>
          </button>
        </div>
      </div>

      {/* Full-viewport 3D stage with compact solid collapsible bottom dock */}
      <div className="relative w-full h-[72vh] min-h-[520px] rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[#0b1326]">
        <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

        {/* Compact Solid Bottom Dock (no backdrop-filter over WebGL, <= 15% height) */}
        <div className="absolute bottom-3 left-3 right-3 rounded-xl border border-slate-700 bg-[#0B1120] text-slate-100 px-4 py-2.5 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <select
                aria-label="Select destination country on 3D globe"
                value={selectedSlug}
                onChange={(e) => setSelectedSlug(e.target.value)}
                className="rounded-lg border border-slate-700 bg-[#111827] px-2.5 py-1.5 text-xs font-semibold text-white"
              >
                {countries.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white truncate">
                  {selectedCountry?.name || 'Germany'} · {activeCoord.hubCity}
                </p>
                {!dockCollapsed && (
                  <p className="text-[11px] text-slate-400 truncate max-w-xl">
                    {selectedCountry?.living_cost_estimate || 'Explore verified university hubs and official portals.'}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => onSelectCountryHub(selectedSlug)}
                className="rounded-lg bg-[#2563EB] hover:bg-[#1d4ed8] px-3 py-1.5 text-xs font-semibold text-white"
              >
                Open Country Hub
              </button>
              <button
                type="button"
                onClick={() => setDockCollapsed((v) => !v)}
                aria-label={dockCollapsed ? 'Expand details' : 'Collapse details'}
                className="rounded-lg border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800"
              >
                {dockCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
