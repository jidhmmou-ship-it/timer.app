/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  dropCrispBase64,
  dropSingleBase64,
  dropHighBase64,
  dropLowBase64,
  dropletBase64,
  splashBase64,
} from './soundAssets';

// Web Audio API engine for real recorded water acoustic playback
let audioCtx: AudioContext | null = null;
const audioBuffers: Record<string, AudioBuffer> = {};
const decodingPromises: Record<string, Promise<AudioBuffer>> = {};
let lastImpactTime = 0;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

// Convert base64 Data URI to ArrayBuffer for Web Audio decoding
function dataUriToArrayBuffer(dataUri: string): ArrayBuffer {
  const base64Data = dataUri.split(',')[1];
  const binaryString = window.atob(base64Data);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Load and decode a real recorded audio sound buffer
async function loadSound(key: string, dataUri: string): Promise<AudioBuffer | null> {
  const ctx = getAudioContext();
  if (!ctx) return null;
  if (audioBuffers[key]) return audioBuffers[key];

  if (!decodingPromises[key]) {
    decodingPromises[key] = (async () => {
      try {
        const arrayBuf = dataUriToArrayBuffer(dataUri);
        // decodeAudioData consumes the buffer, so slice to be safe
        const decoded = await ctx.decodeAudioData(arrayBuf.slice(0));
        audioBuffers[key] = decoded;
        return decoded;
      } catch (err) {
        console.warn('Failed to decode water audio:', key, err);
        throw err;
      }
    })();
  }

  return decodingPromises[key].catch(() => null);
}

// Preload all real water recordings on first user gesture
export function initAudioOnGesture() {
  const ctx = getAudioContext();
  if (!ctx) return;

  loadSound('crisp', dropCrispBase64);
  loadSound('single', dropSingleBase64);
  loadSound('high', dropHighBase64);
  loadSound('low', dropLowBase64);
  loadSound('droplet', dropletBase64);
  loadSound('splash', splashBase64);
}

// Play a real recorded water sound with volume and pitch control
async function playRealSound(options: {
  key: string;
  dataUri: string;
  volume?: number;
  pitch?: number;
  detuneRandom?: number;
}) {
  const ctx = getAudioContext();
  if (!ctx) return;

  const {
    key,
    dataUri,
    volume = 0.5,
    pitch = 1.0,
    detuneRandom = 0.04,
  } = options;

  let buffer = audioBuffers[key] as AudioBuffer | undefined;
  if (!buffer) {
    const loaded = await loadSound(key, dataUri);
    if (loaded) buffer = loaded;
  }
  if (!buffer) return;

  const now = ctx.currentTime;
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  // Organic pitch variation so repeated drops never sound robotic
  const pitchVar = 1.0 + (Math.random() - 0.5) * detuneRandom * 2;
  source.playbackRate.setValueAtTime(pitch * pitchVar, now);

  const gainNode = ctx.createGain();
  gainNode.gain.setValueAtTime(volume, now);

  source.connect(gainNode);
  gainNode.connect(ctx.destination);

  source.start(now);
}

/**
 * Launch / Budding Sound:
 * Deep real water release as droplet extrudes and emerges from taskbar
 */
export function playLaunchSound() {
  initAudioOnGesture();
  // Deep organic water surge
  playRealSound({
    key: 'low',
    dataUri: dropLowBase64,
    volume: 0.35,
    pitch: 0.95,
  });
}

/**
 * Neck Snap / Pinch-Off Sound:
 * Crisp real recorded water droplet snap when the surface tension bridge separates
 */
export function playNeckSnapSound() {
  initAudioOnGesture();
  playRealSound({
    key: 'high',
    dataUri: dropHighBase64,
    volume: 0.45,
    pitch: 1.08,
    detuneRandom: 0.05,
  });
}

/**
 * Droplet Impact Sound (floor, wall, ceiling):
 * Real recorded water drops and splashes scaled dynamically to impact velocity
 */
export function playImpactSound(speed: number, surface: 'bottom' | 'wall') {
  const now = performance.now();
  if (now - lastImpactTime < 75) return;
  lastImpactTime = now;

  initAudioOnGesture();

  const normSpeed = Math.min(1, Math.max(0, (speed - 40) / 950));
  const volume = 0.2 + normSpeed * 0.45;

  if (surface === 'bottom') {
    // Floor landing
    if (speed > 750) {
      // High-speed throw: real recorded splash sound!
      playRealSound({
        key: 'splash',
        dataUri: splashBase64,
        volume: volume * 0.55,
        pitch: 1.05 + (Math.random() - 0.5) * 0.1,
      });
    } else {
      // Normal floor impact: deep resonant real water droplet
      playRealSound({
        key: 'single',
        dataUri: dropSingleBase64,
        volume: volume * 0.65,
        pitch: 0.9 + normSpeed * 0.2,
      });
    }
  } else {
    // Wall / ceiling rebound: crisp real water droplet slap
    playRealSound({
      key: 'crisp',
      dataUri: dropCrispBase64,
      volume: volume * 0.6,
      pitch: 0.95 + normSpeed * 0.18,
    });
  }
}

/**
 * Dock / Merge Sound:
 * Real recorded water drop submerging back into the liquid dock
 */
export function playMergeSound() {
  initAudioOnGesture();
  // Deep authentic water drop absorption
  playRealSound({
    key: 'low',
    dataUri: dropLowBase64,
    volume: 0.42,
    pitch: 0.88,
  });
}

/**
 * Window Tap / Ripple Sound:
 * Authentic sparkling droplet plink inside the 1:1 window
 */
export function playRippleSound() {
  initAudioOnGesture();
  playRealSound({
    key: 'droplet',
    dataUri: dropletBase64,
    volume: 0.4,
    pitch: 1.0 + (Math.random() - 0.5) * 0.08,
  });
}

/**
 * Ambient Rain Generator for Pomodoro Timer (Synthesized realistic multi-layered rain audio)
 */
let rainNode: AudioNode | null = null;
let rainGain: GainNode | null = null;

export function playTickSound(isHigh = false) {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    const freq = isHigh ? 1350 : 920;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.45, ctx.currentTime + 0.026);

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, ctx.currentTime);
    filter.Q.setValueAtTime(4.0, ctx.currentTime);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.032);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.035);
  } catch {}
}

export function startRainSound(volume = 0.28) {
  initAudioOnGesture();
  const ctx = getAudioContext();
  if (!ctx) return;
  if (rainNode) return; // already playing

  const bufferSize = ctx.sampleRate * 2; // 2s noise loop
  const noiseBuffer = ctx.createBuffer(2, bufferSize, ctx.sampleRate);
  const left = noiseBuffer.getChannelData(0);
  const right = noiseBuffer.getChannelData(1);

  let lastOutL = 0;
  let lastOutR = 0;
  for (let i = 0; i < bufferSize; i++) {
    const whiteL = Math.random() * 2 - 1;
    const whiteR = Math.random() * 2 - 1;
    // Pink noise integration for soft water rain patter
    lastOutL = (lastOutL + 0.025 * whiteL) / 1.025;
    lastOutR = (lastOutR + 0.025 * whiteR) / 1.025;
    left[i] = lastOutL * 2.8;
    right[i] = lastOutR * 2.8;
  }

  const whiteNoiseSource = ctx.createBufferSource();
  whiteNoiseSource.buffer = noiseBuffer;
  whiteNoiseSource.loop = true;

  // Bandpass filter to model soft rain on leaves / glass
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1100, ctx.currentTime);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.01, volume), ctx.currentTime + 1.2);

  whiteNoiseSource.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  whiteNoiseSource.start();
  rainNode = whiteNoiseSource;
  rainGain = gain;
}

export function setRainVolume(volume: number) {
  const ctx = getAudioContext();
  if (rainGain && ctx) {
    // Smooth transition to target volume (capped between 0 and 1, scaled to comfortable acoustic level)
    const target = Math.max(0.0001, Math.min(1, volume * 0.45));
    rainGain.gain.cancelScheduledValues(ctx.currentTime);
    rainGain.gain.setValueAtTime(rainGain.gain.value, ctx.currentTime);
    rainGain.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.08);
  }
}

export function stopRainSound() {

  if (rainGain && audioCtx) {
    try {
      rainGain.gain.setValueAtTime(rainGain.gain.value, audioCtx.currentTime);
      rainGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.8);
      setTimeout(() => {
        if (rainNode) {
          try {
            (rainNode as AudioBufferSourceNode).stop();
            rainNode.disconnect();
          } catch {}
          rainNode = null;
          rainGain = null;
        }
      }, 850);
    } catch {
      rainNode = null;
      rainGain = null;
    }
  } else if (rainNode) {
    try {
      (rainNode as AudioBufferSourceNode).stop();
      rainNode.disconnect();
    } catch {}
    rainNode = null;
    rainGain = null;
  }
}

