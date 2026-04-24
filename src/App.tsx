import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Rocket, Trophy, Zap, Play, X, AlertTriangle } from 'lucide-react';
import confetti from 'canvas-confetti';

// --- Suppress MediaPipe Info Logs ---
const suppressLog = (originalFn: any) => (...args: any[]) => {
  const msg = args.join(' ');
  if (msg.includes('XNNPACK delegate for CPU') || msg.includes('Created TensorFlow Lite')) return;
  originalFn(...args);
};

console.info = suppressLog(console.info);
console.log = suppressLog(console.log);
console.warn = suppressLog(console.warn);
console.error = suppressLog(console.error);

// --- Sound Manager ---
class SoundManager {
  ctx: AudioContext | null = null;

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  playScoreSound(sizeMultiplier: number = 1) {
    if (!this.ctx) return;
    
    // Deep Sub-Bass Impact
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.type = 'sine'; // Deep sub bass
    osc.frequency.setValueAtTime(100 / sizeMultiplier, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(10, this.ctx.currentTime + 0.4);
    
    gain.gain.setValueAtTime(0.8, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.4);
    
    osc.start();
    osc.stop(this.ctx.currentTime + 0.4);

    // Crunch / Sizzle (Rác cháy trong lò)
    const bufferSize = this.ctx.sampleRate * 0.3; // 0.3 seconds
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * (1 - i/bufferSize); // Fade out noise physically
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    
    const noiseFilter = this.ctx.createBiquadFilter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1000 / sizeMultiplier; // Deeper crunch for larger trash
    noiseFilter.Q.value = 1;
    
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.setValueAtTime(0.6, this.ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
    
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(this.ctx.destination);
    noise.start();
  }

  playBombSound() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  playWinSound() {
    if (!this.ctx) return;
    const notes = [440, 554, 659, 880, 1108, 1318];
    notes.forEach((freq, i) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.1);
      gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + i * 0.1 + 0.05);
      gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + i * 0.1 + 0.2);
      osc.start(this.ctx.currentTime + i * 0.1);
      osc.stop(this.ctx.currentTime + i * 0.1 + 0.2);
    });
  }
}
const soundManager = new SoundManager();

// --- Game Constants ---
const TRASH_EMOJIS = ['🔩', '💥', '☄️'];
const SATELLITE_EMOJIS = ['🛰️', '📡'];
const BOMB_EMOJIS = ['💣'];
const FALL_SPEED = 4.5;
const SPAWN_RATE = 800; // ms
const PINCH_THRESHOLD = 60; // px
const GRAB_RADIUS = 60; // px

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

interface GameObject {
  id: number;
  type: 'trash' | 'satellite' | 'bomb';
  size: 'small' | 'medium' | 'large';
  emoji: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isGrabbed: boolean;
  grabbedByPlayerIndex: number | null;
  vacuumedByPlayerIndex: number | null;
  isRegretting: boolean;
}


function GameCanvas({
  onScoreChange,
  onComboChange,
  reactorRef,
  gameState,
  numPlayers,
  onStartGame,
}: {
  onScoreChange: (playerIndex: number, delta: number) => void;
  onComboChange: (playerIndex: number, combo: number, isFever: boolean) => void;
  reactorRef: React.RefObject<HTMLDivElement | null>;
  gameState: 'menu' | 'countdown' | 'playing' | 'gameover';
  numPlayers: number;
  onStartGame: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const objectsRef = useRef<GameObject[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const lastSpawnTimeRef = useRef<number>(0);
  const requestRef = useRef<number>(0);
  const nextIdRef = useRef<number>(0);
  const lastLandmarksRef = useRef<any[]>([]);

  const combosRef = useRef<[number, number]>([0, 0]);
  const comboVisualsRef = useRef<{ x: number, y: number, time: number, playerIndex: number, isBig: boolean, level: number }[]>([]);
  const feverEndTimesRef = useRef<[number, number]>([0, 0]);
  const feverModesRef = useRef<[boolean, boolean]>([false, false]);
  const MAX_COMBO = 15;
  const FEVER_DURATION = 10000;

  // Initialize MediaPipe
  useEffect(() => {
    let active = true;
    let localLandmarker: HandLandmarker | null = null;
    const initMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
        );
        if (!active) return;
        const landmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath:
              'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          numHands: 2,
        });
        if (!active) {
          landmarker.close();
          return;
        }
        localLandmarker = landmarker;
        setHandLandmarker(landmarker);
      } catch (e) {
        console.error("Failed to initialize MediaPipe:", e);
      }
    };
    initMediaPipe();
    return () => {
      active = false;
      if (localLandmarker) {
        localLandmarker.close();
      }
    };
  }, []);

  useEffect(() => {
    if (gameState === 'playing') {
      lastSpawnTimeRef.current = performance.now() + 2000 - SPAWN_RATE;
    }
  }, [gameState]);

  // Start Webcam
  const startCamera = useCallback(() => {
    if (!videoRef.current) return;
    setIsCameraStarting(true);
    setCameraError(null);
    let currentStream: MediaStream | null = null;
    
    const startWithConstraints = (constraints: MediaStreamConstraints) => {
      return navigator.mediaDevices.getUserMedia(constraints);
    };
    
    startWithConstraints({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } })
      .catch(() => startWithConstraints({ video: true }))
      .then((stream) => {
        currentStream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch((e) => {
            if (e.name !== 'AbortError') {
              console.error('Error playing video:', e);
            }
          });
        }
        setIsCameraStarting(false);
      })
      .catch((err) => {
        console.error('Error accessing webcam:', err);
        setCameraError(err.message || 'Permission denied');
        setIsCameraStarting(false);
      });
  }, []);

  useEffect(() => {
    startCamera();
    
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  // Game Loop
  useEffect(() => {
    if (!videoRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastVideoTime = -1;
    let lastDetectionTime = 0;

    const loop = (time: number) => {
      // Resize canvas to match window
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Spawn objects
      if (gameState === 'playing' && time - lastSpawnTimeRef.current > SPAWN_RATE) {
        const rand = Math.random();
        let type: 'trash' | 'satellite' | 'bomb' = 'trash';
        let emojiList = TRASH_EMOJIS;
        
        if (rand > 0.85) {
          type = 'bomb';
          emojiList = BOMB_EMOJIS;
        } else if (rand > 0.7) {
          type = 'satellite';
          emojiList = SATELLITE_EMOJIS;
        }

        const emoji = emojiList[Math.floor(Math.random() * emojiList.length)];
        
        let objSize: 'small' | 'medium' | 'large' = 'medium';

        objectsRef.current.push({
          id: nextIdRef.current++,
          type,
          size: objSize,
          emoji,
          x: Math.random() * (canvas.width - 100) + 50,
          y: -50,
          vx: 0,
          vy: FALL_SPEED + Math.random() * 2,
          isGrabbed: false,
          grabbedByPlayerIndex: null,
          vacuumedByPlayerIndex: null,
          isRegretting: false,
        });
        lastSpawnTimeRef.current = time;
      }

      if (gameState !== 'playing') {
        objectsRef.current = [];
        if (combosRef.current[0] > 0 || combosRef.current[1] > 0 || feverModesRef.current[0] || feverModesRef.current[1]) {
          combosRef.current = [0, 0];
          feverModesRef.current = [false, false];
          feverEndTimesRef.current = [0, 0];
          onComboChange(0, 0, false);
          onComboChange(1, 0, false);
        }
      }

      // Process Hand Landmarks
      let currentHands: { x: number; y: number; isPinching: boolean; playerIndex: number }[] = [];
      if (handLandmarker && videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
        try {
          if (videoRef.current.currentTime !== lastVideoTime && time - lastDetectionTime > 50) {
            lastVideoTime = videoRef.current.currentTime;
            lastDetectionTime = time;
            const results = handLandmarker.detectForVideo(videoRef.current, performance.now());
            
            if (results.landmarks) {
              lastLandmarksRef.current = results.landmarks;
              if (gameState === 'menu' && results.landmarks.length >= 2) {
                onStartGame();
              }
            } else {
              lastLandmarksRef.current = [];
            }
          }
        } catch (e) {
          console.error("MediaPipe detection error:", e);
        }

        lastLandmarksRef.current.forEach((landmarks, index) => {
          // Map landmarks to screen accurately, matching the draw object above
          const vRatio = videoRef.current!.videoWidth / videoRef.current!.videoHeight;
          const cRatio = canvas.width / canvas.height;
          let viewWidth = canvas.width;
          let viewHeight = canvas.height;
          let viewOffsetX = 0;
          let viewOffsetY = 0;

          if (cRatio > vRatio) {
            viewHeight = canvas.width / vRatio;
            viewOffsetY = (canvas.height - viewHeight) / 2;
          } else {
            viewWidth = canvas.height * vRatio;
            viewOffsetX = (canvas.width - viewWidth) / 2;
          }

          const mappedLandmarks = landmarks.map((l: any) => ({
            x: (canvas.width + viewWidth) / 2 - l.x * viewWidth, // Mirrored perfectly centered
            y: l.y * viewHeight + viewOffsetY,
          }));

          if (mappedLandmarks.length < 1) return;

          // Determine player index based on x position (static mapping)
          const centerX = mappedLandmarks.reduce((acc: number, l: any) => acc + l.x, 0) / mappedLandmarks.length;
          // In 2 player mode, left half is P1, right half is P2.
          // In 1 player mode, any hand is P1.
          const playerIdx = numPlayers === 1 ? 0 : (centerX < canvas.width / 2 ? 0 : 1);

          // Draw hand with fixed colors: P1 = Blue, P2 = Red
          const colors = ['rgba(59, 130, 246, 0.5)', 'rgba(239, 68, 68, 0.5)']; 
          const strokeColors = ['rgba(59, 130, 246, 0.8)', 'rgba(239, 68, 68, 0.8)'];
          
          ctx.fillStyle = colors[playerIdx];
          ctx.strokeStyle = strokeColors[playerIdx];
          ctx.lineWidth = 2;

          // Draw connections (simplified)
          ctx.beginPath();
          mappedLandmarks.forEach((l: any, i: number) => {
            if (i === 0) ctx.moveTo(l.x, l.y);
            else ctx.lineTo(l.x, l.y);
            ctx.fillRect(l.x - 2, l.y - 2, 4, 4);
          });
          ctx.stroke();

          if (mappedLandmarks.length > 9) {
            const thumb = mappedLandmarks[4];
            const indexFinger = mappedLandmarks[8];
            const isPinching = Math.hypot(thumb.x - indexFinger.x, thumb.y - indexFinger.y) < PINCH_THRESHOLD;

            const handCenter = mappedLandmarks[9]; // Middle Finger MCP
            const playerIndex = playerIdx; // Use the already determined playerIdx
            const isFever = feverModesRef.current[playerIndex];

            // Draw hand aura (vacuum radius)
            ctx.beginPath();
            const radius = isFever ? 500 : 100;
            ctx.arc(handCenter.x, handCenter.y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = isFever ? colors[playerIndex].replace('0.5', '0.2') : colors[playerIndex].replace('0.5', '0.1');
            ctx.fill();
            if (isFever) {
              ctx.strokeStyle = strokeColors[playerIndex];
              ctx.lineWidth = 1;
              ctx.stroke();
            }

            // Draw pinch indicator
            if (isPinching) {
              ctx.beginPath();
              ctx.arc(handCenter.x, handCenter.y, 15, 0, 2 * Math.PI);
              ctx.fillStyle = colors[playerIndex];
              ctx.fill();
            }

            currentHands.push({
              x: handCenter.x,
              y: handCenter.y,
              isPinching: isPinching,
              playerIndex,
            });
          }
        });
      }

      // Get Reactor Bounds
      let reactorBounds = { left: 0, right: 0, top: 0, bottom: 0 };
      let reactorCenterX = 0;
      let reactorCenterY = 0;
      if (reactorRef.current) {
        reactorBounds = reactorRef.current.getBoundingClientRect();
        reactorCenterX = (reactorBounds.left + reactorBounds.right) / 2;
        reactorCenterY = (reactorBounds.top + reactorBounds.bottom) / 2;
      }

      // Fever mode check
      for (let p = 0; p < 2; p++) {
        const isFever = time < feverEndTimesRef.current[p];
        if (isFever !== feverModesRef.current[p]) {
          feverModesRef.current[p] = isFever;
          if (!isFever) {
            combosRef.current[p] = 0;
            onComboChange(p, 0, false);
          } else {
            onComboChange(p, MAX_COMBO, true);
          }
        }
      }

      const handleObjectScored = (obj: GameObject, playerIndex: number) => {
        if (obj.type === 'trash') {
          let sizeMultiplier = 1;
          if (obj.size === 'small') sizeMultiplier = 1;
          else if (obj.size === 'medium') sizeMultiplier = 2;
          else if (obj.size === 'large') sizeMultiplier = 3;

          soundManager.playScoreSound(sizeMultiplier);
          
          combosRef.current[playerIndex] = Math.min(combosRef.current[playerIndex] + 1, MAX_COMBO);
          const comboActive = combosRef.current[playerIndex] >= 3;
          let scoreDelta = 10 * sizeMultiplier * (comboActive ? 2 : 1);
          onScoreChange(playerIndex, scoreDelta);
          
          // Add glowing gold particles
          for (let p = 0; p < 15 * sizeMultiplier; p++) {
            particlesRef.current.push({
              x: obj.x + (Math.random() - 0.5) * 40,
              y: obj.y + (Math.random() - 0.5) * 40,
              vx: (Math.random() - 0.5) * 12,
              vy: (Math.random() - 0.5) * 12,
              life: 1,
              color: ['#FFD700', '#FFA500', '#FF8C00', '#FFFF66'][Math.floor(Math.random() * 4)]
            });
          }
          
          // Floating combo text
          if (comboActive) {
            comboVisualsRef.current.push({
              x: obj.x,
              y: obj.y,
              time: Date.now(),
              playerIndex,
              isBig: combosRef.current[playerIndex] === MAX_COMBO,
              level: combosRef.current[playerIndex]
            });
          }

          if (combosRef.current[playerIndex] >= MAX_COMBO && !feverModesRef.current[playerIndex]) {
            feverEndTimesRef.current[playerIndex] = time + FEVER_DURATION;
            feverModesRef.current[playerIndex] = true;
            onComboChange(playerIndex, MAX_COMBO, true);
          } else {
            onComboChange(playerIndex, combosRef.current[playerIndex], feverModesRef.current[playerIndex]);
          }
        } else if (obj.type === 'bomb') {
          soundManager.playBombSound();
          onScoreChange(playerIndex, -20);
          combosRef.current[playerIndex] = 0;
          onComboChange(playerIndex, 0, false);
        } else if (obj.type === 'satellite') {
          soundManager.playBombSound();
          onScoreChange(playerIndex, -10);
          combosRef.current[playerIndex] = 0;
          onComboChange(playerIndex, 0, false);
        }
      };

      // Update Objects
      const playersHolding = new Set<number>();
      
      // Process Objects
      for (let i = objectsRef.current.length - 1; i >= 0; i--) {
        const obj = objectsRef.current[i];

        // 1. Grab & Vacuum Logic
        if (obj.vacuumedByPlayerIndex === null) {
          if (obj.isGrabbed && obj.grabbedByPlayerIndex !== null) {
            // Update position to mapped hand if still pinching
            const hand = currentHands.find(h => h.playerIndex === obj.grabbedByPlayerIndex);
            if (hand && hand.isPinching) {
              obj.x = hand.x;
              obj.y = hand.y;
              
              // Drop into reactor if close enough
              const distToReactor = Math.hypot(obj.x - reactorCenterX, obj.y - reactorCenterY);
              if (distToReactor < 150) {
                obj.vacuumedByPlayerIndex = hand.playerIndex;
                obj.isGrabbed = false;
              }
            } else {
              // Released grab
              obj.isGrabbed = false;
              obj.grabbedByPlayerIndex = null;
            }
          } else {
            // Check for new grab or fever vacuum
            for (const hand of currentHands) {
              const isFever = feverModesRef.current[hand.playerIndex];
              const dist = Math.hypot(obj.x - hand.x, obj.y - hand.y);
              
              if (isFever) {
                const radius = 500;
                if (dist < radius) {
                  obj.vacuumedByPlayerIndex = hand.playerIndex;
                  break;
                }
              } else {
                const radius = 100;
                if (dist < radius && hand.isPinching) {
                  obj.isGrabbed = true;
                  obj.grabbedByPlayerIndex = hand.playerIndex;
                  break;
                }
              }
            }
          }
        }

        // 2. Process Vacuum Animation
        if (obj.vacuumedByPlayerIndex !== null) {
          const dx = reactorCenterX - obj.x;
          const dy = reactorCenterY - obj.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 50) {
            handleObjectScored(obj, obj.vacuumedByPlayerIndex);
            objectsRef.current.splice(i, 1);
          } else {
            // High speed satisfying vacuum, but slow enough to be visible
            obj.x += (dx / dist) * 20;
            obj.y += (dy / dist) * 20;
          }
          continue;
        }

        // 3. Normal Falling (not vacuumed)
        obj.x += obj.vx;
        obj.y += obj.vy;

        if (obj.isRegretting) {
          obj.vy += 0.05;
        } else {
          if (obj.y > reactorBounds.top && obj.y < reactorBounds.bottom) {
            if (obj.x < reactorBounds.left && obj.x > reactorBounds.left - 60) {
              obj.isRegretting = true;
              obj.vx = -2;
              obj.vy = -3;
            } else if (obj.x > reactorBounds.right && obj.x < reactorBounds.right + 60) {
              obj.isRegretting = true;
              obj.vx = 2;
              obj.vy = -3;
            }
          }
        }

        // Remove if off screen
        if (obj.y > canvas.height + 50 || obj.x < -50 || obj.x > canvas.width + 50) {
          if (obj.type === 'trash' && !obj.isGrabbed && obj.vacuumedByPlayerIndex === null) {
            // Reset combo if trash falls past the reactor
            if (obj.y > reactorBounds.bottom) {
              if (combosRef.current[0] > 0 || combosRef.current[1] > 0) {
                combosRef.current[0] = 0;
                combosRef.current[1] = 0;
                onComboChange(0, 0, false);
                onComboChange(1, 0, false);
              }
            }
          }
          objectsRef.current.splice(i, 1);
          continue;
        }

        // Draw Object
        let fontSize = 60;
        if (obj.size === 'small') fontSize = 40;
        else if (obj.size === 'large') fontSize = 90;
        ctx.globalAlpha = 1; // Ensure fully opaque
        ctx.fillStyle = '#ffffff'; // Force fillStyle to opaque white for emojis
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        ctx.font = `${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(obj.emoji, obj.x, obj.y);
        ctx.shadowBlur = 0; // Reset shadow
      }

      // Draw Particles (Glowing Gold)
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.vy += 0.05; // Light gravity
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.015;
        if (p.life <= 0) {
          particlesRef.current.splice(i, 1);
          continue;
        }
        ctx.beginPath();
        const radius = Math.max(0.1, p.life * 8);
        ctx.arc(p.x, p.y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = p.color;
        
        ctx.shadowBlur = 20;
        ctx.shadowColor = p.color;
        
        ctx.globalAlpha = p.life * 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      }

      // Draw Combo Visuals
      const now = Date.now();
      for (let i = comboVisualsRef.current.length - 1; i >= 0; i--) {
        const visual = comboVisualsRef.current[i];
        const elapsed = now - visual.time;
        const duration = visual.isBig ? 1500 : 800;
        
        if (elapsed > duration) {
          comboVisualsRef.current.splice(i, 1);
          continue;
        }

        const opacity = 1 - elapsed / duration;
        const scale = visual.isBig ? 1 + Math.sin(elapsed / 200) * 0.2 : 1;
        const yOffset = (elapsed / duration) * (visual.isBig ? 150 : 80);
        
        ctx.save();
        ctx.translate(visual.x, visual.y - 50 - yOffset);
        ctx.scale(scale, scale);
        ctx.globalAlpha = opacity;
        
        const color = visual.playerIndex === 0 ? '#00FFFF' : '#FF00FF';
        ctx.fillStyle = color;
        ctx.shadowBlur = visual.isBig ? 30 : 15;
        ctx.shadowColor = color;
        ctx.textAlign = 'center';
        
        if (visual.isBig) {
          ctx.font = '900 70px Orbitron, sans-serif';
          ctx.fillText(`FEVER ${visual.level}`, 0, 0);
          ctx.font = 'bold 25px Orbitron, sans-serif';
          ctx.fillText('FEVER MODE ACTIVATED', 0, 40);
        } else {
          ctx.font = '900 45px Orbitron, sans-serif';
          ctx.fillText(`COMBO ${visual.level}`, 0, 0);
        }
        
        ctx.restore();
      }

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [handLandmarker, onScoreChange, reactorRef, gameState, numPlayers]);

  return (
    <>
      <video
        ref={videoRef}
        style={{ display: 'none' }}
        playsInline
        muted
      />
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-40 pointer-events-none"
      />
      
      {cameraError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] bg-red-500/90 text-white px-6 py-3 rounded-xl border border-red-400 font-headline shadow-2xl flex flex-col items-center gap-3">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6" />
            <p>Camera Error: {cameraError}. Please allow camera access.</p>
          </div>
          <button 
            onClick={startCamera}
            disabled={isCameraStarting}
            className="bg-white text-red-500 px-4 py-2 rounded font-bold uppercase tracking-widest text-sm hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            {isCameraStarting ? 'RETRYING...' : 'RETRY CAMERA ACCESS'}
          </button>
        </div>
      )}
    </>
  );
}

export default function App() {
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [combos, setCombos] = useState<[number, number]>([0, 0]);
  const [feverModes, setFeverModes] = useState<[boolean, boolean]>([false, false]);
  const [gameState, setGameState] = useState<'menu' | 'countdown' | 'playing' | 'gameover'>('menu');
  const [countdownValue, setCountdownValue] = useState<number>(3);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const reactorRef = useRef<HTMLDivElement>(null);

  const scoresRef = useRef(scores);
  useEffect(() => { scoresRef.current = scores; }, [scores]);

  useEffect(() => {
    if (gameState === 'countdown') {
      if (countdownValue < 0) {
        setGameState('playing');
        return;
      }
      const timer = setTimeout(() => {
        setCountdownValue(prev => prev - 1);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [gameState, countdownValue]);

  useEffect(() => {
    if (gameState === 'playing') {
      const timer = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            setGameState('gameover');
            soundManager.playWinSound();
            confetti({
              particleCount: 150,
              spread: 100,
              origin: { y: 0.6 },
              colors: ['#00FFFF', '#FF00FF', '#FFFFFF']
            });
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    } else if (gameState === 'gameover') {
      // Confetti and sound already triggered when timeRemaining reaches 0
    }
  }, [gameState]);

  const startGame = useCallback(() => {
    soundManager.init();
    setScores([0, 0]);
    setCombos([0, 0]);
    setFeverModes([false, false]);
    setTimeRemaining(3 * 60);
    setCountdownValue(3);
    setGameState('countdown');
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleScoreChange = useCallback((playerIndex: number, delta: number) => {
    setScores((prev) => {
      const newScores = [...prev] as [number, number];
      newScores[playerIndex] += delta;
      return newScores;
    });
  }, []);

  const handleComboChange = useCallback((playerIndex: number, newCombo: number, fever: boolean) => {
    setCombos((prev) => {
      const newCombos = [...prev] as [number, number];
      newCombos[playerIndex] = newCombo;
      return newCombos;
    });
    setFeverModes((prev) => {
      const newFever = [...prev] as [boolean, boolean];
      newFever[playerIndex] = fever;
      return newFever;
    });
  }, []);

  return (
    <div className="bg-background text-on-surface font-body overflow-hidden select-none min-h-screen">
      <GameCanvas 
        onScoreChange={handleScoreChange} 
        onComboChange={handleComboChange} 
        reactorRef={reactorRef} 
        gameState={gameState} 
        numPlayers={1}
        onStartGame={startGame}
      />

      {/* Countdown Overlay */}
      {gameState === 'countdown' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center pointer-events-none">
          <div className="text-white font-headline font-black text-9xl tracking-[0.2em] glow-primary animate-pulse shadow-black">
            {countdownValue > 0 ? countdownValue : 'GO!'}
          </div>
        </div>
      )}

      {/* Fever Mode Overlay Message */}
      {(feverModes[0] || feverModes[1]) && (
        <div className="fixed inset-0 z-40 pointer-events-none flex flex-col items-center justify-center">
          <div className="bg-black/40 backdrop-blur-sm px-10 py-6 border-y-2 border-primary/50 w-full flex flex-col items-center animate-pulse">
            <h2 className="text-primary font-headline font-black text-4xl tracking-[0.2em] glow-primary mb-2">FEVER MODE ACTIVE</h2>
            <p className="text-white font-headline font-bold text-xl tracking-widest animate-bounce">WAVE YOUR HANDS EVERYWHERE!</p>
          </div>
        </div>
      )}

      {/* AR Background Layer */}
      <div className="fixed inset-0 z-0 bg-black overflow-hidden">
        {/* Background with Brighter Image */}
        <div className="absolute inset-0 z-5 nebula-glow pointer-events-none">
          <img
            alt="Deep space galaxy"
            className="w-full h-full object-cover scale-105"
            src="https://images.unsplash.com/photo-1451187580459-43490279c0fa?q=80&w=2000&auto=format&fit=crop"
            onError={(e) => {
              // Fallback to a very similar Unsplash image if Adobe Stock blocks hotlinking
              e.currentTarget.src = "https://images.unsplash.com/photo-1534447677768-be436bb09401?q=80&w=2000&auto=format&fit=crop";
            }}
            referrerPolicy="no-referrer"
          />
        </div>
        {/* Darkened Overlay */}
        <div className="absolute inset-0 z-6 bg-black/75 pointer-events-none"></div>
        {/* Atmospheric Overlays */}
        <div className="absolute top-0 right-0 w-[1000px] h-[1000px] bg-tertiary/15 blur-[250px] -translate-y-1/3 translate-x-1/3 rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-[800px] h-[800px] bg-secondary/15 blur-[200px] translate-y-1/3 -translate-x-1/4 rounded-full"></div>
      </div>

      <img
        alt="Dark Planet from space"
        className="absolute bottom-[-30%] left-[-20%] w-[1000px] h-[1000px] object-cover opacity-30 mix-blend-screen pointer-events-none z-5 drop-shadow-[0_0_50px_rgba(0,185,209,0.2)] brightness-50 contrast-125 saturate-50 scale-125"
        src="https://upload.wikimedia.org/wikipedia/commons/2/22/Earth_Western_Hemisphere_transparent_background.png"
      />
      
      {/* Nebulas and Twinkling Stars */}
      <div className="absolute inset-0 z-5 pointer-events-none">
        <div className="absolute top-[10%] left-[20%] w-[500px] h-[500px] bg-purple-600/20 blur-[150px] rounded-full mix-blend-screen"></div>
        <div className="absolute bottom-[20%] right-[10%] w-[600px] h-[600px] bg-indigo-600/20 blur-[180px] rounded-full mix-blend-screen"></div>
        
        {/* Simple CSS rendered stars */}
        {Array.from({ length: 30 }).map((_, i) => (
          <div 
            key={i}
            className="absolute rounded-full bg-white animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              width: `${Math.random() * 3 + 1}px`,
              height: `${Math.random() * 3 + 1}px`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`
            }}
          ></div>
        ))}
      </div>

      <div className="fixed inset-0 z-15 hologram-overlay opacity-40 pointer-events-none"></div>
      <div className="fixed inset-0 z-15 grain pointer-events-none"></div>
      <div className="fixed inset-0 z-15 scanline opacity-5 pointer-events-none"></div>

      {/* UI Overlay Elements */}
      <main className="relative z-20 h-screen w-full pt-20 flex flex-col pointer-events-none">
        
        {/* Giant Timer in Corner */}
        {gameState === 'playing' && (
          <div className={`absolute top-6 right-8 flex flex-col items-end z-50 transition-all ${timeRemaining <= 10 ? 'animate-shake' : ''}`}>
            <span className="text-white/60 font-headline font-bold text-sm tracking-widest uppercase mb-1">THỜI GIAN CÒN LẠI</span>
            <div className={`font-mono font-black text-6xl tracking-tighter drop-shadow-[0_0_20px_rgba(255,255,255,0.4)] ${timeRemaining <= 10 ? 'text-red-500 text-7xl drop-shadow-[0_0_40px_rgba(255,0,0,0.8)]' : 'text-white'}`}>
              {formatTime(timeRemaining)}
            </div>
          </div>
        )}

        {/* Top HUD Layout (Score & Stats) */}
        {gameState === 'playing' && (
          <div className="absolute top-24 left-0 w-full px-4 md:px-8 z-30 pointer-events-auto flex justify-between items-start">
            {/* Player Stats */}
            <div className="flex flex-col gap-4 w-80 relative">
              <div className="glass-panel px-6 py-4 rounded-2xl border-2 border-[#00E5FF]/50 flex flex-col items-start bg-gradient-to-r from-[#00E5FF]/20 to-transparent shadow-[0_0_40px_rgba(0,229,255,0.4)] relative overflow-hidden backdrop-blur-xl">
                <span className="font-headline text-[#00E5FF] text-sm tracking-[0.2em] mb-1 font-bold">NGƯỜI CHƠI</span>
                <span className="font-mono text-5xl font-black text-white drop-shadow-[0_0_15px_rgba(0,229,255,0.8)]">
                  {scores[0].toLocaleString()}
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-end">
                  <span className="font-headline font-bold text-white tracking-widest text-sm uppercase">
                    FEVER MODE
                  </span>
                  <span className={`font-headline font-black text-lg ${feverModes[0] ? 'text-primary animate-pulse' : 'text-white/80'}`}>
                    {feverModes[0] ? 'MAX' : `${combos[0]}/15`}
                  </span>
                </div>
                <div className="h-4 bg-black/60 rounded-full overflow-hidden border border-white/20 p-0.5">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${feverModes[0] ? 'bg-primary shadow-[0_0_15px_rgba(0,185,209,1)]' : 'bg-primary/60'}`}
                    style={{ width: `${(combos[0] / 15) * 100}%` }}
                  ></div>
                </div>
                {feverModes[0] && <div className="text-primary text-[12px] font-bold tracking-widest animate-pulse mt-1">SẴN SÀNG HÚT RÁC!</div>}
              </div>
            </div>

            <div className="w-64"></div>
          </div>
        )}

        {/* Central Game Entry & Reactor Section */}
        <div className="flex-grow flex flex-col items-center justify-center pt-20">
          {/* MAG-BOTTLE REACTOR */}
          <div
            ref={reactorRef}
            className="relative w-[450px] h-[450px] flex items-center justify-center pointer-events-auto"
          >
            {(feverModes[0] || feverModes[1]) ? (
              <div className="absolute inset-0 bg-black rounded-full shadow-[0_0_150px_#FF00FF] animate-pulse flex items-center justify-center overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,0,255,0.8)_0%,rgba(0,0,0,1)_70%)] animate-spin" style={{ animationDuration: '3s' }}></div>
                <div className="w-full h-full rounded-full border-8 border-[#00FFFF] border-dashed animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }}></div>
                <div className="absolute w-28 h-28 bg-black rounded-full shadow-[0_0_50px_#000]"></div>
              </div>
            ) : (
              <>
                {/* Frame Accents */}
                <div className="absolute -top-3 -right-3 w-12 h-12 border-t-2 border-r-2 border-primary/40 rounded-tr-2xl"></div>
                <div className="absolute -bottom-3 -left-3 w-12 h-12 border-b-2 border-l-2 border-primary/40 rounded-bl-2xl"></div>
                {/* Rotating Rings */}
                <div
                  className="absolute inset-4 border border-secondary/30 rounded-full animate-spin shadow-[0_0_15px_rgba(0,185,209,0.1)]"
                  style={{ animationDuration: '12s' }}
                ></div>
                <div
                  className="absolute inset-0 border border-primary/20 rounded-full animate-spin shadow-[0_0_20px_rgba(255,140,0,0.1)]"
                  style={{ animationDuration: '18s', animationDirection: 'reverse' }}
                ></div>
                {/* Holographic Core (Vibrant Orange) */}
                <div className="relative w-64 h-64 flex items-center justify-center">
                  <div className="absolute inset-0 bg-orange-600/30 blur-[60px] rounded-full animate-pulse"></div>
                  <div
                    className="absolute inset-0 bg-orange-500/20 blur-[70px] rounded-full animate-pulse"
                    style={{ animationDelay: '1.5s' }}
                  ></div>
                  <div className="absolute inset-0 bg-gradient-to-br from-[#FF4500] via-[#FF8C00] to-red-600 plasma-pulse-vibrant rounded-2xl"></div>
                  <div className="absolute inset-3 border-2 border-white/20 rotate-45 rounded-xl mix-blend-overlay"></div>
                  <div className="w-28 h-28 bg-white/60 rounded-full blur-2xl animate-pulse"></div>
                  <div
                    className="absolute -inset-10 border-2 border-secondary/40 rounded-full animate-spin"
                    style={{ animationDuration: '5s', borderStyle: 'dashed' }}
                  ></div>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

      {/* Game Entry Modal */}
      {gameState === 'menu' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 backdrop-blur-sm pointer-events-none">
          <h1 className="font-headline text-white text-5xl font-black tracking-[0.2em] relative uppercase glow-primary mb-8 text-center drop-shadow-[0_0_20px_rgba(255,255,255,0.5)]">
            ĐƯA LÊN 2 BÀN TAY<br/>ĐỂ BẮT ĐẦU TRÒ CHƠI
            <div className="absolute -inset-4 border-2 border-primary/20 blur-sm rounded-3xl animate-pulse"></div>
          </h1>
        </div>
      )}

      {/* Game Over Modal */}
      {gameState === 'gameover' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md pointer-events-auto">
          <div className="glass-panel border-[#FFD700]/50 w-full max-w-md rounded-2xl overflow-hidden shadow-[0_0_80px_rgba(255,215,0,0.4)] p-8 flex flex-col items-center gap-6 bg-gradient-to-b from-[#FFD700]/10 to-transparent">
            <div className="text-center">
              <h2 className="font-headline text-transparent bg-clip-text bg-gradient-to-b from-[#FFF] to-[#FFD700] text-5xl font-black tracking-[0.3rem] uppercase drop-shadow-[0_0_20px_rgba(255,215,0,0.8)] mb-2">
                HOÀN THÀNH
              </h2>
              <div className="flex flex-col gap-2 mt-4">
                <p className="font-body text-[#FFD700] text-sm uppercase font-bold tracking-widest">
                  ĐIỂM SỐ: <span className="text-white text-2xl ml-2">{scores[0].toLocaleString()} XP</span>
                </p>
              </div>
              <p className="text-primary font-bold mt-4 text-3xl tracking-widest glow-primary">LÀM TỐT LẮM!</p>
            </div>
            
            <button 
              onClick={() => setGameState('menu')}
              className="group relative w-full h-14 rounded-xl overflow-hidden transition-all active:scale-95 shadow-[0_10px_30px_rgba(0,185,209,0.4)]"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-secondary to-blue-500 group-hover:from-blue-500 group-hover:to-secondary transition-all duration-300"></div>
              <span className="relative flex items-center justify-center gap-3 text-white font-headline font-black tracking-[0.2em] text-base uppercase">
                QUAY LẠI TRANG CHỦ
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Bottom Navigation Bar (Mobile) */}
      <footer className="fixed bottom-0 left-0 w-full z-50 flex justify-around items-center h-16 bg-black/90 md:hidden border-t border-white/10 backdrop-blur-3xl">
        <div 
          className="flex flex-col items-center justify-center text-secondary p-2 active:scale-90 transition-all pointer-events-auto"
          onClick={() => setGameState('menu')}
        >
          <Rocket className="w-5 h-5" />
          <span className="font-headline text-[8px] font-bold tracking-widest mt-0.5 uppercase">
            CHƠI LẠI
          </span>
        </div>
        <div 
          className="flex flex-col items-center justify-center text-white/50 p-2 cursor-not-allowed transition-all"
        >
          <Trophy className="w-5 h-5 opacity-50" />
          <span className="font-headline text-[8px] font-bold tracking-widest mt-0.5 uppercase opacity-50">
            XẾP HẠNG
          </span>
        </div>
        <div
          className="flex flex-col items-center justify-center bg-primary text-on-primary px-6 py-1.5 rounded-lg active:scale-95 transition-all shadow-[0_0_15px_#d67779] pointer-events-auto"
          style={{ boxShadow: '0 0 15px #FF0000' }}
          onClick={startGame}
        >
          <Play className="w-5 h-5" />
          <span className="font-headline text-[8px] font-bold tracking-widest mt-0.5 uppercase">
            BẮT ĐẦU
          </span>
        </div>
      </footer>
    </div>
  );
}
