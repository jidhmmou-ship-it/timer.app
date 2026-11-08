/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import {
  initAudioOnGesture,
  playLaunchSound,
  playNeckSnapSound,
  playImpactSound,
  playMergeSound,
  playRippleSound,
  playTickSound,
  startRainSound,
  stopRainSound,
  setRainVolume,
} from './audio';

interface PointerHistory {
  x: number;
  y: number;
  time: number;
}

type DropletStatus = 'extruding' | 'floating' | 'docking' | 'evaporating' | 'merged_out';

interface DropletState {
  id: string;
  index: number;

  // Position & Velocity
  x: number;
  y: number;
  vx: number;
  vy: number;

  // Size, Mass & Merges
  scale: number;
  targetScale: number;
  baseRadius: number;
  mass: number;
  merges: number;
  opacity: number;

  // Liquid harmonic wobble oscillator
  wobbleX: number;
  wobbleY: number;
  wobbleVelX: number;
  wobbleVelY: number;

  // Lifecycle & transition
  status: DropletStatus;
  transStartTime: number;
  transStartX: number;
  transStartY: number;
  transTargetX: number;
  transTargetY: number;
  hasSnapped: boolean;

  // Evaporation fade-to-nothing animation
  evaporateStartTime: number;
  evaporateDuration: number;
  evaporateStartScale: number;

  // Drag interaction
  isDragging: boolean;
  dragPointerId: number;
  dragOffsetX: number;
  dragOffsetY: number;
  targetX: number;
  targetY: number;
  history: PointerHistory[];

  // Visual stacking order
  zIndex: number;
  lastVaporTime: number;
  lastRippleTime: number;
  lastActiveTime: number;
}

interface VaporParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  initialRadius: number;
  currentRadius: number;
  initialOpacity: number;
  currentOpacity: number;
  life: number;
  maxLife: number;
}

interface SplashParticle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  initialRadius: number;
  currentRadius: number;
  initialOpacity: number;
  currentOpacity: number;
  life: number;
  maxLife: number;
}

export default function App() {
  const taskbarBeadRef = useRef<HTMLButtonElement>(null);
  const bridgeSvgRef = useRef<SVGSVGElement>(null);
  const cardElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  // Vapor trail circle pool refs
  const vaporParticlesRef = useRef<VaporParticle[]>([]);
  const vaporCircleRefs = useRef<(SVGCircleElement | null)[]>([]);
  const nextVaporIdRef = useRef(1);

  // Splash particle pool refs (radial burst upon edge/floor impact)
  const splashParticlesRef = useRef<SplashParticle[]>([]);
  const splashCircleRefs = useRef<(SVGCircleElement | null)[]>([]);
  const nextSplashIdRef = useRef(1);

  // Dynamic list of active droplet windows
  const [dropletList, setDropletList] = useState<{ id: string; index: number; merges: number }[]>([]);
  const [currentTime, setCurrentTime] = useState('');
  const [currentDate, setCurrentDate] = useState('');

  // Draggable Widget Position (defaults to bottom center or side)
  const [widgetPos, setWidgetPos] = useState<{ x: number; y: number } | null>(null);
  const isDraggingWidgetRef = useRef(false);
  const widgetDragStartRef = useRef({ pointerX: 0, pointerY: 0, initX: 0, initY: 0 });

  // Liquid Hue selection ('clear' | 'ocean' | 'sunset')
  const [liquidHue, setLiquidHue] = useState<'clear' | 'ocean' | 'sunset'>('clear');

  // Evaporation Rate Setting (0 = off, 1 = maximum)
  const [evaporationRate, setEvaporationRate] = useState(0.2);
  const evaporationRateRef = useRef(0.2);

  // Pomodoro Timer State
  const [pomodoroMode, setPomodoroMode] = useState<'work' | 'break'>('work');
  const [pomodoroDuration, setPomodoroDuration] = useState(25); // minutes
  const [pomodoroBreakDuration, setPomodoroBreakDuration] = useState(5); // minutes
  const [pomodoroTimeLeft, setPomodoroTimeLeft] = useState(25 * 60); // seconds
  const [pomodoroRunning, setPomodoroRunning] = useState(false);
  const [pomodoroRainAudio, setPomodoroRainAudio] = useState(true);
  const [pomodoroTicking, setPomodoroTicking] = useState(true);
  const [showPomodoroModal, setShowPomodoroModal] = useState(false);

  // Surface tension toggle state & ref for 60-120fps RAF physics loop
  const [surfaceTension, setSurfaceTension] = useState(true);
  const surfaceTensionRef = useRef(true);

  // Toggle surface tension mutual attraction between droplets
  const toggleSurfaceTension = useCallback(() => {
    initAudioOnGesture();
    playRippleSound();
    setSurfaceTension((prev) => {
      const next = !prev;
      surfaceTensionRef.current = next;

      // Agitate floating droplets slightly when tension field changes
      for (const d of dropletsRef.current) {
        if (d.status === 'floating') {
          d.wobbleVelX += (Math.random() - 0.5) * 5;
          d.wobbleVelY += (Math.random() - 0.5) * 5;
        }
      }
      return next;
    });
  }, []);

  // Simulation physics state in refs (60-120fps direct RAF updates)
  const dropletsRef = useRef<DropletState[]>([]);
  const dockCoordsRef = useRef({ x: 0, y: 0 });
  const nextIndexRef = useRef(1);
  const topZRef = useRef(15);
  const lastTimeRef = useRef(0);

  // Live clock & clean date display
  useEffect(() => {
    const updateTimeAndDate = () => {
      const d = new Date();
      setCurrentTime(d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      setCurrentDate(`${day}/${month}/${year}`);
    };
    updateTimeAndDate();
    const interval = setInterval(updateTimeAndDate, 1000);
    return () => clearInterval(interval);
  }, []);

  // Device orientation state in ref for 60-120fps RAF physics loop
  const orientationRef = useRef<{
    hasSensor: boolean;
    targetX: number;
    targetY: number;
    currentX: number;
    currentY: number;
  }>({
    hasSensor: false,
    targetX: 0,
    targetY: 1, // default vertical downward gravity
    currentX: 0,
    currentY: 1,
  });

  // Device orientation listener with iOS permission support and smooth tilt filtering
  useEffect(() => {
    let isMounted = true;

    const handleOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma === null && e.beta === null) return;

      const gamma = e.gamma ?? 0; // -90 to 90 (left to right tilt)
      const beta = e.beta ?? 0;   // -180 to 180 (front to back tilt)

      // Clamp tilt angles to natural handling range
      const clampedGamma = Math.max(-60, Math.min(60, gamma));
      const clampedBeta = Math.max(-90, Math.min(90, beta));

      const gammaRad = (clampedGamma * Math.PI) / 180;
      const betaRad = (clampedBeta * Math.PI) / 180;

      // Subtle directional tilt acceleration vector
      const tiltX = Math.sin(gammaRad);
      const tiltY = Math.sin(betaRad);

      orientationRef.current.hasSensor = true;
      orientationRef.current.targetX = tiltX;
      orientationRef.current.targetY = tiltY;
    };

    const requestAndAttach = () => {
      if (
        typeof DeviceOrientationEvent !== 'undefined' &&
        typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }).requestPermission === 'function'
      ) {
        (DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> })
          .requestPermission()
          .then((res: string) => {
            if (res === 'granted' && isMounted) {
              window.addEventListener('deviceorientation', handleOrientation, true);
            }
          })
          .catch(() => {});
      } else if (typeof window !== 'undefined' && 'DeviceOrientationEvent' in window) {
        window.addEventListener('deviceorientation', handleOrientation, true);
      }
    };

    requestAndAttach();

    // Re-check on first user gesture for browsers requiring user gesture (e.g. iOS Safari)
    const handleGesture = () => {
      requestAndAttach();
      window.removeEventListener('pointerdown', handleGesture);
    };
    window.addEventListener('pointerdown', handleGesture, { once: true });

    return () => {
      isMounted = false;
      window.removeEventListener('deviceorientation', handleOrientation, true);
      window.removeEventListener('pointerdown', handleGesture);
    };
  }, []);

  // Pomodoro Timer Interval Engine
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (pomodoroRunning) {
      if (pomodoroRainAudio) {
        startRainSound(evaporationRate);
        setRainVolume(evaporationRate);
      }
      interval = setInterval(() => {
        setPomodoroTimeLeft((prev) => {
          if (pomodoroTicking && prev > 1) {
            playTickSound(prev % 2 === 0);
          }
          if (prev <= 1) {
            playMergeSound();
            if (pomodoroMode === 'work') {
              setPomodoroMode('break');
              return pomodoroBreakDuration * 60;
            } else {
              setPomodoroMode('work');
              return pomodoroDuration * 60;
            }
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      stopRainSound();
    }

    return () => {
      if (interval) clearInterval(interval);
      stopRainSound();
    };
  }, [
    pomodoroRunning,
    pomodoroMode,
    pomodoroDuration,
    pomodoroBreakDuration,
    pomodoroRainAudio,
    pomodoroTicking,
    evaporationRate,
  ]);

  const togglePomodoro = useCallback(() => {
    initAudioOnGesture();
    playRippleSound();
    setPomodoroRunning((prev) => !prev);
  }, []);

  const resetPomodoro = useCallback(() => {
    initAudioOnGesture();
    playRippleSound();
    setPomodoroRunning(false);
    stopRainSound();
    setPomodoroTimeLeft(pomodoroDuration * 60);
    setPomodoroMode('work');
  }, [pomodoroDuration]);

  const toggleRainAudio = useCallback(() => {
    initAudioOnGesture();
    playRippleSound();
    setPomodoroRainAudio((prev) => {
      const next = !prev;
      if (pomodoroRunning) {
        if (next) {
          startRainSound(evaporationRate);
          setRainVolume(evaporationRate);
        } else {
          stopRainSound();
        }
      }
      return next;
    });
  }, [pomodoroRunning, evaporationRate]);

  // Draggable Widget Handlers
  const handleWidgetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // If the click originated from an interactive input or button, ignore drag
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'BUTTON' ||
      target.tagName === 'INPUT' ||
      target.closest('button') ||
      target.closest('input')
    ) {
      return;
    }

    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    isDraggingWidgetRef.current = true;

    const rect = e.currentTarget.getBoundingClientRect();
    const currentX = widgetPos ? widgetPos.x : rect.left;
    const currentY = widgetPos ? widgetPos.y : rect.top;

    widgetDragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      initX: currentX,
      initY: currentY,
    };
  };

  const handleWidgetPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingWidgetRef.current) return;
    const dx = e.clientX - widgetDragStartRef.current.pointerX;
    const dy = e.clientY - widgetDragStartRef.current.pointerY;

    const newX = Math.max(10, Math.min(window.innerWidth - 180, widgetDragStartRef.current.initX + dx));
    const newY = Math.max(10, Math.min(window.innerHeight - 80, widgetDragStartRef.current.initY + dy));

    setWidgetPos({ x: newX, y: newY });
  };

  const handleWidgetPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingWidgetRef.current) {
      isDraggingWidgetRef.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {}
      setTimeout(updateDockCoords, 20);
    }
  };

  // Update taskbar dock coordinates
  const updateDockCoords = useCallback(() => {
    if (taskbarBeadRef.current) {
      const rect = taskbarBeadRef.current.getBoundingClientRect();
      dockCoordsRef.current = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      };
    }
  }, []);

  useEffect(() => {
    updateDockCoords();
    window.addEventListener('resize', updateDockCoords);
    return () => window.removeEventListener('resize', updateDockCoords);
  }, [updateDockCoords]);

  // Dock (close) a specific droplet window back into the taskbar
  const dockDroplet = useCallback((id: string) => {
    initAudioOnGesture();
    updateDockCoords();
    const dock = dockCoordsRef.current;

    const drop = dropletsRef.current.find((d) => d.id === id);
    if (!drop || drop.status === 'docking' || drop.status === 'evaporating' || drop.status === 'merged_out') return;

    drop.status = 'docking';
    drop.isDragging = false;
    drop.transStartTime = performance.now();
    drop.transStartX = drop.x;
    drop.transStartY = drop.y;
    drop.transTargetX = dock.x;
    drop.transTargetY = dock.y;
    drop.vx = 0;
    drop.vy = 0;
  }, [updateDockCoords]);

  // Evaporate a specific droplet window into nothingness with a smooth vaporization animation
  const handleEvaporate = useCallback((id: string) => {
    initAudioOnGesture();
    const drop = dropletsRef.current.find((d) => d.id === id);
    if (!drop || drop.status === 'evaporating' || drop.status === 'merged_out') return;

    drop.status = 'evaporating';
    drop.evaporateStartTime = performance.now();
    drop.evaporateDuration = 0.46;
    drop.evaporateStartScale = drop.scale;
    drop.isDragging = false;
    drop.vx *= 0.3;
    drop.vy = -36;
    playRippleSound();
  }, []);

  // Trigger a subtle water ripple animation on the surface of a droplet
  const triggerDropletRipple = useCallback((dropletId: string, x: number, y: number, force = false) => {
    const drop = dropletsRef.current.find((d) => d.id === dropletId);
    const now = performance.now();
    if (drop && !force) {
      if (now - drop.lastRippleTime < 160) return;
      drop.lastRippleTime = now;
    }
    const el = cardElementsRef.current.get(dropletId);
    if (!el) return;

    const rippleSpan = document.createElement('span');
    rippleSpan.className = 'water-surface-ripple';
    rippleSpan.style.left = `${Math.round(x)}px`;
    rippleSpan.style.top = `${Math.round(y)}px`;
    rippleSpan.style.width = '36px';
    rippleSpan.style.height = '36px';
    el.appendChild(rippleSpan);

    setTimeout(() => {
      rippleSpan.remove();
    }, 900);
  }, []);

  // Spawn a new independent 1:1 droplet app window from the taskbar
  const spawnDroplet = useCallback(() => {
    initAudioOnGesture();
    updateDockCoords();

    const dock = dockCoordsRef.current;
    const newIndex = nextIndexRef.current++;
    const newId = `drop-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

    const screenW = window.innerWidth;
    const screenH = window.innerHeight;

    // Distribute spawned droplets across the viewport
    const count = dropletsRef.current.filter((d) => d.status !== 'merged_out').length;
    const offsetSlot = (count % 4) - 1.5;
    const spreadX = offsetSlot * 160 + (Math.random() - 0.5) * 60;
    const targetX = Math.max(130, Math.min(screenW - 130, screenW / 2 + spreadX));
    const targetY = Math.max(150, screenH * 0.38 + (Math.random() - 0.5) * 80);

    topZRef.current += 1;

    const newDrop: DropletState = {
      id: newId,
      index: newIndex,
      x: dock.x,
      y: dock.y,
      vx: (Math.random() - 0.5) * 80,
      vy: -240,
      scale: 0.22,
      targetScale: 1.0,
      baseRadius: 100,
      mass: 1.0,
      merges: 1,
      wobbleX: 0,
      wobbleY: 0,
      wobbleVelX: 0,
      wobbleVelY: 0,
      status: 'extruding',
      transStartTime: performance.now(),
      transStartX: dock.x,
      transStartY: dock.y,
      transTargetX: targetX,
      transTargetY: targetY,
      hasSnapped: false,
      isDragging: false,
      dragPointerId: -1,
      dragOffsetX: 0,
      dragOffsetY: 0,
      targetX: dock.x,
      targetY: dock.y,
      history: [],
      zIndex: topZRef.current,
      lastVaporTime: 0,
      lastRippleTime: 0,
      lastActiveTime: performance.now(),
      opacity: 1,
      evaporateStartTime: 0,
      evaporateDuration: 0.35,
      evaporateStartScale: 1.0,
    };

    dropletsRef.current.push(newDrop);
    setDropletList((prev) => [...prev, { id: newId, index: newIndex, merges: 1 }]);
    playLaunchSound();
  }, [updateDockCoords]);

  // Main 60-120fps Animation & Physics Loop with Multi-Droplet Collision Engine
  useEffect(() => {
    let animId: number;

    const GRAVITY = 720;
    const AIR_RESISTANCE = 0.986;
    const BOUNCE_RESTITUTION_BOTTOM = 0.28;
    const BOUNCE_RESTITUTION_WALL = 0.36;
    const SPRING_K = 115;
    const SPRING_DAMP = 14;

    const loop = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const dt = Math.min((timestamp - lastTimeRef.current) / 1000, 0.033);
      lastTimeRef.current = timestamp;

      const screenW = window.innerWidth;
      const screenH = window.innerHeight;
      const dock = dockCoordsRef.current;
      const taskbarTop = dock.y - 35;
      const drops = dropletsRef.current;
      const pendingRemovals: string[] = [];
      const bridgePaths: string[] = [];

      // Smooth interpolation of device tilt orientation vector (eliminates sensor jitter)
      const orient = orientationRef.current;
      const LERP_FACTOR = Math.min(1, 14 * dt);
      orient.currentX += (orient.targetX - orient.currentX) * LERP_FACTOR;
      orient.currentY += (orient.targetY - orient.currentY) * LERP_FACTOR;

      // Directional acceleration vector based on device tilt (subtle and natural)
      const gravityX = orient.currentX * GRAVITY * 0.92;
      const gravityY = orient.currentY * GRAVITY * 0.92;

      // Radial burst of tiny, white, semi-transparent splash particles on edge or floor impact
      // Refined with rotational jitter and distance-based opacity gradient
      const triggerSplash = (
        originX: number,
        originY: number,
        normalX: number,
        normalY: number,
        impactSpeed: number,
        scale: number
      ) => {
        const count = Math.min(28, Math.max(10, Math.round(impactSpeed * 0.036 * scale)));
        const baseAngle = Math.atan2(normalY, normalX);

        for (let i = 0; i < count; i++) {
          // Rotational jitter around normal vector
          const rotationalJitter = (Math.random() - 0.5) * 0.28;
          const spread = (Math.random() - 0.5) * Math.PI * 0.88 + rotationalJitter;
          const angle = baseAngle + spread;

          // Ejection velocity scaled with impact energy
          const speedFactor = 0.22 + Math.random() * 0.78;
          const burstSpeed = speedFactor * Math.min(impactSpeed * 0.85, 760);
          const pVx = Math.cos(angle) * burstSpeed + (Math.random() - 0.5) * 32;
          const pVy = Math.sin(angle) * burstSpeed + (Math.random() - 0.5) * 32;

          // Initial spawn offset from contact center
          const distFromCenter = Math.random() * 9 * Math.min(scale, 1.2);
          const pX = originX + Math.cos(angle) * distFromCenter;
          const pY = originY + Math.sin(angle) * distFromCenter;

          // Opacity varies with distance from impact center: denser/brighter at core, feathering outward
          const distanceNorm = Math.min(1, distFromCenter / 9);
          const initialOpacity = Math.max(0.45, 0.92 - distanceNorm * 0.35 + (Math.random() - 0.5) * 0.1);

          const baseRadius = 1.2 + Math.random() * 2.2 * Math.min(scale, 1.25);
          const maxLife = 0.28 + Math.random() * 0.22;

          splashParticlesRef.current.push({
            id: nextSplashIdRef.current++,
            x: pX,
            y: pY,
            vx: pVx,
            vy: pVy,
            initialRadius: baseRadius,
            currentRadius: baseRadius,
            initialOpacity,
            currentOpacity: initialOpacity,
            life: 0,
            maxLife,
          });
        }

        if (splashParticlesRef.current.length > 120) {
          splashParticlesRef.current.splice(0, splashParticlesRef.current.length - 120);
        }
      };

      // 1. Update individual transitions & single-body kinematics
      for (const drop of drops) {
        if (drop.status === 'merged_out') continue;

        const effectiveRadius = drop.baseRadius * drop.scale;
        const minX = effectiveRadius + 8;
        const maxX = screenW - effectiveRadius - 8;
        const minY = effectiveRadius + 8;
        const maxY = Math.min(screenH - effectiveRadius - 8, taskbarTop - 12);

        // Smooth scale interpolation (e.g. after merging or budding)
        drop.scale += (drop.targetScale - drop.scale) * Math.min(1, 10 * dt);

        // A. Extruding transition
        if (drop.status === 'extruding') {
          const elapsed = (timestamp - drop.transStartTime) / 1000;
          const duration = 0.72;
          const progress = Math.min(1, elapsed / duration);
          const easeOut = 1 - Math.pow(1 - progress, 3);

          drop.x = drop.transStartX + (drop.transTargetX - drop.transStartX) * easeOut;
          drop.y = drop.transStartY + (drop.transTargetY - drop.transStartY) * easeOut;

          if (progress < 0.42) {
            const stretchPhase = progress / 0.42;
            drop.scale = 0.22 + stretchPhase * 0.35;
            drop.wobbleY = 0.26 * Math.sin(stretchPhase * Math.PI);
            drop.wobbleX = -0.15 * Math.sin(stretchPhase * Math.PI);

            // Draw liquid bridge connecting taskbar to this extruding drop
            const neckRadiusDock = 22 * (1 - stretchPhase * 0.4);
            const neckRadiusDrop = 14 + stretchPhase * 16;
            const pinchWidth = Math.max(3, 18 * (1 - stretchPhase * 0.85));
            const midY = (dock.y + drop.y) / 2;

            bridgePaths.push(`
              M ${dock.x - neckRadiusDock} ${dock.y}
              Q ${dock.x - pinchWidth} ${midY}, ${drop.x - neckRadiusDrop} ${drop.y}
              L ${drop.x + neckRadiusDrop} ${drop.y}
              Q ${dock.x + pinchWidth} ${midY}, ${dock.x + neckRadiusDock} ${dock.y}
              Z
            `);
          } else {
            if (!drop.hasSnapped) {
              drop.hasSnapped = true;
              playNeckSnapSound();
            }
            const bloomPhase = (progress - 0.42) / 0.58;
            drop.scale = 0.57 + (drop.targetScale - 0.57) * (1 - Math.pow(1 - bloomPhase, 2));
            drop.wobbleY = 0.12 * Math.cos(bloomPhase * Math.PI * 3) * (1 - bloomPhase);
            drop.wobbleX = -0.08 * Math.cos(bloomPhase * Math.PI * 3) * (1 - bloomPhase);
          }

          if (progress >= 1) {
            drop.status = 'floating';
            drop.vx = 0;
            drop.vy = 0;
            drop.wobbleX = 0;
            drop.wobbleY = 0;
          }
        }

        // B. Docking transition
        else if (drop.status === 'docking') {
          const elapsed = (timestamp - drop.transStartTime) / 1000;
          const duration = 0.52;
          const progress = Math.min(1, elapsed / duration);
          const easeIn = Math.pow(progress, 2.5);

          drop.x = drop.transStartX + (drop.transTargetX - drop.transStartX) * easeIn;
          drop.y = drop.transStartY + (drop.transTargetY - drop.transStartY) * easeIn;
          drop.scale = Math.max(0.18, drop.targetScale * (1 - easeIn * 0.82));

          drop.wobbleY = 0.22 * Math.sin(progress * Math.PI);
          drop.wobbleX = -0.12 * Math.sin(progress * Math.PI);

          if (progress > 0.55) {
            const absorbPhase = (progress - 0.55) / 0.45;
            const pinchWidth = 14 * absorbPhase;
            const midY = (dock.y + drop.y) / 2;
            bridgePaths.push(`
              M ${dock.x - 20} ${dock.y}
              Q ${dock.x - pinchWidth} ${midY}, ${drop.x - 14} ${drop.y}
              L ${drop.x + 14} ${drop.y}
              Q ${dock.x + pinchWidth} ${midY}, ${dock.x + 20} ${dock.y}
              Z
            `);
          }

          if (progress >= 1) {
            drop.status = 'evaporating';
            drop.evaporateStartTime = timestamp;
            drop.evaporateDuration = 0.28;
            drop.evaporateStartScale = drop.scale;
            playMergeSound();
          }
        }

        // C. Evaporation transition (fade-to-nothing animation simulating liquid vaporization)
        else if (drop.status === 'evaporating') {
          const elapsed = (timestamp - drop.evaporateStartTime) / 1000;
          const duration = drop.evaporateDuration || 0.44;
          const progress = Math.min(1, elapsed / duration);

          // Nonlinear cubic shrink curve towards scale 0
          drop.scale = drop.evaporateStartScale * Math.pow(1 - progress, 2.2);

          // Smooth exponential opacity fade to complete transparency
          drop.opacity = Math.max(0, Math.pow(1 - progress, 1.4));

          // Soft thermal mist ascent and horizontal velocity dampening
          drop.y -= 28 * dt;
          drop.x += drop.vx * dt * 0.4;
          drop.vx *= 0.92;

          // Emit soft mist vapor particles that dissipate in the air
          if (Math.random() < 0.45 && progress < 0.85) {
            vaporParticlesRef.current.push({
              id: nextVaporIdRef.current++,
              x: drop.x + (Math.random() - 0.5) * (drop.baseRadius * drop.scale * 0.8),
              y: drop.y - Math.random() * 8,
              vx: (Math.random() - 0.5) * 14,
              vy: -28 - Math.random() * 22,
              initialRadius: Math.max(3, 16 * drop.scale),
              currentRadius: Math.max(3, 16 * drop.scale),
              initialOpacity: Math.min(0.5, drop.opacity * 0.7),
              currentOpacity: 0.35,
              life: 0,
              maxLife: 0.42 + Math.random() * 0.15,
            });
          }

          if (progress >= 1) {
            drop.status = 'merged_out';
            pendingRemovals.push(drop.id);
          }
        }

        // D. Free floating physics
        else if (drop.status === 'floating') {
          // Inactive natural evaporation over time based on evaporationRate setting
          const evapRate = evaporationRateRef.current;
          const speed = Math.hypot(drop.vx, drop.vy);

          if (drop.isDragging || speed > 50) {
            drop.lastActiveTime = timestamp;
          } else if (evapRate > 0 && timestamp - drop.lastActiveTime > 1800) {
            // Shrink inactive resting droplet naturally over time
            const shrinkStep = evapRate * 0.045 * dt;
            drop.scale = Math.max(0.12, drop.scale - shrinkStep);
            drop.targetScale = Math.min(drop.targetScale, drop.scale);

            // Emit sporadic microscopic mist particles when naturally evaporating
            if (Math.random() < evapRate * 0.15) {
              vaporParticlesRef.current.push({
                id: nextVaporIdRef.current++,
                x: drop.x + (Math.random() - 0.5) * (drop.baseRadius * drop.scale * 0.6),
                y: drop.y - Math.random() * 6,
                vx: (Math.random() - 0.5) * 8,
                vy: -18 - Math.random() * 15,
                initialRadius: Math.max(2.5, 10 * drop.scale),
                currentRadius: Math.max(2.5, 10 * drop.scale),
                initialOpacity: 0.35 * evapRate,
                currentOpacity: 0.25 * evapRate,
                life: 0,
                maxLife: 0.36 + Math.random() * 0.15,
              });
            }
          }

          // Automatic evaporation when a droplet reaches a very small scale
          if (drop.scale < 0.28) {
            drop.status = 'evaporating';
            drop.evaporateStartTime = timestamp;
            drop.evaporateDuration = Math.max(0.2, 0.44 / Math.max(0.5, evapRate * 1.6));
            drop.evaporateStartScale = drop.scale;
            playRippleSound();
            continue;
          }

          if (drop.isDragging) {
            const followSpeed = 30;
            const dx = drop.targetX - drop.x;
            const dy = drop.targetY - drop.y;

            drop.vx = dx * followSpeed;
            drop.vy = dy * followSpeed;

            drop.x += dx * Math.min(1, followSpeed * dt);
            drop.y += dy * Math.min(1, followSpeed * dt);

            drop.x = Math.max(minX, Math.min(maxX, drop.x));
            drop.y = Math.max(minY, Math.min(maxY, drop.y));

            const dragSpeed = Math.hypot(drop.vx, drop.vy);
            if (dragSpeed > 80) {
              const dragStretch = Math.min(dragSpeed * 0.00012, 0.12);
              const angle = Math.atan2(drop.vy, drop.vx);
              drop.wobbleX += (Math.cos(angle) * dragStretch - drop.wobbleX) * 0.1;
              drop.wobbleY += (Math.sin(angle) * dragStretch - drop.wobbleY) * 0.1;
            }
          } else {
            // Apply directional tilt acceleration from device orientation and air resistance
            drop.vx += gravityX * dt;
            drop.vy += gravityY * dt;
            drop.vx *= Math.pow(AIR_RESISTANCE, dt * 60);
            drop.vy *= Math.pow(AIR_RESISTANCE, dt * 60);

            drop.x += drop.vx * dt;
            drop.y += drop.vy * dt;

            // Subtle liquid meniscus elongation along the tilt angle
            if (Math.abs(gravityX) > 60) {
              drop.wobbleX += (gravityX / GRAVITY) * 0.02 * dt * 10;
            }

            // Floor collision
            if (drop.y >= maxY) {
              drop.y = maxY;
              const impactSpeed = drop.vy;
              if (impactSpeed > 40) {
                playImpactSound(impactSpeed, 'bottom');
                const squashPower = Math.min(impactSpeed * 0.0008, 0.25);
                drop.wobbleVelY -= squashPower * 8;
                drop.wobbleVelX += squashPower * 6;
                drop.vy = -impactSpeed * BOUNCE_RESTITUTION_BOTTOM;

                // Radial burst of splash particles around base of droplet on floor impact
                const baseContactY = drop.y + effectiveRadius * 0.78;
                triggerSplash(drop.x, baseContactY, 0, -1, impactSpeed, drop.scale);

                // Surface ripple propagating from the bottom contact surface
                triggerDropletRipple(drop.id, 110, 195);
              } else {
                if (gravityY >= 0) {
                  drop.vy = 0;
                  drop.vx *= Math.pow(0.88, dt * 60); // kinetic rolling friction
                }
              }
            }

            // Ceiling collision
            if (drop.y <= minY) {
              drop.y = minY;
              const impactSpeed = Math.abs(drop.vy);
              if (impactSpeed > 40 && drop.vy < -40) {
                playImpactSound(impactSpeed, 'wall');
                const squashPower = Math.min(impactSpeed * 0.0008, 0.22);
                drop.wobbleVelY += squashPower * 6;
                drop.wobbleVelX -= squashPower * 5;

                // Radial burst of splash particles around apex of droplet on ceiling impact
                const apexContactY = drop.y - effectiveRadius * 0.78;
                triggerSplash(drop.x, apexContactY, 0, 1, impactSpeed, drop.scale);

                // Surface ripple propagating from the top contact surface
                triggerDropletRipple(drop.id, 110, 25);
                drop.vy = Math.abs(drop.vy) * BOUNCE_RESTITUTION_WALL;
              } else {
                if (gravityY <= 0) {
                  drop.vy = 0;
                  drop.vx *= Math.pow(0.88, dt * 60);
                }
              }
            }

            // Left wall collision
            if (drop.x <= minX) {
              drop.x = minX;
              const impactSpeed = Math.abs(drop.vx);
              if (impactSpeed > 35 && drop.vx < -35) {
                playImpactSound(impactSpeed, 'wall');
                const squashPower = Math.min(impactSpeed * 0.0009, 0.24);
                drop.wobbleVelX += squashPower * 7;
                drop.wobbleVelY -= squashPower * 5;

                // Radial burst of splash particles on left screen edge impact
                const leftContactX = drop.x - effectiveRadius * 0.78;
                triggerSplash(leftContactX, drop.y, 1, 0, impactSpeed, drop.scale);

                // Surface ripple propagating from the left contact surface
                triggerDropletRipple(drop.id, 25, 110);
                drop.vx = Math.abs(drop.vx) * BOUNCE_RESTITUTION_WALL;
              } else {
                if (gravityX <= 0) {
                  drop.vx = 0;
                  drop.vy *= Math.pow(0.88, dt * 60);
                }
              }
            }

            // Right wall collision
            if (drop.x >= maxX) {
              drop.x = maxX;
              const impactSpeed = Math.abs(drop.vx);
              if (impactSpeed > 35 && drop.vx > 35) {
                playImpactSound(impactSpeed, 'wall');
                const squashPower = Math.min(impactSpeed * 0.0009, 0.24);
                drop.wobbleVelX += squashPower * 7;
                drop.wobbleVelY -= squashPower * 5;

                // Radial burst of splash particles on right screen edge impact
                const rightContactX = drop.x + effectiveRadius * 0.78;
                triggerSplash(rightContactX, drop.y, -1, 0, impactSpeed, drop.scale);

                // Surface ripple propagating from the right contact surface
                triggerDropletRipple(drop.id, 195, 110);
                drop.vx = -Math.abs(drop.vx) * BOUNCE_RESTITUTION_WALL;
              } else {
                if (gravityX >= 0) {
                  drop.vx = 0;
                  drop.vy *= Math.pow(0.88, dt * 60);
                }
              }
            }

            // Vapor trail emission when thrown or moving at high speeds
            const speed = Math.hypot(drop.vx, drop.vy);
            if (speed > 330) {
              const emitInterval = Math.max(14, 32 - (speed / 1600) * 18);
              if (timestamp - drop.lastVaporTime > emitInterval) {
                drop.lastVaporTime = timestamp;

                const angle = Math.atan2(drop.vy, drop.vx);
                const trailDist = drop.baseRadius * drop.scale * 0.65;
                const spawnX = drop.x - Math.cos(angle) * trailDist + (Math.random() - 0.5) * 8;
                const spawnY = drop.y - Math.sin(angle) * trailDist + (Math.random() - 0.5) * 8;

                const baseR = Math.max(12, Math.min(34, 19 * drop.scale * Math.min(1.4, speed / 550)));
                const maxLife = 0.44 + Math.random() * 0.12;

                vaporParticlesRef.current.push({
                  id: nextVaporIdRef.current++,
                  x: spawnX,
                  y: spawnY,
                  vx: -Math.cos(angle) * 18 + (Math.random() - 0.5) * 12,
                  vy: -Math.sin(angle) * 18 + (Math.random() - 0.5) * 12,
                  initialRadius: baseR,
                  currentRadius: baseR,
                  initialOpacity: Math.min(0.68, 0.35 + (speed / 1500) * 0.3),
                  currentOpacity: 0.5,
                  life: 0,
                  maxLife,
                });

                if (vaporParticlesRef.current.length > 75) {
                  vaporParticlesRef.current.shift();
                }
              }
            }
          }

          // Harmonic wobble spring simulation
          const accX = -SPRING_K * drop.wobbleX - SPRING_DAMP * drop.wobbleVelX;
          const accY = -SPRING_K * drop.wobbleY - SPRING_DAMP * drop.wobbleVelY;
          drop.wobbleVelX += accX * dt;
          drop.wobbleVelY += accY * dt;
          drop.wobbleX += drop.wobbleVelX * dt;
          drop.wobbleY += drop.wobbleVelY * dt;

          drop.wobbleX = Math.max(-0.14, Math.min(0.14, drop.wobbleX));
          drop.wobbleY = Math.max(-0.14, Math.min(0.14, drop.wobbleY));
        }
      }

      // 2. Inter-Droplet Collision Detection & Resolution (Bounce vs Merge)
      const floatingDrops = drops.filter((d) => d.status === 'floating');
      const numFloating = floatingDrops.length;

      for (let i = 0; i < numFloating; i++) {
        const dropA = floatingDrops[i];
        if (dropA.status === 'merged_out') continue;

        for (let j = i + 1; j < numFloating; j++) {
          const dropB = floatingDrops[j];
          if (dropB.status === 'merged_out') continue;

          const dx = dropB.x - dropA.x;
          const dy = dropB.y - dropA.y;
          const dist = Math.hypot(dx, dy);

          const rA = dropA.baseRadius * dropA.scale;
          const rB = dropB.baseRadius * dropB.scale;
          const minDist = (rA + rB) * 0.96;
          const attractRange = (rA + rB) * 2.85;

          // Surface Tension Attraction Field: droplets close to each other slowly drift and pull together
          if (surfaceTensionRef.current && dist > minDist && dist < attractRange && dist > 0.001) {
            const proximity = 1 - (dist - minDist) / (attractRange - minDist);
            const tensionStrength = 480 * Math.pow(proximity, 1.35);

            const nx = dx / dist;
            const ny = dy / dist;

            if (!dropA.isDragging) {
              dropA.vx += nx * (tensionStrength / dropA.mass) * dt;
              dropA.vy += ny * (tensionStrength / dropA.mass) * dt;
              dropA.wobbleX += nx * proximity * 0.05 * dt * 8;
              dropA.wobbleY += ny * proximity * 0.05 * dt * 8;
            }

            if (!dropB.isDragging) {
              dropB.vx -= nx * (tensionStrength / dropB.mass) * dt;
              dropB.vy -= ny * (tensionStrength / dropB.mass) * dt;
              dropB.wobbleX -= nx * proximity * 0.05 * dt * 8;
              dropB.wobbleY -= ny * proximity * 0.05 * dt * 8;
            }
          }

          if (dist < minDist && dist > 0.001) {
            const nx = dx / dist;
            const ny = dy / dist;

            const relVx = dropB.vx - dropA.vx;
            const relVy = dropB.vy - dropA.vy;
            const relSpeed = Math.hypot(relVx, relVy);
            const velAlongNormal = relVx * nx + relVy * ny;

            // Merge condition: surface tension pull, gentle relative velocity, or one dragged onto the other
            const isDraggingEither = dropA.isDragging || dropB.isDragging;
            const shouldMerge =
              surfaceTensionRef.current ||
              (relSpeed < 280 && dist < minDist * 0.88) ||
              (isDraggingEither && dist < minDist * 0.72);

            if (shouldMerge) {
              // MERGE: Surface-tension coalescence!
              playMergeSound();

              // Dominant droplet absorbs the other
              const dominant = dropB.isDragging ? dropB : dropA;
              const absorbed = dominant === dropA ? dropB : dropA;

              const totalMass = dominant.mass + absorbed.mass;
              dominant.x = (dominant.x * dominant.mass + absorbed.x * absorbed.mass) / totalMass;
              dominant.y = (dominant.y * dominant.mass + absorbed.y * absorbed.mass) / totalMass;
              dominant.vx = (dominant.vx * dominant.mass + absorbed.vx * absorbed.mass) / totalMass;
              dominant.vy = (dominant.vy * dominant.mass + absorbed.vy * absorbed.mass) / totalMass;
              dominant.mass = totalMass;
              dominant.merges += absorbed.merges;

              // Expand scale gently (surface area conservation)
              dominant.targetScale = Math.min(1.42, Math.sqrt(dominant.scale ** 2 + absorbed.scale ** 2 * 0.8));

              // Fluid jiggle agitation upon coalescence
              dominant.wobbleVelY -= 12;
              dominant.wobbleVelX += 9;

              // Smoothly evaporate absorbed droplet into dominant droplet (fade to nothing)
              absorbed.status = 'evaporating';
              absorbed.evaporateStartTime = timestamp;
              absorbed.evaporateDuration = 0.32;
              absorbed.evaporateStartScale = absorbed.scale;
              absorbed.isDragging = false;
              absorbed.vx = (dominant.x - absorbed.x) * 3;
              absorbed.vy = (dominant.y - absorbed.y) * 3;

              // Trigger surface ripple on dominant droplet at point of coalescence
              const contactDirX = dominant === dropA ? nx : -nx;
              const contactDirY = dominant === dropA ? ny : -ny;
              triggerDropletRipple(dominant.id, 110 + contactDirX * 70, 110 + contactDirY * 70);
            } else if (velAlongNormal < 0) {
              // BOUNCE: High-velocity elastic liquid rebound
              const overlap = (minDist - dist) * 0.5;
              if (!dropA.isDragging) {
                dropA.x -= nx * overlap;
                dropA.y -= ny * overlap;
              }
              if (!dropB.isDragging) {
                dropB.x += nx * overlap;
                dropB.y += ny * overlap;
              }

              const RESTITUTION = 0.55;
              const impulse =
                (-(1 + RESTITUTION) * velAlongNormal) /
                (1 / dropA.mass + 1 / dropB.mass);

              if (!dropA.isDragging) {
                dropA.vx -= (impulse / dropA.mass) * nx;
                dropA.vy -= (impulse / dropA.mass) * ny;
              }
              if (!dropB.isDragging) {
                dropB.vx += (impulse / dropB.mass) * nx;
                dropB.vy += (impulse / dropB.mass) * ny;
              }

              playImpactSound(relSpeed, 'wall');

              const squash = Math.min(relSpeed * 0.0006, 0.18);
              dropA.wobbleVelX += (Math.abs(ny) - Math.abs(nx)) * squash * 8;
              dropA.wobbleVelY += (Math.abs(nx) - Math.abs(ny)) * squash * 8;
              dropB.wobbleVelX += (Math.abs(ny) - Math.abs(nx)) * squash * 8;
              dropB.wobbleVelY += (Math.abs(nx) - Math.abs(ny)) * squash * 8;

              // Trigger subtle surface ripples on both colliding droplets at their contact interfaces
              triggerDropletRipple(dropA.id, 110 + nx * 75, 110 + ny * 75);
              triggerDropletRipple(dropB.id, 110 - nx * 75, 110 - ny * 75);
            }
          }
        }
      }

      // 3. Render SVG liquid bridges
      if (bridgeSvgRef.current) {
        const pathEl = bridgeSvgRef.current.querySelector('path');
        if (pathEl) {
          pathEl.setAttribute('d', bridgePaths.join(' '));
          bridgeSvgRef.current.style.opacity = bridgePaths.length > 0 ? '1' : '0';
        }
      }

      // 4. Update and render vapor trail particles (shrinking, fading SVG circles)
      const vaporParticles = vaporParticlesRef.current;
      for (let k = vaporParticles.length - 1; k >= 0; k--) {
        const p = vaporParticles[k];
        p.life += dt / p.maxLife;
        if (p.life >= 1) {
          vaporParticles.splice(k, 1);
        } else {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 0.94;
          p.vy *= 0.94;
          // Shrink radius as vapor dissipates
          p.currentRadius = p.initialRadius * Math.pow(1 - p.life, 0.82);
          // Fade opacity
          p.currentOpacity = p.initialOpacity * Math.pow(1 - p.life, 1.25);
        }
      }

      const circles = vaporCircleRefs.current;
      const numActiveVapor = vaporParticles.length;
      for (let i = 0; i < circles.length; i++) {
        const circle = circles[i];
        if (!circle) continue;
        if (i < numActiveVapor) {
          const p = vaporParticles[i];
          circle.setAttribute('cx', p.x.toFixed(1));
          circle.setAttribute('cy', p.y.toFixed(1));
          circle.setAttribute('r', Math.max(0.1, p.currentRadius).toFixed(1));
          circle.setAttribute('opacity', p.currentOpacity.toFixed(3));
          circle.style.display = 'block';
        } else {
          circle.style.display = 'none';
        }
      }

      // 5. Update and render splash particles (radial burst around impact points)
      const splashParticles = splashParticlesRef.current;
      for (let s = splashParticles.length - 1; s >= 0; s--) {
        const sp = splashParticles[s];
        sp.life += dt / sp.maxLife;
        if (sp.life >= 1) {
          splashParticles.splice(s, 1);
        } else {
          // Ballistic parabolic trajectory with gravity and air drag
          sp.vy += GRAVITY * 0.72 * dt;
          sp.vx *= Math.pow(0.97, dt * 60);
          sp.x += sp.vx * dt;
          sp.y += sp.vy * dt;

          // Dissipation: shrink radius and fade opacity smoothly
          sp.currentRadius = sp.initialRadius * Math.pow(1 - sp.life, 0.65);
          sp.currentOpacity = sp.initialOpacity * Math.pow(1 - sp.life, 1.25);
        }
      }

      const splashCircles = splashCircleRefs.current;
      const numActiveSplash = splashParticles.length;
      for (let i = 0; i < splashCircles.length; i++) {
        const circle = splashCircles[i];
        if (!circle) continue;
        if (i < numActiveSplash) {
          const sp = splashParticles[i];
          circle.setAttribute('cx', sp.x.toFixed(1));
          circle.setAttribute('cy', sp.y.toFixed(1));
          circle.setAttribute('r', Math.max(0.1, sp.currentRadius).toFixed(1));
          circle.setAttribute('opacity', sp.currentOpacity.toFixed(3));
          circle.style.display = 'block';
        } else {
          circle.style.display = 'none';
        }
      }

      // 6. Update DOM styling for each active droplet window
      for (const drop of drops) {
        if (drop.status === 'merged_out') continue;
        const el = cardElementsRef.current.get(drop.id);
        if (!el) continue;

        const effectiveRadius = drop.baseRadius * drop.scale;
        const maxY = Math.min(screenH - effectiveRadius - 8, taskbarTop - 12);
        const bottomDistance = Math.max(0, maxY - drop.y);
        const bottomProximity = Math.max(0, Math.min(1, 1 - bottomDistance / 50));
        const bottomFlattenX = bottomProximity * 0.08;
        const bottomFlattenY = -bottomProximity * 0.06;

        const rawScaleX = (1 + drop.wobbleX + bottomFlattenX) * drop.scale;
        const rawScaleY = (1 + drop.wobbleY + bottomFlattenY) * drop.scale;

        const minScale = drop.status === 'evaporating' ? 0.001 : 0.18;
        const finalScaleX = Math.max(minScale, Math.min(1.5, rawScaleX));
        const finalScaleY = Math.max(minScale, Math.min(1.5, rawScaleY));

        const tx = drop.x - 110;
        const ty = drop.y - 110;

        el.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${finalScaleX}, ${finalScaleY})`;
        el.style.zIndex = drop.zIndex.toString();
        el.style.opacity = (drop.status === 'evaporating' ? drop.opacity : 1).toFixed(3);
        el.style.pointerEvents = drop.status === 'evaporating' ? 'none' : 'auto';

        const t = timestamp * 0.002 + drop.index;
        const breath = Math.sin(t * 2) * 1.5;

        const tl = Math.round(51 + drop.wobbleX * 6 + breath);
        const tr = Math.round(49 - drop.wobbleX * 6 - breath);
        const br = Math.round(62 * (1 - bottomProximity * 0.22) + drop.wobbleY * 5);
        const bl = Math.round(38 * (1 - bottomProximity * 0.18) - drop.wobbleY * 5);

        const vtl = Math.round(25 + bottomProximity * 12 + drop.wobbleY * 6);
        const vtr = Math.round(57 + bottomProximity * 8 - drop.wobbleY * 6);
        const vbr = Math.round(43 * (1 - bottomProximity * 0.25) - drop.wobbleX * 4);
        const vbl = Math.round(75 * (1 - bottomProximity * 0.2) + drop.wobbleX * 4);

        el.style.borderRadius = `${tl}% ${tr}% ${br}% ${bl}% / ${vtl}% ${vtr}% ${vbr}% ${vbl}%`;
      }

      // 5. Clean up merged droplets from state
      if (pendingRemovals.length > 0) {
        dropletsRef.current = dropletsRef.current.filter((d) => !pendingRemovals.includes(d.id));
        for (const id of pendingRemovals) {
          cardElementsRef.current.delete(id);
        }
        setDropletList(
          dropletsRef.current.map((d) => ({
            id: d.id,
            index: d.index,
            merges: d.merges,
          }))
        );
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Pointer dragging handlers for individual 1:1 droplet windows
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    initAudioOnGesture();
    const drop = dropletsRef.current.find((d) => d.id === id);
    if (!drop || drop.status !== 'floating') return;

    // Bring this droplet to the top of the stack
    topZRef.current += 1;
    drop.zIndex = topZRef.current;

    drop.isDragging = true;
    drop.dragPointerId = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);

    drop.dragOffsetX = e.clientX - drop.x;
    drop.dragOffsetY = e.clientY - drop.y;
    drop.targetX = e.clientX - drop.dragOffsetX;
    drop.targetY = e.clientY - drop.dragOffsetY;

    drop.history = [{ x: e.clientX, y: e.clientY, time: performance.now() }];

    drop.wobbleVelX += 2;
    drop.wobbleVelY -= 3;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    const drop = dropletsRef.current.find((d) => d.id === id);
    if (!drop || !drop.isDragging || drop.dragPointerId !== e.pointerId) return;

    drop.targetX = e.clientX - drop.dragOffsetX;
    drop.targetY = e.clientY - drop.dragOffsetY;

    const now = performance.now();
    drop.history.push({ x: e.clientX, y: e.clientY, time: now });

    while (drop.history.length > 2 && now - drop.history[0].time > 100) {
      drop.history.shift();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>, id: string) => {
    const drop = dropletsRef.current.find((d) => d.id === id);
    if (!drop || !drop.isDragging || drop.dragPointerId !== e.pointerId) return;

    drop.isDragging = false;
    drop.dragPointerId = -1;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore
    }

    const dock = dockCoordsRef.current;
    const distToDock = Math.hypot(drop.x - dock.x, drop.y - dock.y);
    if (distToDock < 140) {
      dockDroplet(drop.id);
      return;
    }

    const now = performance.now();
    const history = drop.history.filter((h) => now - h.time <= 100);

    if (history.length >= 2) {
      const oldest = history[0];
      const newest = history[history.length - 1];
      const timeDelta = (newest.time - oldest.time) / 1000;

      if (timeDelta > 0.015) {
        const throwVx = (newest.x - oldest.x) / timeDelta;
        const throwVy = (newest.y - oldest.y) / timeDelta;

        const maxSpeed = 1600;
        const speed = Math.hypot(throwVx, throwVy);
        if (speed > maxSpeed) {
          drop.vx = (throwVx / speed) * maxSpeed;
          drop.vy = (throwVy / speed) * maxSpeed;
        } else {
          drop.vx = throwVx;
          drop.vy = throwVy;
        }

        if (speed > 200) {
          const flingSquash = Math.min(speed * 0.0003, 0.12);
          drop.wobbleVelX += flingSquash * 3;
          drop.wobbleVelY -= flingSquash * 3;
        }
      }
    }
  };

  // Click inside the 1:1 window to create a water ripple
  const handleWindowClick = (e: React.MouseEvent<HTMLDivElement>, id: string) => {
    initAudioOnGesture();
    playRippleSound();

    const rect = e.currentTarget.getBoundingClientRect();
    const rippleX = e.clientX - rect.left;
    const rippleY = e.clientY - rect.top;

    triggerDropletRipple(id, rippleX, rippleY, true);

    const drop = dropletsRef.current.find((d) => d.id === id);
    if (drop) {
      drop.wobbleVelY -= 4;
      drop.wobbleVelX += 3;
    }
  };

  // Merge all floating droplets together towards center
  const handleMergeAll = () => {
    initAudioOnGesture();
    playRippleSound();

    const floaters = dropletsRef.current.filter((d) => d.status === 'floating');
    if (floaters.length <= 1) return;

    // Direct all floating droplets towards their common center of mass with high velocity
    let avgX = 0;
    let avgY = 0;
    for (const d of floaters) {
      avgX += d.x;
      avgY += d.y;
    }
    avgX /= floaters.length;
    avgY /= floaters.length;

    for (const d of floaters) {
      const angle = Math.atan2(avgY - d.y, avgX - d.x);
      d.vx = Math.cos(angle) * 350;
      d.vy = Math.sin(angle) * 350;
      d.wobbleVelX += 6;
      d.wobbleVelY -= 6;
    }
  };

  const activeCount = dropletList.length;

  return (
    <main
      data-hue={liquidHue}
      className="w-screen h-screen min-h-screen bg-white relative overflow-hidden m-0 p-0 select-none cursor-default"
      onPointerDown={initAudioOnGesture}
    >
      {/* ══════ Draggable Compact Widget (unified bottom bar) ══════ */}
      <div
        className="draggable-widget select-none"
        style={
          widgetPos
            ? { left: `${widgetPos.x}px`, top: `${widgetPos.y}px`, transform: 'none' }
            : { bottom: '24px', left: '50%', transform: 'translateX(-50%)' }
        }
        onPointerDown={handleWidgetPointerDown}
        onPointerMove={handleWidgetPointerMove}
        onPointerUp={handleWidgetPointerUp}
      >
        <div className="water-taskbar flex items-center gap-3 px-4 py-2">
          {/* ① Clock + Date capsule (leftmost, also serves as drag handle) */}
          <div
            className="clock-date-capsule select-none"
            title="Drag widget anywhere on screen"
          >
            <span className="text-xs font-mono font-medium tracking-wide tabular-nums text-black/75 whitespace-nowrap px-1">
              {currentTime || '14:30'} | {currentDate || '06/11/2026'}
            </span>
          </div>

          {/* ② Spawn 1:1 Droplet App Icon */}
          <div className="flex flex-col items-center gap-1">
            <button
              ref={taskbarBeadRef}
              type="button"
              aria-label="Spawn 1:1 Droplet App"
              onClick={spawnDroplet}
              className="taskbar-bead group focus:outline-none"
              title="Click to spawn new 1:1 Droplet App"
            >
              <div className="w-2.5 h-2.5 rounded-full bg-black/30 group-hover:bg-black/55 transition-all duration-200 flex items-center justify-center">
                <div className="w-1 h-1 rounded-full bg-white/80" />
              </div>
            </button>
            <div
              className={`h-1 rounded-full transition-all duration-300 flex items-center justify-center ${
                activeCount > 0
                  ? 'bg-black/45 px-1.5 opacity-100 min-w-3'
                  : 'bg-transparent opacity-0 w-1.5'
              }`}
            >
              {activeCount > 0 && (
                <span className="text-[8px] leading-none text-white font-mono font-bold">
                  {activeCount}
                </span>
              )}
            </div>
          </div>

          {/* ③ Surface Tension Setting Toggle Bead */}
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              aria-label={`Surface Tension: ${surfaceTension ? 'Enabled' : 'Disabled'}`}
              aria-pressed={surfaceTension}
              className="taskbar-bead-secondary focus:outline-none group relative"
              onClick={toggleSurfaceTension}
              title={`Surface Tension: ${surfaceTension ? 'Enabled (droplets pull together)' : 'Disabled (click to enable)'}`}
            >
              <div className="flex items-center gap-0.5 pointer-events-none">
                <div
                  className={`rounded-full transition-all duration-200 ${
                    surfaceTension
                      ? 'w-2 h-2 bg-black/60 shadow-sm'
                      : 'w-1.5 h-1.5 bg-black/25 group-hover:bg-black/45'
                  }`}
                />
                <div
                  className={`h-0.5 rounded-full transition-all duration-200 ${
                    surfaceTension ? 'w-1 bg-black/45 opacity-100' : 'w-0 bg-transparent opacity-0'
                  }`}
                />
                <div
                  className={`rounded-full transition-all duration-200 ${
                    surfaceTension
                      ? 'w-2 h-2 bg-black/60 shadow-sm'
                      : 'w-1.5 h-1.5 bg-black/25 group-hover:bg-black/45'
                  }`}
                />
              </div>
            </button>
            <div className="h-1 flex items-center justify-center">
              <div
                className={`rounded-full transition-all duration-200 ${
                  surfaceTension ? 'w-1.5 h-1 bg-black/45' : 'w-1 h-0.5 bg-black/15'
                }`}
              />
            </div>
          </div>

          {/* ④ Merge All Bead */}
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              aria-label="Merge All Droplets"
              className="taskbar-bead-secondary focus:outline-none group"
              onClick={handleMergeAll}
              title={activeCount > 1 ? 'Draw and merge droplets together' : 'Zen ripple'}
            >
              <div className="w-2 h-2 rounded-full bg-black/25 group-hover:bg-black/50 transition-colors" />
            </button>
            <div className="w-1.5 h-1" />
          </div>

          {/* ⑤ Liquid Hue Color-Picker Bead */}
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              aria-label="Shift Liquid Hue"
              className="taskbar-bead-secondary focus:outline-none group relative"
              onClick={() => {
                initAudioOnGesture();
                playRippleSound();
                setLiquidHue((prev) => (prev === 'clear' ? 'ocean' : prev === 'ocean' ? 'sunset' : 'clear'));
              }}
              title={`Liquid Hue: ${liquidHue.toUpperCase()} (Click to cycle Clear, Ocean Blue, Sunset Orange)`}
            >
              <div
                className={`w-3 h-3 rounded-full transition-all duration-300 shadow-inner ${
                  liquidHue === 'clear'
                    ? 'bg-black/20 group-hover:bg-black/40'
                    : liquidHue === 'ocean'
                    ? 'bg-sky-500 shadow-sky-600/40 scale-110'
                    : 'bg-amber-500 shadow-amber-600/40 scale-110'
                }`}
              />
            </button>
            <div className="h-1 flex items-center justify-center">
              <span className="text-[7px] uppercase font-mono tracking-tighter text-black/40">
                {liquidHue === 'clear' ? 'Clr' : liquidHue === 'ocean' ? 'Ocn' : 'Snt'}
              </span>
            </div>
          </div>

          {/* ⑥ Evaporation Rate / Volume Slider */}
          <div className="flex flex-col items-center gap-1 px-1">
            <div className="flex items-center gap-1.5" title={`Volume / Evaporation: ${Math.round(evaporationRate * 100)}%`}>
              <span className="text-[10px] text-black/40 select-none">💨</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={evaporationRate}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setEvaporationRate(val);
                  evaporationRateRef.current = val;
                  setRainVolume(val);
                }}
                className="water-slider"
                title={`Volume / Evaporation: ${Math.round(evaporationRate * 100)}%`}
              />
            </div>
            <div className="h-1 flex items-center justify-center">
              <span className="text-[7px] uppercase font-mono tracking-tighter text-black/40">
                {evaporationRate === 0 ? 'Off' : `${Math.round(evaporationRate * 100)}%`}
              </span>
            </div>
          </div>

          {/* ⑦ POMODORO Toggle Button (opens water-drop modal) */}
          <button
            type="button"
            aria-label="Toggle Pomodoro Modal"
            onClick={() => {
              initAudioOnGesture();
              playRippleSound();
              setShowPomodoroModal((prev) => !prev);
            }}
            className={`pomodoro-pill-btn focus:outline-none ${showPomodoroModal ? 'active' : ''}`}
            title="Open Pomodoro Timer & Sound Studio"
          >
            <span
              className={`w-2 h-2 rounded-full transition-colors duration-300 flex-shrink-0 ${
                pomodoroRunning ? 'bg-emerald-500 animate-pulse' : 'bg-black/35'
              }`}
            />
            <span>POMODORO</span>
            {pomodoroRunning && (
              <span className="font-mono text-[9px] text-black/50 ml-0.5 tabular-nums">
                {Math.floor(pomodoroTimeLeft / 60)}:{(pomodoroTimeLeft % 60).toString().padStart(2, '0')}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ══════ Floating Water-Droplet Pomodoro & Audio Modal ══════ */}
      {showPomodoroModal && (
        <div
          className="water-modal fixed z-50 p-6 flex flex-col gap-4 text-black/80 w-[340px]"
          style={
            widgetPos
              ? {
                  left: `${Math.max(16, Math.min(window.innerWidth - 360, widgetPos.x))}px`,
                  top: `${Math.max(16, widgetPos.y - 370 < 16 ? widgetPos.y + 74 : widgetPos.y - 365)}px`,
                }
              : {
                  bottom: '100px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                }
          }
        >
          {/* Header — Mode Status & Close */}
          <div className="flex items-center justify-between border-b border-black/10 pb-3">
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2 h-2 rounded-full ${
                    pomodoroRunning ? 'bg-emerald-500 animate-pulse' : 'bg-black/35'
                  }`}
                />
                <span className="text-xs uppercase tracking-widest font-mono font-bold text-black/80">
                  {pomodoroMode === 'work' ? 'Focus Session' : 'Rest Break'}
                </span>
              </div>
              <span className="text-[10px] text-black/45 font-mono mt-0.5">
                {currentDate} · {currentTime}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                initAudioOnGesture();
                playRippleSound();
                setShowPomodoroModal(false);
              }}
              className="w-6 h-6 rounded-full flex items-center justify-center text-black/40 hover:text-black/80 hover:bg-black/5 transition-all text-sm font-semibold"
              title="Close modal"
            >
              ✕
            </button>
          </div>

          {/* Big Countdown Timer Display */}
          <div className="flex flex-col items-center justify-center py-3 bg-black/[0.02] rounded-2xl border border-black/5 shadow-inner">
            <span className="text-4xl font-extralight tracking-widest tabular-nums text-black/85 font-mono">
              {Math.floor(pomodoroTimeLeft / 60)
                .toString()
                .padStart(2, '0')}
              :
              {(pomodoroTimeLeft % 60).toString().padStart(2, '0')}
            </span>
            <span className="text-[10px] uppercase font-mono tracking-widest text-black/40 mt-1">
              {pomodoroRunning ? 'Session Active' : 'Paused'}
            </span>
          </div>

          {/* Pomodoro Action Buttons */}
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={togglePomodoro}
              className={`flex-1 py-2 rounded-full font-mono text-xs uppercase font-bold tracking-wider transition-all shadow-sm ${
                pomodoroRunning
                  ? 'bg-amber-500/90 hover:bg-amber-500 text-white shadow-amber-500/20'
                  : 'bg-black/85 hover:bg-black text-white'
              }`}
            >
              {pomodoroRunning ? 'Pause' : 'Start'}
            </button>
            <button
              type="button"
              onClick={resetPomodoro}
              className="px-4 py-2 rounded-full font-mono text-xs uppercase font-medium text-black/60 hover:text-black bg-black/5 hover:bg-black/10 transition-all"
            >
              Reset
            </button>
          </div>

          {/* ── Sound Controls & Rain Studio ── */}
          <div className="flex flex-col gap-3 pt-2 border-t border-black/10">
            <div className="text-[11px] font-bold uppercase tracking-wider text-black/50 font-mono">
              Sound & Ambience
            </div>

            {/* Rain Sound Toggle */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={toggleRainAudio}
                className={`w-full py-2 px-3 rounded-2xl border text-xs font-mono transition-all flex items-center justify-center gap-2 ${
                  pomodoroRainAudio
                    ? 'border-sky-300 text-sky-800 bg-sky-50/80 shadow-sm'
                    : 'border-black/10 text-black/40 bg-transparent'
                }`}
                title="Toggle soothing ambient pink-noise rain sound"
              >
                <span>🌧️</span>
                <span>Rain Audio: {pomodoroRainAudio ? 'ON' : 'OFF'}</span>
              </button>
            </div>

            {/* Rain Audio Volume Slider */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-xs font-mono text-black/55 flex items-center gap-1">
                <span>🌧️</span> Volume
              </span>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={evaporationRate}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setEvaporationRate(val);
                    evaporationRateRef.current = val;
                    setRainVolume(val);
                  }}
                  className="water-slider"
                  title={`Rain Volume: ${Math.round(evaporationRate * 100)}%`}
                />
                <span className="text-[10px] font-mono w-8 text-right text-black/50">
                  {Math.round(evaporationRate * 100)}%
                </span>
              </div>
            </div>

            {/* Work & Break Durations */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-black/5 text-xs text-black/65">
              <div className="flex items-center justify-between bg-black/[0.03] p-2 rounded-xl">
                <span>Work:</span>
                <input
                  type="number"
                  min="1"
                  max="90"
                  value={pomodoroDuration}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(90, Number(e.target.value) || 25));
                    setPomodoroDuration(val);
                    if (!pomodoroRunning && pomodoroMode === 'work') {
                      setPomodoroTimeLeft(val * 60);
                    }
                  }}
                  className="w-12 bg-white border border-black/15 rounded px-1.5 py-0.5 text-center font-mono text-xs"
                />
              </div>

              <div className="flex items-center justify-between bg-black/[0.03] p-2 rounded-xl">
                <span>Break:</span>
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={pomodoroBreakDuration}
                  onChange={(e) => {
                    const val = Math.max(1, Math.min(30, Number(e.target.value) || 5));
                    setPomodoroBreakDuration(val);
                    if (!pomodoroRunning && pomodoroMode === 'break') {
                      setPomodoroTimeLeft(val * 60);
                    }
                  }}
                  className="w-12 bg-white border border-black/15 rounded px-1.5 py-0.5 text-center font-mono text-xs"
                />
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Vapor Trail SVG Layer (series of shrinking, fading semi-transparent circles behind fast droplets) */}
      <svg className="pointer-events-none absolute inset-0 w-full h-full z-5 overflow-hidden">
        <defs>
          <radialGradient id="vaporDropGrad" cx="35%" cy="35%" r="65%">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0.95)" />
            <stop offset="45%" stopColor="rgba(215, 235, 250, 0.75)" />
            <stop offset="80%" stopColor="rgba(180, 212, 238, 0.4)" />
            <stop offset="100%" stopColor="rgba(160, 195, 225, 0)" />
          </radialGradient>
          <filter id="vaporSoftBlur" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="1.5" />
          </filter>
        </defs>
        <g>
          {Array.from({ length: 75 }).map((_, i) => (
            <circle
              key={i}
              ref={(el) => {
                vaporCircleRefs.current[i] = el;
              }}
              fill="url(#vaporDropGrad)"
              stroke="rgba(255, 255, 255, 0.7)"
              strokeWidth="0.8"
              filter="url(#vaporSoftBlur)"
              style={{ display: 'none' }}
            />
          ))}
        </g>
      </svg>

      {/* Splash Particles SVG Layer (radial burst of tiny, white, semi-transparent particles around impact base) */}
      <svg className="pointer-events-none absolute inset-0 w-full h-full z-8 overflow-hidden">
        <defs>
          <radialGradient id="splashDropGrad" cx="30%" cy="30%" r="70%">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0.98)" />
            <stop offset="45%" stopColor="rgba(235, 245, 255, 0.88)" />
            <stop offset="80%" stopColor="rgba(200, 225, 245, 0.65)" />
            <stop offset="100%" stopColor="rgba(175, 205, 230, 0.35)" />
          </radialGradient>
          <filter id="splashDropShadow" x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0.5" dy="1" stdDeviation="0.8" floodColor="rgba(0, 0, 0, 0.16)" />
          </filter>
        </defs>
        <g>
          {Array.from({ length: 90 }).map((_, i) => (
            <circle
              key={i}
              ref={(el) => {
                splashCircleRefs.current[i] = el;
              }}
              fill="url(#splashDropGrad)"
              stroke="rgba(255, 255, 255, 0.9)"
              strokeWidth="0.5"
              filter="url(#splashDropShadow)"
              style={{ display: 'none' }}
            />
          ))}
        </g>
      </svg>

      {/* SVG Liquid Neck / Meniscus (connects taskbar to extruding droplets) */}
      <svg
        ref={bridgeSvgRef}
        className="pointer-events-none absolute inset-0 w-full h-full z-10 transition-opacity duration-150"
        style={{ opacity: 0 }}
      >
        <defs>
          <linearGradient id="waterBridgeGrad" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0.9)" />
            <stop offset="50%" stopColor="rgba(235, 240, 245, 0.45)" />
            <stop offset="100%" stopColor="rgba(200, 210, 220, 0.6)" />
          </linearGradient>
          <filter id="bridgeShadow" x="-20%" y="-20%" width="140%" height="140%">
            <feDropShadow dx="2" dy="4" stdDeviation="4" floodColor="rgba(0, 0, 0, 0.18)" />
          </filter>
        </defs>
        <path
          d=""
          fill="url(#waterBridgeGrad)"
          filter="url(#bridgeShadow)"
          stroke="rgba(255, 255, 255, 0.75)"
          strokeWidth="1.5"
        />
      </svg>

      {/* Multiple Independent 1:1 Water Droplet App Windows */}
      {dropletList.map((item) => (
        <div
          key={item.id}
          ref={(el) => {
            if (el) {
              cardElementsRef.current.set(item.id, el);
            } else {
              cardElementsRef.current.delete(item.id);
            }
          }}
          className="card"
          onPointerDown={(e) => handlePointerDown(e, item.id)}
          onPointerMove={(e) => handlePointerMove(e, item.id)}
          onPointerUp={(e) => handlePointerUp(e, item.id)}
          onPointerCancel={(e) => handlePointerUp(e, item.id)}
          onClick={(e) => handleWindowClick(e, item.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            handleEvaporate(item.id);
          }}
        >
          {/* Minimize bead (merges app back into taskbar, or double-click to evaporate) */}
          <button
            type="button"
            aria-label="Minimize into taskbar"
            className="minimize-bead"
            onClick={(e) => {
              e.stopPropagation();
              dockDroplet(item.id);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              handleEvaporate(item.id);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Click to dock back to taskbar, or right-click to evaporate"
          />

          {/* Minimalist 1:1 App Content */}
          <div className="relative z-10 pointer-events-none flex flex-col items-center justify-center gap-1 select-none w-full h-full p-4">
            {/* Water droplet status bead */}
            <div className="w-5 h-5 rounded-full border border-black/15 flex items-center justify-center opacity-45 mb-1">
              <div className="w-1.5 h-1.5 rounded-full bg-black/40" />
            </div>

            {/* Minimalist 1:1 Clock */}
            <span className="text-xl font-light tracking-widest text-black/55 tabular-nums">
              {currentTime || '12:00'}
            </span>

            {/* Title / Merge indicator */}
            <span className="text-[10px] uppercase tracking-[0.25em] text-black/35 font-medium">
              Droplet #{item.index}
              {item.merges > 1 ? ` · ×${item.merges}` : ''}
            </span>
          </div>
        </div>
      ))}
    </main>
  );
}
