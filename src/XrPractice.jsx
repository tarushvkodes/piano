import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { XRButton } from 'three/examples/jsm/webxr/XRButton.js';

const FIRST_NOTE = 21;
const LAST_NOTE = 108;
const WHITE_PITCHES = new Set([0, 2, 4, 5, 7, 9, 11]);
const LOOKAHEAD_SECONDS = 5.5;

function buildKeyboard() {
  const keys = [];
  let whiteIndex = 0;
  for (let midi = FIRST_NOTE; midi <= LAST_NOTE; midi += 1) {
    const isWhite = WHITE_PITCHES.has(midi % 12);
    const key = { midi, isWhite, whiteIndex };
    if (isWhite) {
      key.left = whiteIndex;
      whiteIndex += 1;
    } else {
      key.left = whiteIndex - 0.36;
    }
    keys.push(key);
  }
  return { keys, whiteCount: whiteIndex };
}

function midiColor(midi) {
  const hue = ((midi - FIRST_NOTE) * 17) % 360;
  return new THREE.Color(`hsl(${hue}, 68%, 52%)`);
}

function makeTextSprite(text, options = {}) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = options.background || 'rgba(12,17,16,0.72)';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = options.color || '#fffdf8';
  context.font = `700 ${options.size || 64}px system-ui, -apple-system, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(options.width || 1.8, options.height || 0.45, 1);
  return sprite;
}

function disposeObject(object) {
  object.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        if (material.map) material.map.dispose();
        material.dispose();
      });
    }
  });
}

export default function XrPractice({
  song,
  currentTime,
  playing,
  currentTargets,
  pressedSet,
  hitNotes,
  noteName,
  onRewind,
}) {
  const mountRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneDataRef = useRef(null);
  const [xrSupported, setXrSupported] = useState(false);
  const [xrSessionMode, setXrSessionMode] = useState('immersive-vr');
  const { keys, whiteCount } = useMemo(buildKeyboard, []);

  useEffect(() => {
    let mounted = true;
    const checkSupport = async () => {
      if (!navigator.xr) {
        if (mounted) setXrSupported(false);
        return;
      }

      const ar = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
      const vr = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
      if (!mounted) return;
      setXrSupported(Boolean(ar || vr));
      setXrSessionMode(ar ? 'immersive-ar' : 'immersive-vr');
    };

    checkSupport();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c1110);
    const camera = new THREE.PerspectiveCamera(58, mount.clientWidth / mount.clientHeight, 0.01, 60);
    camera.position.set(0, 2.1, 4.8);
    camera.lookAt(0, 0.25, -1.2);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.xr.enabled = true;
    rendererRef.current = renderer;
    mount.appendChild(renderer.domElement);

    const ambient = new THREE.HemisphereLight(0xf8f4ea, 0x0d1514, 1.6);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xf7cf5c, 2.1);
    keyLight.position.set(2.5, 5, 3);
    scene.add(keyLight);

    const rig = new THREE.Group();
    rig.position.set(0, -0.55, -1.15);
    scene.add(rig);

    const keyboard = new THREE.Group();
    const keyMeshes = new Map();
    const totalWidth = 7.2;
    const whiteWidth = totalWidth / whiteCount;
    keys.forEach((key) => {
      const width = key.isWhite ? whiteWidth * 0.92 : whiteWidth * 0.58;
      const depth = key.isWhite ? 0.92 : 0.58;
      const height = key.isWhite ? 0.08 : 0.14;
      const geometry = new THREE.BoxGeometry(width, height, depth);
      const material = new THREE.MeshStandardMaterial({
        color: key.isWhite ? 0xfffdf8 : 0x171d1c,
        roughness: 0.62,
        metalness: 0.02,
      });
      const mesh = new THREE.Mesh(geometry, material);
      const left = (key.left / whiteCount - 0.5) * totalWidth;
      mesh.position.set(left + width / 2, key.isWhite ? 0 : 0.09, key.isWhite ? 0 : -0.16);
      mesh.userData.baseY = mesh.position.y;
      keyboard.add(mesh);
      keyMeshes.set(key.midi, mesh);
    });
    keyboard.position.z = 0.9;
    rig.add(keyboard);

    const laneGroup = new THREE.Group();
    rig.add(laneGroup);
    const notePool = Array.from({ length: 96 }, () => {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.045, 0.42),
        new THREE.MeshStandardMaterial({ color: 0xf7cf5c, emissive: 0x111111, roughness: 0.38 })
      );
      mesh.visible = false;
      laneGroup.add(mesh);
      return mesh;
    });

    const targetLine = new THREE.Mesh(
      new THREE.BoxGeometry(totalWidth, 0.025, 0.05),
      new THREE.MeshBasicMaterial({ color: 0xf7cf5c })
    );
    targetLine.position.set(0, 0.24, 0.48);
    rig.add(targetLine);

    const railMaterial = new THREE.LineBasicMaterial({ color: 0x33524d, transparent: true, opacity: 0.45 });
    const rails = new THREE.Group();
    for (let i = 0; i <= whiteCount; i += 4) {
      const x = (i / whiteCount - 0.5) * totalWidth;
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x, 0.05, -4.6),
        new THREE.Vector3(x, 0.05, 0.92),
      ]);
      rails.add(new THREE.Line(geometry, railMaterial));
    }
    rig.add(rails);

    const title = makeTextSprite('Quest Practice View', { width: 2.4, height: 0.5, size: 62 });
    title.position.set(0, 1.35, -1.9);
    rig.add(title);

    const status = makeTextSprite('Load a song, then enter VR from Quest Browser', { width: 3.4, height: 0.42, size: 44 });
    status.position.set(0, 1.02, -1.9);
    rig.add(status);

    const controllerGroup = new THREE.Group();
    for (let index = 0; index < 2; index += 1) {
      const controller = renderer.xr.getController(index);
      const pointer = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1.2)]),
        new THREE.LineBasicMaterial({ color: 0xf7cf5c, transparent: true, opacity: 0.7 })
      );
      controller.add(pointer);
      controllerGroup.add(controller);
    }
    scene.add(controllerGroup);

    sceneDataRef.current = {
      scene,
      camera,
      renderer,
      rig,
      keyMeshes,
      notePool,
      status,
      whiteWidth,
      totalWidth,
    };

    const resize = () => {
      if (!mount.clientWidth || !mount.clientHeight) return;
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener('resize', resize);
    renderer.setAnimationLoop(() => {
      renderer.render(scene, camera);
    });

    return () => {
      window.removeEventListener('resize', resize);
      renderer.setAnimationLoop(null);
      if (renderer.xr.getSession()) renderer.xr.getSession().end();
      mount.removeChild(renderer.domElement);
      disposeObject(scene);
      renderer.dispose();
      rendererRef.current = null;
      sceneDataRef.current = null;
    };
  }, [keys, whiteCount]);

  useEffect(() => {
    const data = sceneDataRef.current;
    if (!data) return;

    data.keyMeshes.forEach((mesh, midi) => {
      const pressed = pressedSet.has(midi);
      const target = currentTargets.has(midi);
      mesh.position.y = mesh.userData.baseY + (pressed ? -0.04 : 0);
      mesh.material.color.set(target ? midiColor(midi) : mesh.geometry.parameters.depth > 0.7 ? 0xfffdf8 : 0x171d1c);
      mesh.material.emissive.set(target ? midiColor(midi).multiplyScalar(0.18) : 0x000000);
    });

    const visibleNotes = song?.notes.filter((note) => (
      note.end >= currentTime - 0.25 && note.start <= currentTime + LOOKAHEAD_SECONDS
    )).slice(0, data.notePool.length) || [];

    data.notePool.forEach((mesh, index) => {
      const note = visibleNotes[index];
      if (!note) {
        mesh.visible = false;
        return;
      }

      const key = keys.find((candidate) => candidate.midi === note.midi);
      const x = ((key?.left || 0) / whiteCount - 0.5) * data.totalWidth + data.whiteWidth * 0.45;
      const z = 0.48 - ((note.start - currentTime) / LOOKAHEAD_SECONDS) * 5.1;
      const length = Math.max(0.28, (note.duration / LOOKAHEAD_SECONDS) * 5.1);
      mesh.visible = true;
      mesh.position.set(x, 0.34, z - length / 2);
      mesh.scale.set((key?.isWhite ? 0.9 : 0.58), 1, length / 0.42);
      mesh.material.color.set(midiColor(note.midi));
      mesh.material.emissive.set(hitNotes.has(note.id) ? 0xffffff : 0x151515);
    });

    const label = song
      ? `${song.fileName || song.name} | ${playing ? 'playing' : 'paused'} | ${currentTime.toFixed(1)}s`
      : 'Load a song, then enter VR from Quest Browser';
    const replacement = makeTextSprite(label, { width: 3.8, height: 0.42, size: 38 });
    replacement.position.copy(data.status.position);
    data.rig.remove(data.status);
    disposeObject(data.status);
    data.rig.add(replacement);
    data.status = replacement;
  }, [currentTargets, currentTime, hitNotes, keys, playing, pressedSet, song, whiteCount]);

  const enterXr = useCallback(async () => {
    const renderer = rendererRef.current;
    if (!renderer || !navigator.xr) return;
    const session = await navigator.xr.requestSession(xrSessionMode, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'layers', 'bounded-floor'],
    });
    renderer.xr.setReferenceSpaceType('local-floor');
    await renderer.xr.setSession(session);
  }, [xrSessionMode]);

  const makeNativeButton = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const existing = document.querySelector('.xrNativeButtonHost button');
    if (existing) return;
    const button = XRButton.createButton(renderer, {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['hand-tracking', 'layers', 'bounded-floor'],
    });
    document.querySelector('.xrNativeButtonHost')?.appendChild(button);
  }, []);

  useEffect(() => {
    makeNativeButton();
  }, [makeNativeButton, xrSupported]);

  return (
    <section className="xrPanel">
      <div className="xrCanvasShell" ref={mountRef}>
        <div className="xrOverlay">
          <div>
            <span>Meta Quest 3</span>
            <strong>{song?.fileName || 'Load a MIDI song'}</strong>
          </div>
          <div>
            <span>Mode</span>
            <strong>{xrSupported ? xrSessionMode.replace('immersive-', '').toUpperCase() : 'Desktop preview'}</strong>
          </div>
          <div>
            <span>Target</span>
            <strong>{[...currentTargets].map(noteName).join(' ') || 'Ready'}</strong>
          </div>
        </div>
      </div>
      <div className="xrActions">
        <button className="primary" onClick={enterXr} disabled={!xrSupported}>
          Enter Quest XR
        </button>
        <button className="secondary" onClick={onRewind} disabled={!song}>
          Reset song
        </button>
        <div className="xrNativeButtonHost" />
      </div>
      <p className="hint">
        Open this local site in Meta Quest Browser over HTTPS or a trusted local tunnel, pair the FP-10 if Web MIDI is available there, then use the XR view as the floating piano-roll overlay.
      </p>
    </section>
  );
}
