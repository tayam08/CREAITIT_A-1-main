"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Mesh, MeshPhysicalMaterial, Vector3 } from "three";

type ConnectionStatus = "connecting" | "connected" | "sign-in" | "authorizing" | "offline";
type RpcRequest = <T = unknown>(method: string, params?: Record<string, unknown>) => Promise<T>;
type ChatMessage = { id: string; role: "user" | "assistant"; content: string };
type AccountResult = { account?: { planType?: string } | null };
type ModelResult = { data?: Array<{ model: string; displayName?: string }> };
type ThreadResult = { thread?: { id?: string } };

const TARGET_MODEL_ID = "gpt-5.6-luna";
const RPC_TIMEOUT_MS = 20_000;

const starters = [
  { label: "아이디어", prompt: "새로운 프로젝트 아이디어를 함께 구체화해줘." },
  { label: "글쓰기", prompt: "내가 쓸 글의 구조부터 함께 잡아줘." },
  { label: "분석", prompt: "복잡한 주제를 핵심부터 이해하기 쉽게 분석해줘." },
];

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function VoxelScene({ quiet }: { quiet: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const quietRef = useRef(quiet);

  useEffect(() => {
    quietRef.current = quiet;
  }, [quiet]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import("three").then((THREE) => {
      if (disposed || !mount.isConnected) return;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xf5f4ef, 0.032);

    const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 100);
    camera.position.set(0, 0.2, 21);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.setClearColor(0xf5f4ef, 0);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xc7c5bd, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
    keyLight.position.set(7, 11, 9);
    keyLight.castShadow = true;
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xd8d3ef, 1.15);
    fillLight.position.set(-8, -2, 5);
    scene.add(fillLight);

    const voxelGroup = new THREE.Group();
    voxelGroup.position.y = 0.25;
    scene.add(voxelGroup);

    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const materials = [
      new THREE.MeshStandardMaterial({ color: 0xf0f0ed, roughness: 0.55, metalness: 0.02 }),
      new THREE.MeshStandardMaterial({ color: 0xdededa, roughness: 0.68, metalness: 0.01 }),
      new THREE.MeshStandardMaterial({ color: 0xc8c9c8, roughness: 0.72, metalness: 0.03 }),
      new THREE.MeshStandardMaterial({ color: 0xa9abaa, roughness: 0.8, metalness: 0.01 }),
    ];

    let seed = 190812;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };

    for (let index = 0; index < 58; index += 1) {
      const cube = new THREE.Mesh(geometry, materials[Math.floor(random() * materials.length)]);
      const radius = 5.1 * Math.cbrt(random());
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      cube.position.set(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
      );
      cube.rotation.set(
        Math.floor(random() * 4) * (Math.PI / 2),
        Math.floor(random() * 4) * (Math.PI / 2),
        Math.floor(random() * 4) * (Math.PI / 2),
      );
      const base = 0.34 + random() * 1.25;
      cube.scale.set(base * (0.72 + random() * 0.5), base, base * (0.72 + random() * 0.5));
      cube.userData.baseScale = cube.scale.clone();
      cube.castShadow = true;
      cube.receiveShadow = true;
      voxelGroup.add(cube);
    }

    let pointerX = 0;
    let pointerY = 0;
    const onPointerMove = (event: PointerEvent) => {
      pointerX = (event.clientX / window.innerWidth - 0.5) * 0.95;
      pointerY = (event.clientY / window.innerHeight - 0.5) * 0.7;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clock = new THREE.Clock();
    let frame = 0;
    let lastRender = -1;

    const resize = () => {
      const width = mount.clientWidth || window.innerWidth;
      const height = mount.clientHeight || window.innerHeight;
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      if (reducedMotion.matches && lastRender >= 0) renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const animate = (timestamp: number) => {
      frame = 0;
      if (document.hidden) return;
      const minimumFrameTime = quietRef.current ? 1000 / 30 : 0;
      if (lastRender >= 0 && timestamp - lastRender < minimumFrameTime) {
        frame = window.requestAnimationFrame(animate);
        return;
      }
      lastRender = timestamp;

      const time = clock.getElapsedTime();
      const motion = reducedMotion.matches ? 0 : quietRef.current ? 0.22 : 1;
      voxelGroup.rotation.y += (pointerX - voxelGroup.rotation.y) * 0.018 * motion + 0.00125 * motion;
      voxelGroup.rotation.x += (-pointerY - voxelGroup.rotation.x) * 0.018 * motion;
      voxelGroup.position.y = 0.25 + Math.sin(time * 0.42) * 0.22 * motion;

      for (let index = 0; index < voxelGroup.children.length; index += 1) {
        const child = voxelGroup.children[index];
        const cube = child as Mesh;
        const base = cube.userData.baseScale as Vector3;
        const pulse = 1 + Math.sin(time * 1.25 + index * 0.74) * 0.018 * motion;
        cube.scale.copy(base).multiplyScalar(pulse);
      }
      renderer.render(scene, camera);
      if (!reducedMotion.matches) frame = window.requestAnimationFrame(animate);
    };
    const restartAnimation = () => {
      if (!document.hidden && !frame) frame = window.requestAnimationFrame(animate);
    };
    reducedMotion.addEventListener("change", restartAnimation);
    document.addEventListener("visibilitychange", restartAnimation);
    frame = window.requestAnimationFrame(animate);

    cleanup = () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      reducedMotion.removeEventListener("change", restartAnimation);
      document.removeEventListener("visibilitychange", restartAnimation);
      observer.disconnect();
      geometry.dispose();
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <div ref={mountRef} className="voxel-scene" aria-hidden="true" />;
}

function LogoScene({ quiet }: { quiet: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const quietRef = useRef(quiet);

  useEffect(() => {
    quietRef.current = quiet;
  }, [quiet]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let cleanup: (() => void) | undefined;

    void import("three").then((THREE) => {
      if (disposed || !mount.isConnected) return;

    const frontInspection = new URLSearchParams(window.location.search).get("logoView") === "front";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(37, 1, 0.1, 100);
    camera.position.set(0, 0.15, 18);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setClearColor(0x020305, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    mount.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0x6b86c7, 1.75));
    const cyanLight = new THREE.PointLight(0x71d9ee, 42, 30, 1.5);
    cyanLight.position.set(4.8, 5.2, 8);
    scene.add(cyanLight);
    const cobaltLight = new THREE.PointLight(0x2b65ff, 34, 28, 1.6);
    cobaltLight.position.set(-5.2, -2.2, 6);
    scene.add(cobaltLight);
    const rimLight = new THREE.DirectionalLight(0xa9e9ff, 2.4);
    rimLight.position.set(-4, 7, 9);
    scene.add(rimLight);

    const emblem = new THREE.Group();
    emblem.position.set(0, 3.35, 0);
    scene.add(emblem);

    const sourceTexture = new THREE.TextureLoader().load("/creait-logo-original.png");
    // The source channels select physical alloys and cutting depth. They are not
    // emitted as a painted color map on the finished badge.
    sourceTexture.colorSpace = THREE.NoColorSpace;
    sourceTexture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

    const source = {
      width: 3043,
      height: 990,
      left: 122,
      right: 789,
      top: 40,
      bottom: 796,
    };
    const logoBounds = { left: -3.5, right: 3.5, bottom: -4, top: 4 };

    // Extracted from the supplied PNG at a low threshold so the badge keeps the
    // complete ribbon silhouette, including its narrow pointed folds.
    const silhouettePixels: Array<[number, number]> = [
      [458, 40], [455, 182], [627, 279], [659, 300], [661, 304],
      [457, 420], [455, 290], [247, 409], [245, 293], [413, 62],
      [122, 228], [122, 611], [442, 796], [439, 793], [439, 655],
      [442, 653], [453, 659], [285, 564], [247, 539], [452, 421],
      [455, 421], [455, 550], [665, 432], [665, 548], [498, 783],
      [788, 616], [788, 231],
    ];
    const toLogoPoint = ([pixelX, pixelY]: [number, number]) => new THREE.Vector2(
      logoBounds.left + ((pixelX - source.left) / (source.right - source.left)) * (logoBounds.right - logoBounds.left),
      logoBounds.top - ((pixelY - source.top) / (source.bottom - source.top)) * (logoBounds.top - logoBounds.bottom),
    );
    const silhouette = silhouettePixels.map(toLogoPoint);
    const logoShape = new THREE.Shape();
    logoShape.moveTo(silhouette[0].x, silhouette[0].y);
    silhouette.slice(1).forEach((point) => logoShape.lineTo(point.x, point.y));
    logoShape.closePath();

    const badgeDepth = 0.68;
    const reliefDepth = 0.16;
    const bodyFrontZ = badgeDepth / 2 + 0.075;
    const faceSurfaceZ = badgeDepth / 2 + 0.082;
    const backSurfaceZ = -badgeDepth / 2 - 0.082;
    const bodyGeometry = new THREE.ExtrudeGeometry(logoShape, {
      depth: badgeDepth,
      steps: 1,
      bevelEnabled: true,
      bevelThickness: 0.075,
      bevelSize: 0.055,
      bevelOffset: -0.012,
      bevelSegments: 3,
      curveSegments: 10,
    });
    bodyGeometry.translate(0, 0, -badgeDepth / 2);

    const capMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x123b92,
      metalness: 0.96,
      roughness: 0.2,
      clearcoat: 0.42,
      clearcoatRoughness: 0.16,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const sideMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x071d49,
      metalness: 0.95,
      roughness: 0.24,
      clearcoat: 0.5,
      clearcoatRoughness: 0.18,
      transparent: true,
      opacity: 0,
    });
    const depthUvCrop = new THREE.Vector4(
      source.left / source.width,
      1 - source.bottom / source.height,
      source.right / source.width,
      1 - source.top / source.height,
    );
    const sculptBounds = new THREE.Vector4(
      logoBounds.left,
      logoBounds.bottom,
      logoBounds.right,
      logoBounds.top,
    );
    const applySolidSculpt = (material: MeshPhysicalMaterial) => {
      material.onBeforeCompile = (shader) => {
        shader.uniforms.sculptLogoMap = { value: sourceTexture };
        shader.uniforms.sculptLogoCrop = { value: depthUvCrop };
        shader.uniforms.sculptBounds = { value: sculptBounds };
        shader.uniforms.sculptReliefDepth = { value: reliefDepth };
        shader.uniforms.sculptInfluenceStart = { value: -badgeDepth * 0.18 };
        shader.uniforms.sculptInfluenceEnd = { value: bodyFrontZ };
        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            `#include <common>
            uniform sampler2D sculptLogoMap;
            uniform vec4 sculptLogoCrop;
            uniform vec4 sculptBounds;
            uniform float sculptReliefDepth;
            uniform float sculptInfluenceStart;
            uniform float sculptInfluenceEnd;`,
          )
          .replace(
            "#include <begin_vertex>",
            `#include <begin_vertex>
            vec2 sculptPlaneUv = clamp(vec2(
              (position.x - sculptBounds.x) / (sculptBounds.z - sculptBounds.x),
              (position.y - sculptBounds.y) / (sculptBounds.w - sculptBounds.y)
            ), 0.0, 1.0);
            vec2 sculptTextureUv = vec2(
              mix(sculptLogoCrop.x, sculptLogoCrop.z, sculptPlaneUv.x),
              mix(sculptLogoCrop.y, sculptLogoCrop.w, sculptPlaneUv.y)
            );
            vec3 sculptLogoColor = texture2D(sculptLogoMap, sculptTextureUv).rgb;
            float sculptCoverage = smoothstep(
              0.012,
              0.065,
              max(max(sculptLogoColor.r, sculptLogoColor.g), sculptLogoColor.b)
            );
            float sculptLuminance = dot(sculptLogoColor, vec3(0.2126, 0.7152, 0.0722));
            float sculptDepth = pow(smoothstep(0.018, 0.735, sculptLuminance), 1.12);
            float sculptFrontInfluence = smoothstep(
              sculptInfluenceStart,
              sculptInfluenceEnd,
              position.z
            );
            transformed.z += sculptDepth * sculptReliefDepth * sculptCoverage * sculptFrontInfluence;`,
          );
      };
      material.customProgramCacheKey = () => "creait-solid-sculpt-v2";
    };
    applySolidSculpt(capMaterial);
    applySolidSculpt(sideMaterial);
    const badgeBody = new THREE.Mesh(bodyGeometry, [capMaterial, sideMaterial]);
    badgeBody.castShadow = true;
    emblem.add(badgeBody);

    const frontGeometry = new THREE.PlaneGeometry(
      logoBounds.right - logoBounds.left,
      logoBounds.top - logoBounds.bottom,
      144,
      160,
    );
    const frontMaterial = new THREE.ShaderMaterial({
      uniforms: {
        logoMap: { value: sourceTexture },
        logoCrop: {
          value: new THREE.Vector4(
            source.left / source.width,
            1 - source.bottom / source.height,
            source.right / source.width,
            1 - source.top / source.height,
          ),
        },
        reliefDepth: { value: reliefDepth },
        fade: { value: 0 },
      },
      vertexShader: `
        uniform sampler2D logoMap;
        uniform vec4 logoCrop;
        uniform float reliefDepth;
        varying vec2 vLogoUv;
        varying vec3 vViewPosition;

        void main() {
          vLogoUv = vec2(
            mix(logoCrop.x, logoCrop.z, uv.x),
            mix(logoCrop.y, logoCrop.w, uv.y)
          );
          vec3 logoColor = texture2D(logoMap, vLogoUv).rgb;
          float coverage = smoothstep(0.012, 0.065, max(max(logoColor.r, logoColor.g), logoColor.b));
          float luminance = dot(logoColor, vec3(0.2126, 0.7152, 0.0722));
          float shadingDepth = pow(smoothstep(0.018, 0.735, luminance), 1.12);
          vec3 sculptedPosition = position;
          sculptedPosition.z += shadingDepth * reliefDepth * coverage;
          vec4 viewPosition = modelViewMatrix * vec4(sculptedPosition, 1.0);
          vViewPosition = viewPosition.xyz;
          gl_Position = projectionMatrix * viewPosition;
        }
      `,
      fragmentShader: `
        uniform sampler2D logoMap;
        uniform float fade;
        varying vec2 vLogoUv;
        varying vec3 vViewPosition;

        vec3 selectAnodizedAlloy(vec3 sourceColor) {
          // A 64-step spectral series keeps the supplied color hierarchy while
          // remaining discrete anodized metal selection rather than bitmap paint.
          vec3 spectralAlloy = pow(sourceColor, vec3(0.985, 0.975, 0.965));
          spectralAlloy *= vec3(0.23, 1.02, 1.06);
          return floor(clamp(spectralAlloy, 0.0, 1.0) * 63.0 + 0.5) / 63.0;
        }

        void main() {
          vec3 logoColor = texture2D(logoMap, vLogoUv).rgb;
          float coverage = smoothstep(0.012, 0.065, max(max(logoColor.r, logoColor.g), logoColor.b));
          if (coverage < 0.01) discard;

          vec3 surfaceNormal = normalize(cross(dFdx(vViewPosition), dFdy(vViewPosition)));
          if (surfaceNormal.z < 0.0) surfaceNormal *= -1.0;
          vec3 viewDirection = normalize(-vViewPosition);
          vec3 cyanDirection = normalize(vec3(-0.34, 0.52, 0.78));
          vec3 cobaltDirection = normalize(vec3(0.46, -0.24, 0.72));
          float cyanReflection = max(dot(surfaceNormal, cyanDirection), 0.0);
          float cobaltReflection = max(dot(surfaceNormal, cobaltDirection), 0.0);
          float metalSpecular = pow(max(dot(reflect(-cyanDirection, surfaceNormal), viewDirection), 0.0), 44.0);
          float metalRim = pow(1.0 - max(dot(surfaceNormal, viewDirection), 0.0), 3.2);
          vec3 anodizedAlloy = selectAnodizedAlloy(logoColor);
          float broadReflection = 0.91 + cyanReflection * 0.055 + cobaltReflection * 0.035;
          vec3 reflectedMetal = anodizedAlloy * broadReflection;
          reflectedMetal += vec3(0.07, 0.68, 1.0) * metalSpecular * 0.14;
          reflectedMetal += vec3(0.03, 0.32, 0.92) * metalRim * 0.055;
          float blueDominance = smoothstep(0.30, 0.78, logoColor.b - logoColor.r);
          reflectedMetal.r *= 0.55 * mix(0.76, 0.20, blueDominance);
          gl_FragColor = vec4(reflectedMetal, coverage * fade);
        }
      `,
      transparent: true,
      side: THREE.FrontSide,
      toneMapped: false,
      depthWrite: true,
      extensions: { derivatives: true },
    });
    const frontFace = new THREE.Mesh(frontGeometry, frontMaterial);
    frontFace.position.z = faceSurfaceZ;
    frontFace.renderOrder = 3;
    emblem.add(frontFace);

    const backGeometry = new THREE.ShapeGeometry(logoShape, 10);
    const backMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x0a2f74,
      metalness: 0.94,
      roughness: 0.23,
      clearcoat: 0.6,
      clearcoatRoughness: 0.22,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0,
    });
    const backFace = new THREE.Mesh(backGeometry, backMaterial);
    backFace.position.z = backSurfaceZ;
    emblem.add(backFace);

    const edgeGeometry = new THREE.EdgesGeometry(bodyGeometry, 34);
    const edgeMaterial = new THREE.ShaderMaterial({
      uniforms: {
        logoMap: { value: sourceTexture },
        logoCrop: { value: depthUvCrop },
        logoBounds: { value: sculptBounds },
        reliefDepth: { value: reliefDepth },
        influenceStart: { value: -badgeDepth * 0.18 },
        influenceEnd: { value: bodyFrontZ },
        fade: { value: 0 },
      },
      vertexShader: `
        uniform sampler2D logoMap;
        uniform vec4 logoCrop;
        uniform vec4 logoBounds;
        uniform float reliefDepth;
        uniform float influenceStart;
        uniform float influenceEnd;

        void main() {
          vec2 planeUv = clamp(vec2(
            (position.x - logoBounds.x) / (logoBounds.z - logoBounds.x),
            (position.y - logoBounds.y) / (logoBounds.w - logoBounds.y)
          ), 0.0, 1.0);
          vec2 textureUv = vec2(
            mix(logoCrop.x, logoCrop.z, planeUv.x),
            mix(logoCrop.y, logoCrop.w, planeUv.y)
          );
          vec3 logoColor = texture2D(logoMap, textureUv).rgb;
          float coverage = smoothstep(0.012, 0.065, max(max(logoColor.r, logoColor.g), logoColor.b));
          float luminance = dot(logoColor, vec3(0.2126, 0.7152, 0.0722));
          float shadingDepth = pow(smoothstep(0.018, 0.735, luminance), 1.12);
          float frontInfluence = smoothstep(influenceStart, influenceEnd, position.z);
          vec3 sculptedPosition = position;
          sculptedPosition.z += shadingDepth * reliefDepth * coverage * frontInfluence;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(sculptedPosition, 1.0);
        }
      `,
      fragmentShader: `
        uniform float fade;
        void main() {
          gl_FragColor = vec4(0.443, 0.851, 0.933, fade);
        }
      `,
      transparent: true,
      toneMapped: false,
    });
    const edgeHighlight = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    edgeHighlight.scale.setScalar(1.004);
    emblem.add(edgeHighlight);

    let pointerX = 0;
    let pointerY = 0;
    const onPointerMove = (event: PointerEvent) => {
      pointerX = event.clientX / window.innerWidth - 0.5;
      pointerY = event.clientY / window.innerHeight - 0.5;
    };
    window.addEventListener("pointermove", onPointerMove, { passive: true });

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const clock = new THREE.Clock();
    const logoScaleMultiplier = 1.3;
    const targetScaleVector = new THREE.Vector3();
    let frame = 0;
    let lastRender = -1;
    let compactScale = 0.47 * logoScaleMultiplier;
    let compactY = 2.8;

    const resize = () => {
      const width = mount.clientWidth || window.innerWidth;
      const height = mount.clientHeight || window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      compactScale = (width < 620 ? 0.34 : width < 900 ? 0.42 : 0.47) * logoScaleMultiplier;
      compactY = width < 620 ? 2.75 : width < 900 ? 3 : 2.8;
      emblem.scale.setScalar(compactScale * (quietRef.current ? 0.84 : 1));
      emblem.position.set(0, compactY, 0);
      if (reducedMotion.matches && lastRender >= 0) renderer.render(scene, camera);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    const animate = (timestamp: number) => {
      frame = 0;
      if (document.hidden) return;
      const minimumFrameTime = quietRef.current ? 1000 / 30 : 0;
      if (lastRender >= 0 && timestamp - lastRender < minimumFrameTime) {
        frame = window.requestAnimationFrame(animate);
        return;
      }
      lastRender = timestamp;

      const time = clock.getElapsedTime();
      const motion = frontInspection || reducedMotion.matches ? 0 : quietRef.current ? 0.18 : 1;
      const reveal = frontInspection || reducedMotion.matches ? 1 : THREE.MathUtils.clamp(time / 1.2, 0, 1);
      const easedReveal = 1 - Math.pow(1 - reveal, 4);

      capMaterial.opacity = 0;
      sideMaterial.opacity = easedReveal;
      frontMaterial.uniforms.fade.value = easedReveal;
      backMaterial.opacity = easedReveal;
      edgeMaterial.uniforms.fade.value = frontInspection ? 0 : easedReveal * 0.4;
      badgeBody.scale.setScalar(0.93 + easedReveal * 0.07);
      frontFace.position.z = faceSurfaceZ + (1 - easedReveal) * 1.45;
      backFace.position.z = backSurfaceZ - (1 - easedReveal) * 1.15;
      edgeHighlight.scale.setScalar(0.96 + easedReveal * 0.044);

      const targetScale = compactScale * (quietRef.current ? 0.84 : 1);
      targetScaleVector.setScalar(targetScale);
      emblem.scale.lerp(targetScaleVector, 0.045);
      const continuousSpin = frontInspection ? 0 : reducedMotion.matches ? -0.12 : time * 0.34;
      const targetRotationX = 0.09 + Math.sin(time * 0.31) * 0.026 * motion - pointerY * 0.1 * motion;
      emblem.rotation.y = frontInspection ? 0 : (1 - easedReveal) * -0.34 + continuousSpin + pointerX * 0.06 * motion;
      // The QA view compensates for the logo's elevated screen position so the
      // optical axis is perpendicular to the machined face.
      emblem.rotation.x = frontInspection ? 0.146 : emblem.rotation.x + (targetRotationX - emblem.rotation.x) * 0.035;
      emblem.rotation.z = frontInspection ? 0 : -0.022 + Math.sin(time * 0.26) * 0.014 * motion;
      emblem.position.x = 0;
      emblem.position.y = compactY + (frontInspection ? 0 : Math.sin(time * 0.52) * 0.085 * motion);
      cyanLight.position.x = frontInspection ? 4.8 : 4.8 + Math.sin(time * 0.42) * 2.2;
      cyanLight.position.y = frontInspection ? 5.2 : 4.8 + Math.cos(time * 0.37) * 1.2;
      renderer.render(scene, camera);
      if (!reducedMotion.matches) frame = window.requestAnimationFrame(animate);
    };
    const restartAnimation = () => {
      if (!document.hidden && !frame) frame = window.requestAnimationFrame(animate);
    };
    reducedMotion.addEventListener("change", restartAnimation);
    document.addEventListener("visibilitychange", restartAnimation);
    frame = window.requestAnimationFrame(animate);

    cleanup = () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onPointerMove);
      reducedMotion.removeEventListener("change", restartAnimation);
      document.removeEventListener("visibilitychange", restartAnimation);
      observer.disconnect();
      bodyGeometry.dispose();
      frontGeometry.dispose();
      backGeometry.dispose();
      edgeGeometry.dispose();
      capMaterial.dispose();
      sideMaterial.dispose();
      frontMaterial.dispose();
      backMaterial.dispose();
      edgeMaterial.dispose();
      sourceTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    });

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  return <div ref={mountRef} className="logo-scene" aria-hidden="true" />;
}

const VISITOR_NAME_STORAGE_KEY = "luna-visitor-name";
const SESSION_ID_STORAGE_KEY = "luna-session-id";
const CONSENT_AT_STORAGE_KEY = "luna-consent-at";
const VISITOR_NAME_CHANGE_EVENT = "luna-visitor-name-change";

function subscribeVisitorName(onStoreChange: () => void) {
  window.addEventListener(VISITOR_NAME_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(VISITOR_NAME_CHANGE_EVENT, onStoreChange);
}

function getVisitorNameSnapshot() {
  return sessionStorage.getItem(VISITOR_NAME_STORAGE_KEY);
}

function getSessionIdSnapshot() {
  return sessionStorage.getItem(SESSION_ID_STORAGE_KEY);
}

function subscribeLocation(onStoreChange: () => void) {
  window.addEventListener("popstate", onStoreChange);
  return () => window.removeEventListener("popstate", onStoreChange);
}

function getInviteTokenSnapshot() {
  return new URLSearchParams(window.location.search).get("invite")?.trim() || null;
}

function getVisitorNameServerSnapshot() {
  return null;
}

function commitVisitorName(name: string) {
  sessionStorage.setItem(SESSION_ID_STORAGE_KEY, crypto.randomUUID());
  sessionStorage.setItem(CONSENT_AT_STORAGE_KEY, new Date().toISOString());
  sessionStorage.setItem(VISITOR_NAME_STORAGE_KEY, name);
  window.dispatchEvent(new Event(VISITOR_NAME_CHANGE_EVENT));
}

function clearVisitorName() {
  sessionStorage.removeItem(VISITOR_NAME_STORAGE_KEY);
  sessionStorage.removeItem(SESSION_ID_STORAGE_KEY);
  sessionStorage.removeItem(CONSENT_AT_STORAGE_KEY);
  window.dispatchEvent(new Event(VISITOR_NAME_CHANGE_EVENT));
}

export function LunaExperience({ concept = "voxel" }: { concept?: "voxel" | "logo" }) {
  const visitorName = useSyncExternalStore(subscribeVisitorName, getVisitorNameSnapshot, getVisitorNameServerSnapshot);
  const sessionId = useSyncExternalStore(subscribeVisitorName, getSessionIdSnapshot, getVisitorNameServerSnapshot);
  const inviteToken = useSyncExternalStore(subscribeLocation, getInviteTokenSnapshot, getVisitorNameServerSnapshot);
  const [nameDraft, setNameDraft] = useState("");
  const [logConsent, setLogConsent] = useState(false);
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("connecting");
  const [statusNote, setStatusNote] = useState("로컬 모델을 찾는 중입니다");
  const [activeAssistantId, setActiveAssistantId] = useState<string | null>(null);
  const rpcRef = useRef<RpcRequest | null>(null);
  const threadIdRef = useRef<string | null>(null);
  const modelIdRef = useRef<string>(TARGET_MODEL_ID);
  const assistantIdRef = useRef<string | null>(null);
  const assistantContentRef = useRef("");
  const streamedReplyRef = useRef(false);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const scrollAnchorRef = useRef<HTMLDivElement>(null);
  const logTurnRef = useRef<(role: "user" | "assistant", content: string) => void>(() => {});

  function setActiveAssistant(id: string | null) {
    assistantIdRef.current = id;
    setActiveAssistantId(id);
  }

  useEffect(() => {
    if (!visitorName || !sessionId) return;

    let disposed = false;
    let nextId = 1;
    const pending = new Map<number, {
      resolve: (value: unknown) => void;
      reject: (reason: Error) => void;
      timeout: number;
    }>();
    let socket: WebSocket;
    let streamFrame = 0;
    let streamedDeltaBuffer = "";

    logTurnRef.current = (role, content) => {
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ method: "chat/log", params: { role, content } }));
      }
    };

    const rejectPending = (reason: Error) => {
      pending.forEach(({ reject, timeout }) => {
        window.clearTimeout(timeout);
        reject(reason);
      });
      pending.clear();
    };

    const flushStream = () => {
      streamFrame = 0;
      const assistantId = assistantIdRef.current;
      const delta = streamedDeltaBuffer;
      streamedDeltaBuffer = "";
      if (!assistantId || !delta || disposed) return;
      setMessages((current) => current.map((item) => (
        item.id === assistantId ? { ...item, content: item.content + delta } : item
      )));
    };

    const request: RpcRequest = (method, params = {}) => new Promise((resolve, reject) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error("Local Codex bridge is offline"));
        return;
      }
      const id = nextId++;
      const timeout = window.setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Local Codex request timed out: ${method}`));
      }, RPC_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ method, id, params }));
    });

    async function prepareSession() {
      const accountResult = await request<AccountResult>("account/read", { refreshToken: true });
      if (disposed) return;
      if (!accountResult?.account) {
        setConnectionStatus("sign-in");
        setStatusNote("ChatGPT 로그인이 필요합니다");
        return;
      }

      const models = await request<ModelResult>("model/list", { limit: 20, includeHidden: false });
      if (disposed) return;
      const selectedModel = models.data?.find((model) => model.model === TARGET_MODEL_ID);
      if (!selectedModel) {
        throw new Error("이 계정에서 GPT-5.6 Luna 모델을 사용할 수 없습니다.");
      }
      modelIdRef.current = TARGET_MODEL_ID;
      const thread = await request<ThreadResult>("thread/start", {
        model: modelIdRef.current,
        approvalPolicy: "never",
        sandbox: "read-only",
        personality: "friendly",
        serviceName: "interview_local_chat_v1",
      });
      if (disposed) return;

      threadIdRef.current = thread?.thread?.id ?? null;
      setConnectionStatus("connected");
      setStatusNote("대화를 시작할 준비가 됐습니다");
    }

    try {
      const socketParams = new URLSearchParams({
        name: visitorName,
        session_id: sessionId,
        consent_at: sessionStorage.getItem(CONSENT_AT_STORAGE_KEY) ?? new Date().toISOString(),
      });
      if (inviteToken) socketParams.set("invite", inviteToken);
      socket = new WebSocket(`ws://127.0.0.1:4501?${socketParams.toString()}`);
      socket.addEventListener("open", async () => {
        rpcRef.current = request;
        try {
          await request("initialize", {
            clientInfo: { name: "interview_local_chat_v1", title: "면접용 로컬 챗 v1", version: "1.0.0" },
          });
          if (disposed || socket.readyState !== WebSocket.OPEN) return;
          socket.send(JSON.stringify({ method: "initialized", params: {} }));
          await request("chat/session/start", { sessionId });
          await prepareSession();
        } catch (error) {
          if (!disposed) {
            setConnectionStatus("offline");
            setStatusNote(error instanceof Error ? error.message : "로컬 모델을 시작할 수 없습니다");
          }
        }
      });

      socket.addEventListener("message", (event) => {
        let message;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (typeof message.id === "number" && pending.has(message.id)) {
          const handler = pending.get(message.id)!;
          pending.delete(message.id);
          window.clearTimeout(handler.timeout);
          if (message.error) handler.reject(new Error(message.error.message ?? "Codex request failed"));
          else handler.resolve(message.result);
          return;
        }

        if (message.method === "item/agentMessage/delta" && typeof message.params?.delta === "string") {
          const assistantId = assistantIdRef.current;
          if (!assistantId) return;
          streamedReplyRef.current = true;
          streamedDeltaBuffer += message.params.delta;
          assistantContentRef.current += message.params.delta;
          if (!streamFrame) streamFrame = window.requestAnimationFrame(flushStream);
        }

        if (message.method === "item/completed" && message.params?.item?.type === "agentMessage" && !streamedReplyRef.current) {
          const assistantId = assistantIdRef.current;
          const text = message.params.item.text
            ?? message.params.item.content?.map((part: { text?: string }) => part.text ?? "").join("")
            ?? "";
          if (assistantId && text) {
            assistantContentRef.current = text;
            setMessages((current) => current.map((item) => (
              item.id === assistantId ? { ...item, content: text } : item
            )));
          }
        }

        if (message.method === "turn/completed") {
          if (streamFrame) window.cancelAnimationFrame(streamFrame);
          flushStream();
          setIsThinking(false);
          const assistantId = assistantIdRef.current;
          const errorMessage = message.params?.turn?.error?.message;
          let finalContent = assistantContentRef.current;
          if (errorMessage && assistantId) {
            finalContent = `답변을 완료하지 못했습니다. ${errorMessage}`;
            setMessages((current) => current.map((item) => (
              item.id === assistantId ? { ...item, content: finalContent } : item
            )));
            setStatusNote("응답 중 문제가 발생했습니다");
          } else {
            setStatusNote("답변이 완료됐습니다");
          }
          if (assistantId && finalContent) logTurnRef.current("assistant", finalContent);
          setActiveAssistant(null);
        }

        if (message.method === "account/login/completed") {
          if (message.params?.success) prepareSession().catch(() => setConnectionStatus("offline"));
          else {
            setConnectionStatus("sign-in");
            setStatusNote(message.params?.error ?? "로그인이 완료되지 않았습니다");
          }
        }
      });

      socket.addEventListener("close", () => {
        rejectPending(new Error("Local Codex connection closed"));
        if (!disposed) {
          rpcRef.current = null;
          threadIdRef.current = null;
          setConnectionStatus("offline");
          setIsThinking(false);
          setStatusNote("START_INTERVIEW_CHAT.cmd를 실행해 주세요");
        }
      });
      socket.addEventListener("error", () => {
        if (!disposed) setConnectionStatus("offline");
      });
    } catch {
      queueMicrotask(() => {
        setConnectionStatus("offline");
        setStatusNote("START_INTERVIEW_CHAT.cmd를 실행해 주세요");
      });
    }

    return () => {
      disposed = true;
      rpcRef.current = null;
      logTurnRef.current = () => {};
      if (streamFrame) window.cancelAnimationFrame(streamFrame);
      rejectPending(new Error("Connection closed"));
      socket?.close();
    };
  }, [inviteToken, sessionId, visitorName]);

  useEffect(() => {
    scrollAnchorRef.current?.scrollIntoView({ behavior: isThinking ? "smooth" : "auto", block: "end" });
  }, [messages, isThinking]);

  useEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [draft]);

  async function connectChatGPT() {
    if (connectionStatus === "offline") {
      setStatusNote("START_INTERVIEW_CHAT.cmd를 실행한 뒤 이 페이지를 새로고침해 주세요");
      return;
    }
    if (!rpcRef.current || connectionStatus !== "sign-in") return;
    try {
      setConnectionStatus("authorizing");
      setStatusNote("브라우저에서 로그인을 완료해 주세요");
      const login = await rpcRef.current<{ authUrl?: string }>("account/login/start", {
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
        appBrand: "chatgpt",
      });
      if (login?.authUrl) window.open(login.authUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setConnectionStatus("sign-in");
      setStatusNote(error instanceof Error ? error.message : "로그인을 시작하지 못했습니다");
    }
  }

  async function startNewChat() {
    if (isThinking) return;
    setMessages([]);
    setDraft("");
    setStatusNote(connectionStatus === "connected" ? "새 대화를 시작할 준비가 됐습니다" : statusNote);
    composerRef.current?.focus();

    if (connectionStatus === "connected" && rpcRef.current) {
      try {
        const thread = await rpcRef.current<ThreadResult>("thread/start", {
          model: modelIdRef.current,
          approvalPolicy: "never",
          sandbox: "read-only",
          personality: "friendly",
          serviceName: "interview_local_chat_v1",
        });
        threadIdRef.current = thread?.thread?.id ?? null;
      } catch {
        setConnectionStatus("offline");
        setStatusNote("새 대화를 열지 못했습니다");
      }
    }
  }

  async function endChat() {
    const confirmationMessage = inviteToken
      ? "채팅을 종료하고 대화 기록을 HR 지원서에 저장할까요?"
      : "이 채팅은 HR 지원서와 연결되지 않았습니다. 종료하면 이 기기에만 저장되고 HR 사이트에는 표시되지 않습니다. 그래도 종료할까요?";
    if (!window.confirm(confirmationMessage)) return;
    setIsEnding(true);
    try {
      const result = await rpcRef.current?.<{ integrationStatus?: string }>("chat/session/end", { sessionId });
      if (inviteToken) {
        if (result?.integrationStatus === "linked") {
          window.alert("HR 지원서에 대화 기록이 저장됐습니다.");
        } else if (result?.integrationStatus === "pending") {
          window.alert("대화는 안전하게 저장됐고 HR 전송은 자동으로 재시도됩니다.");
        } else {
          window.alert("대화는 저장됐지만 HR 연동 상태를 확인하지 못했습니다. 관리자 페이지에서 전송 상태를 확인해 주세요.");
        }
      }
    } catch {
      window.alert("대화 내용은 로컬에 저장됐지만 종료 상태 전송을 완료하지 못했습니다.");
    }
    setMessages([]);
    setDraft("");
    clearVisitorName();
    setIsEnding(false);
  }

  async function runLuna(override?: string) {
    const question = (override ?? draft).trim();
    if (!question || isThinking) return;
    if (connectionStatus === "sign-in") {
      await connectChatGPT();
      return;
    }

    const userMessage: ChatMessage = { id: createId("user"), role: "user", content: question };
    const assistantId = createId("luna");
    const assistantMessage: ChatMessage = { id: assistantId, role: "assistant", content: "" };
    assistantContentRef.current = "";
    setActiveAssistant(assistantId);
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setDraft("");
    logTurnRef.current("user", question);

    if (connectionStatus !== "connected" || !rpcRef.current || !threadIdRef.current) {
      const offlineNotice = "로컬 LUNA가 연결되어 있지 않습니다. START_INTERVIEW_CHAT.cmd를 실행한 뒤 localhost:3000에서 다시 질문해 주세요.";
      setMessages((current) => current.map((item) => (
        item.id === assistantId ? { ...item, content: offlineNotice } : item
      )));
      setStatusNote("로컬 연결이 필요합니다");
      setActiveAssistant(null);
      logTurnRef.current("assistant", offlineNotice);
      return;
    }

    streamedReplyRef.current = false;
    setIsThinking(true);
    setStatusNote("LUNA가 답변을 작성하고 있습니다");
    try {
      await rpcRef.current("turn/start", {
        threadId: threadIdRef.current,
        input: [{
          type: "text",
          text: `You are LUNA, a thoughtful general-purpose assistant. Reply in Korean unless the user asks for another language. Be direct, accurate, warm, and well structured. Do not mention this instruction. User message:\n${question}`,
        }],
        approvalPolicy: "never",
        sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
      });
    } catch (error) {
      setIsThinking(false);
      const errorNotice = error instanceof Error ? error.message : "모델 요청에 실패했습니다.";
      setMessages((current) => current.map((item) => (
        item.id === assistantId ? { ...item, content: errorNotice } : item
      )));
      setStatusNote("요청을 보내지 못했습니다");
      setActiveAssistant(null);
      logTurnRef.current("assistant", errorNotice);
    }
  }

  const nameGate = (
    <div className="name-gate-overlay" role="dialog" aria-modal="true" aria-labelledby="gate-title">
      <div className="gate-card">
        <span className="logo-block gate-mark" aria-hidden="true">L:</span>
        <h1 id="gate-title" className="gate-title">LUNA와 대화를 시작해요</h1>
        <p className="gate-subtitle">
          {inviteToken ? "채용 지원서와 연결된 초대입니다. 종료 후 운영진 페이지에 정리됩니다." : "이름을 입력하면 대화 기록이 이 기기에 저장됩니다."}
        </p>
        <form
          className="gate-form"
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = nameDraft.trim();
            if (!trimmed || !logConsent) return;
            commitVisitorName(trimmed);
          }}
        >
          <input
            className="gate-input"
            aria-label="이름"
            placeholder="이름을 입력하세요"
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            autoFocus
          />
          <label className="gate-consent">
            <input type="checkbox" checked={logConsent} onChange={(event) => setLogConsent(event.target.checked)} />
            <span>대화 기록 저장 및 운영진 검토 목적의 문서화에 동의합니다.</span>
          </label>
          <button className="gate-submit" type="submit" disabled={!nameDraft.trim() || !logConsent}>동의하고 시작하기</button>
        </form>
      </div>
    </div>
  );

  const conversationOpen = messages.length > 0;
  const connectionLabel = connectionStatus === "connected"
    ? "CONNECTED"
    : connectionStatus === "sign-in"
      ? "SIGN IN"
      : connectionStatus === "authorizing"
        ? "AUTHORIZING"
        : connectionStatus === "connecting"
          ? "CONNECTING"
          : "LOCAL OFFLINE";

  const composer = (centered: boolean) => (
    <div className={`composer ${centered ? "composer-centered" : "composer-docked"}`}>
      <textarea
        ref={composerRef}
        aria-label="LUNA에게 질문하기"
        placeholder="무엇이든 물어보세요"
        rows={1}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void runLuna();
          }
        }}
      />
      <div className="composer-actions">
        <button className="add-button" type="button" aria-label="첨부 기능은 준비 중입니다" title="첨부 기능 준비 중" disabled>+</button>
        <span>{statusNote}</span>
        <button
          className="send-button"
          type="button"
          aria-label={connectionStatus === "sign-in" ? "ChatGPT 로그인" : "질문 보내기"}
          onClick={() => void runLuna()}
          disabled={isThinking || connectionStatus === "connecting" || connectionStatus === "authorizing" || (!draft.trim() && connectionStatus !== "sign-in")}
        >
          {isThinking ? <i className="stop-mark" /> : <span aria-hidden="true">↑</span>}
        </button>
      </div>
    </div>
  );

  return (
    <main className={`luna-shell ${concept === "logo" ? "logo-concept-shell" : ""} ${conversationOpen ? "conversation-open" : "welcome-open"}`}>
      {concept === "logo" ? <LogoScene quiet={conversationOpen} /> : <VoxelScene quiet={conversationOpen} />}
      <div className="paper-grain" aria-hidden="true" />
      {!visitorName && nameGate}

      <header className="edge-header">
        {concept !== "logo" && (
          <button className="logo-block" type="button" onClick={() => void startNewChat()} aria-label="새 LUNA 대화">L:</button>
        )}
        <nav className="main-nav" aria-label="주요 메뉴">
          <strong>LUNA</strong>
          <button type="button" onClick={() => void startNewChat()}>NEW CHAT</button>
          {visitorName && <button type="button" onClick={() => void endChat()} disabled={isThinking || isEnding}>{isEnding ? "저장 중" : "채팅 종료"}</button>}
          <span>LOCAL SESSION</span>
        </nav>
        <button
          className={`connection-state ${connectionStatus}`}
          type="button"
          onClick={() => void connectChatGPT()}
          disabled={connectionStatus === "connected" || connectionStatus === "connecting" || connectionStatus === "authorizing"}
        >
          <i /> {connectionLabel}
        </button>
      </header>

      {!conversationOpen ? (
        <section className="welcome-stage" aria-labelledby="welcome-title">
          {concept === "logo" ? (
            <div className="hero-lockup logo-hero-lockup">
              <span>WELCOME TO</span>
              <h1 id="welcome-title" aria-label="CREAI+IT">CRE<em>AI</em>+IT</h1>
            </div>
          ) : (
            <div className="hero-lockup">
              <div className="hero-row hero-row-one">
                <span className="title-pill lilac">Welcome</span>
                <h1 id="welcome-title" className="pixel-title">TO</h1>
              </div>
              <div className="hero-row hero-row-two">
                <h1 className="pixel-title">CREAI+IT</h1>
              </div>
            </div>
          )}

          <div className="center-question">
            {composer(true)}
            <div className="starter-row" aria-label="질문 예시">
              {starters.map((starter) => (
                <button key={starter.label} type="button" onClick={() => void runLuna(starter.prompt)}>
                  <span>{starter.label}</span>
                  <small>{starter.prompt}</small>
                </button>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="conversation" aria-label="LUNA와의 대화">
          <div className="thread-meta">
            <span>THREAD / {String(Math.ceil(messages.length / 2)).padStart(2, "0")}</span>
          </div>
          <div className="message-list" aria-live="polite">
            {messages.map((message) => message.role === "user" ? (
              <article className="message user-turn" key={message.id}>
                <div className="message-copy">{message.content}</div>
              </article>
            ) : (
              <article className="message luna-turn" key={message.id}>
                <span className="assistant-mark" aria-hidden="true">L:</span>
                <div className="message-copy">
                  {message.content || (isThinking && activeAssistantId === message.id
                    ? <span className="thinking-line"><i /><i /><i /></span>
                    : "응답이 비어 있습니다.")}
                </div>
              </article>
            ))}
            <div ref={scrollAnchorRef} />
          </div>
          <div className="docked-composer-wrap">{composer(false)}</div>
        </section>
      )}

    </main>
  );
}

export default function Home() {
  return <LunaExperience />;
}
