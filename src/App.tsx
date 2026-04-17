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

  playScoreSound() {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(800, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, this.ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.1);
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
const TREASURE_EMOJIS = ['🎁'];
const FALL_SPEED = 2;
const SPAWN_RATE = 1200; // ms
const PINCH_THRESHOLD = 60; // px
const GRAB_RADIUS = 60; // px

const SPACE_QUIZ = [
  // Easy Questions (10)
  { q: "What is the red planet?", a: "mars", difficulty: "easy" },
  { q: "What star is at the center of our solar system?", a: "sun", difficulty: "easy" },
  { q: "How many moons does Earth have?", a: "1", difficulty: "easy" },
  { q: "Is the Sun a planet or a star?", a: "star", difficulty: "easy" },
  { q: "What do we call a shooting star?", a: "meteor", difficulty: "easy" },
  { q: "What is the name of the planet we live on?", a: "earth" , difficulty: "easy" },
  { q: "What do you call a person who travels to space?", a: "astronaut", difficulty: "easy" },
  { q: "Which planet is the smallest in our solar system?", a: "mercury", difficulty: "easy" },
  { q: "What is the brightest object in the night sky?", a: "moon", difficulty: "easy" },
  { q: "What is the shape of the Earth?", a: "sphere", difficulty: "easy" },
  
  // Medium Questions (10)
  { q: "What is the largest planet in our solar system?", a: "jupiter", difficulty: "medium" },
  { q: "Which planet is known as the Blue Planet?", a: "earth", difficulty: "medium" },
  { q: "Which planet is famous for its Great Red Spot?", a: "jupiter", difficulty: "medium" },
  { q: "Which planet is the furthest from the Sun?", a: "neptune", difficulty: "medium" },
  { q: "What is the name of our galaxy?", a: "milky way", difficulty: "medium" },
  { q: "What is a group of stars that forms a pattern?", a: "constellation", difficulty: "medium" },
  { q: "What is the name of the large telescope in space?", a: "hubble", difficulty: "medium" },
  { q: "Who was the first person to walk on the moon?", a: "neil armstrong", difficulty: "medium" },
  { q: "What is the name of the first artificial satellite?", a: "sputnik", difficulty: "medium" },
  { q: "Which planet is the coldest in our solar system?", a: "uranus", difficulty: "medium" },
];

interface GameObject {
  id: number;
  type: 'trash' | 'satellite' | 'bomb' | 'treasure';
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
  onTreasureScored,
  reactorRef,
  gameState,
  numPlayers,
}: {
  onScoreChange: (playerIndex: number, delta: number) => void;
  onComboChange: (playerIndex: number, combo: number, isFever: boolean) => void;
  onTreasureScored: (playerIndex: number) => void;
  reactorRef: React.RefObject<HTMLDivElement | null>;
  gameState: 'menu' | 'countdown' | 'playing' | 'gameover';
  numPlayers: number;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraStarting, setIsCameraStarting] = useState(false);
  const objectsRef = useRef<GameObject[]>([]);
  const lastSpawnTimeRef = useRef<number>(0);
  const requestRef = useRef<number>(0);
  const nextIdRef = useRef<number>(0);
  const lastLandmarksRef = useRef<any[]>([]);

  const combosRef = useRef<[number, number]>([0, 0]);
  const comboVisualsRef = useRef<{ x: number, y: number, time: number, playerIndex: number, isBig: boolean, level: number }[]>([]);
  const feverEndTimesRef = useRef<[number, number]>([0, 0]);
  const feverModesRef = useRef<[boolean, boolean]>([false, false]);
  const MAX_COMBO = 20;
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
      lastSpawnTimeRef.current = performance.now() - SPAWN_RATE;
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
        let type: 'trash' | 'satellite' | 'bomb' | 'treasure' = 'trash';
        let emojiList = TRASH_EMOJIS;
        
        if (rand > 0.95 && numPlayers === 1) {
          type = 'treasure';
          emojiList = TREASURE_EMOJIS;
        } else if (rand > 0.85) {
          type = 'bomb';
          emojiList = BOMB_EMOJIS;
        } else if (rand > 0.7) {
          type = 'satellite';
          emojiList = SATELLITE_EMOJIS;
        }

        const emoji = emojiList[Math.floor(Math.random() * emojiList.length)];
        
        objectsRef.current.push({
          id: nextIdRef.current++,
          type,
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

          if (mappedLandmarks.length >= 9) {
            // Check pinch (Thumb tip = 4, Index tip = 8)
            const thumb = mappedLandmarks[4];
            const indexFinger = mappedLandmarks[8];
            const dist = Math.hypot(thumb.x - indexFinger.x, thumb.y - indexFinger.y);
            const isPinching = dist < PINCH_THRESHOLD;

            const pinchCenter = {
              x: (thumb.x + indexFinger.x) / 2,
              y: (thumb.y + indexFinger.y) / 2,
            };

            const playerIndex = playerIdx; // Use the already determined playerIdx

            // Draw pinch indicator
            if (isPinching) {
              ctx.beginPath();
              ctx.arc(pinchCenter.x, pinchCenter.y, 15, 0, 2 * Math.PI);
              ctx.fillStyle = colors[playerIndex];
              ctx.fill();
            }

            currentHands.push({
              x: pinchCenter.x,
              y: pinchCenter.y,
              isPinching,
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
          soundManager.playScoreSound();
          
          let comboLevel = Math.floor(combosRef.current[playerIndex] / 3);
          let scoreDelta = 10 * Math.pow(2, comboLevel);
          onScoreChange(playerIndex, scoreDelta);
          combosRef.current[playerIndex] = Math.min(combosRef.current[playerIndex] + 1, MAX_COMBO);
          
          // Floating combo text
          if (combosRef.current[playerIndex] % 3 === 0 || combosRef.current[playerIndex] === MAX_COMBO) {
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
        } else if (obj.type === 'treasure') {
          soundManager.playScoreSound();
          onTreasureScored(playerIndex);
        } else if (obj.type === 'bomb') {
          soundManager.playBombSound();
          onScoreChange(playerIndex, -20);
          combosRef.current[playerIndex] = 0;
          onComboChange(playerIndex, 0, false);
        } else {
          soundManager.playBombSound();
          onScoreChange(playerIndex, -10);
          combosRef.current[playerIndex] = 0;
          onComboChange(playerIndex, 0, false);
        }
      };

      // Update Objects
      const playersHolding = new Set<number>();
      
      // First pass: identify players already holding objects
      for (const obj of objectsRef.current) {
        if (obj.isGrabbed && obj.grabbedByPlayerIndex !== null) {
          playersHolding.add(obj.grabbedByPlayerIndex);
        }
      }

      for (let i = objectsRef.current.length - 1; i >= 0; i--) {
        const obj = objectsRef.current[i];

        // 1. Vacuum (Fever)
        if (obj.vacuumedByPlayerIndex === null) {
          for (const hand of currentHands) {
            if (feverModesRef.current[hand.playerIndex]) {
              const dist = Math.hypot(obj.x - hand.x, obj.y - hand.y);
              if (dist < 250) { // Vacuum radius
                obj.vacuumedByPlayerIndex = hand.playerIndex;
                obj.isGrabbed = false;
                break;
              }
            }
          }
        }

        if (obj.vacuumedByPlayerIndex !== null) {
          const dx = reactorCenterX - obj.x;
          const dy = reactorCenterY - obj.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 50) {
            handleObjectScored(obj, obj.vacuumedByPlayerIndex);
            objectsRef.current.splice(i, 1);
          } else {
            obj.x += (dx / dist) * 25;
            obj.y += (dy / dist) * 25;
          }
          continue;
        }

        // 2. Normal Grab
        if (obj.isGrabbed) {
          const grabbingHand = currentHands.find((h) => h.playerIndex === obj.grabbedByPlayerIndex);
          if (grabbingHand && grabbingHand.isPinching) {
            obj.x = grabbingHand.x;
            obj.y = grabbingHand.y;
          } else {
            obj.isGrabbed = false;
            if (
              obj.x > reactorBounds.left &&
              obj.x < reactorBounds.right &&
              obj.y > reactorBounds.top &&
              obj.y < reactorBounds.bottom
            ) {
              handleObjectScored(obj, obj.grabbedByPlayerIndex!);
              objectsRef.current.splice(i, 1);
              continue;
            }
            obj.grabbedByPlayerIndex = null;
          }
        } else {
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

          for (const hand of currentHands) {
            const isFever = feverModesRef.current[hand.playerIndex];
            if (hand.isPinching && !playersHolding.has(hand.playerIndex)) {
              const dist = Math.hypot(obj.x - hand.x, obj.y - hand.y);
              const currentGrabRadius = isFever ? 200 : GRAB_RADIUS;
              if (dist < currentGrabRadius) {
                obj.isGrabbed = true;
                obj.grabbedByPlayerIndex = hand.playerIndex;
                obj.isRegretting = false;
                obj.vx = 0;
                playersHolding.add(hand.playerIndex);
                break;
              }
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
        ctx.font = '60px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(obj.emoji, obj.x, obj.y);
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
          ctx.fillText(`FEVER ${visual.level}`, 0, 0);
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
  const [activeQuiz, setActiveQuiz] = useState<{
    question: string;
    answer: string;
    difficulty: string;
    playerIndex: number;
    timeLeft: number;
  } | null>(null);
  const [quizInput, setQuizInput] = useState('');
  const [quizFeedback, setQuizFeedback] = useState<{
    message: string;
    color: string;
    playerIndex: number;
    id: number;
  } | null>(null);
  const [gameState, setGameState] = useState<'menu' | 'countdown' | 'playing' | 'gameover'>('menu');
  const [countdownValue, setCountdownValue] = useState<number>(3);
  const [gameDuration, setGameDuration] = useState<number>(5);
  const [numPlayers, setNumPlayers] = useState<number>(1);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [player1Name, setPlayer1Name] = useState('');
  const [player2Name, setPlayer2Name] = useState('');
  const [showNameEntry, setShowNameEntry] = useState(false);
  const [language, setLanguage] = useState<'en' | 'vi'>('en');
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
  }, [gameState, player1Name, player2Name]);

  // Quiz timer effect
  useEffect(() => {
    if (activeQuiz && gameState === 'playing') {
      const timer = setInterval(() => {
        setActiveQuiz(prev => {
          if (!prev) return null;
          if (prev.timeLeft <= 1) {
            clearInterval(timer);
            return null;
          }
          return { ...prev, timeLeft: prev.timeLeft - 1 };
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [activeQuiz, gameState]);

  const startGame = () => {
    setShowNameEntry(true);
  };

  const confirmNamesAndStart = () => {
    if (numPlayers === 1 && !player1Name.trim()) return;
    if (numPlayers === 2 && (!player1Name.trim() || !player2Name.trim())) return;
    
    soundManager.init();
    setScores([0, 0]);
    setCombos([0, 0]);
    setFeverModes([false, false]);
    setActiveQuiz(null);
    setTimeRemaining(gameDuration * 60);
    setCountdownValue(3);
    setGameState('countdown');
    setShowNameEntry(false);
  };

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

  const handleTreasureScored = useCallback((playerIndex: number) => {
    const randomQuiz = SPACE_QUIZ[Math.floor(Math.random() * SPACE_QUIZ.length)];
    setActiveQuiz({
      question: randomQuiz.q,
      answer: randomQuiz.a,
      difficulty: randomQuiz.difficulty,
      playerIndex,
      timeLeft: 30,
    });
    setQuizInput('');
  }, []);

  const submitQuiz = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQuiz) return;

    const isCorrect = quizInput.toLowerCase().trim() === activeQuiz.answer.toLowerCase();
    const pIndex = activeQuiz.playerIndex;
    let diff = 0;
    let msg = "";
    let color = "";

    if (isCorrect) {
      if (activeQuiz.difficulty === 'easy') {
        diff = 50;
        msg = "+50";
      } else {
        diff = scores[pIndex]; // Just for visual, it doubles
        msg = "x2";
      }
      color = "text-green-400";
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    } else {
      if (activeQuiz.difficulty === 'easy') {
        diff = -30;
        msg = "-30";
      } else {
        diff = -50;
        msg = "-50";
      }
      color = "text-red-500";
      soundManager.playBombSound();
    }

    setScores(prev => {
      const next = [...prev] as [number, number];
      if (isCorrect) {
        if (activeQuiz.difficulty === 'easy') {
          next[pIndex] += 50;
        } else {
          next[pIndex] *= 2;
        }
      } else {
        next[pIndex] = Math.max(0, next[pIndex] + diff);
      }
      return next;
    });

    setQuizFeedback({ message: msg, color, playerIndex: pIndex, id: Date.now() });
    setTimeout(() => setQuizFeedback(null), 1500);

    setActiveQuiz(null);
  };

  return (
    <div className="bg-background text-on-surface font-body overflow-hidden select-none min-h-screen">
      <GameCanvas 
        onScoreChange={handleScoreChange} 
        onComboChange={handleComboChange} 
        onTreasureScored={handleTreasureScored}
        reactorRef={reactorRef} 
        gameState={gameState} 
        numPlayers={numPlayers} 
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

      {/* Quiz Overlay */}
      {activeQuiz && gameState === 'playing' && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4 pointer-events-auto">
          <div className={`glass-panel p-6 rounded-2xl border-2 ${activeQuiz.playerIndex === 0 ? 'border-primary' : 'border-secondary'} shadow-[0_0_30px_rgba(0,0,0,0.5)]`}>
            <div className="flex justify-between items-center mb-4">
              <span className={`font-headline font-bold text-xs tracking-widest ${activeQuiz.playerIndex === 0 ? 'text-primary' : 'text-secondary'}`}>
                {activeQuiz.playerIndex === 0 ? player1Name : player2Name}'S SPACE QUIZ
              </span>
              <span className="font-mono text-xl font-bold text-white animate-pulse">
                {activeQuiz.timeLeft}s
              </span>
            </div>
            <h3 className="text-white font-headline text-lg mb-4 leading-tight">
              {activeQuiz.question}
            </h3>
            <form onSubmit={submitQuiz} className="flex gap-2">
              <input
                autoFocus
                type="text"
                value={quizInput}
                onChange={(e) => setQuizInput(e.target.value)}
                placeholder="Type your answer..."
                className="flex-grow bg-black/50 border border-white/20 rounded-xl px-4 py-2 text-white font-mono focus:outline-none focus:border-primary transition-all"
              />
              <button
                type="submit"
                className={`px-6 py-2 rounded-xl font-headline font-bold text-white transition-all ${activeQuiz.playerIndex === 0 ? 'bg-primary hover:bg-primary/80' : 'bg-secondary hover:bg-secondary/80'}`}
              >
                SUBMIT
              </button>
            </form>
            <p className="text-white/40 text-[10px] mt-3 uppercase tracking-widest text-center">
              {activeQuiz.difficulty === 'easy' ? 'Correct answer gives +50 points!' : 'Correct answer doubles your current score!'}
            </p>
          </div>
        </div>
      )}

      <div className="fixed inset-0 z-15 hologram-overlay opacity-40 pointer-events-none"></div>
      <div className="fixed inset-0 z-15 grain pointer-events-none"></div>
      <div className="fixed inset-0 z-15 scanline opacity-5 pointer-events-none"></div>

      {/* Top Navigation App Bar */}
      <header className="fixed top-0 left-0 w-full z-50 flex justify-between items-center px-8 py-4 backdrop-blur-2xl bg-surface/60 border-b border-white/10">
        <div className="flex items-center gap-6 chromatic-aberration">
          <span className="text-xl font-bold tracking-tight font-headline glow-primary">
            NEBULA_OS.v2
          </span>
          <div className="h-5 w-[1px] bg-white/20"></div>
          <div className="flex items-center gap-4">
            <input 
              type="text" 
              value={player1Name}
              onChange={(e) => setPlayer1Name(e.target.value)}
              placeholder="PLAYER 1 NAME" 
              className="bg-black/50 border border-white/20 rounded px-3 py-1 text-xs text-white focus:outline-none focus:border-primary pointer-events-auto"
            />
            {numPlayers === 2 && (
              <>
                <span className="text-white/50 text-xs">VS</span>
                <input 
                  type="text" 
                  value={player2Name}
                  onChange={(e) => setPlayer2Name(e.target.value)}
                  placeholder="PLAYER 2 NAME" 
                  className="bg-black/50 border border-white/20 rounded px-3 py-1 text-xs text-white focus:outline-none focus:border-secondary pointer-events-auto"
                />
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button 
            onClick={() => setGameState('menu')}
            className="flex items-center gap-2 px-4 py-2 bg-primary/20 hover:bg-primary/40 border border-primary/50 rounded-lg transition-all pointer-events-auto group"
          >
            <Rocket className="w-4 h-4 text-primary group-hover:scale-110 transition-transform" />
            <span className="font-headline font-bold tracking-widest text-[10px] uppercase text-white">
              NEW GAME
            </span>
          </button>
          <button 
            onClick={() => setShowLeaderboard(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg transition-all pointer-events-auto group"
          >
            <Trophy className="w-4 h-4 text-yellow-500 group-hover:scale-110 transition-transform" />
            <span className="font-headline font-bold tracking-widest text-[10px] uppercase text-white">
              LEADERBOARD
            </span>
          </button>
        </div>
      </header>

      {/* UI Overlay Elements */}
      <main className="relative z-20 h-screen w-full pt-20 flex flex-col pointer-events-none">
        {/* Top HUD Layout (Score & Stats) */}
        {gameState === 'playing' && (
          <div className="absolute top-24 left-0 w-full px-4 md:px-8 z-30 pointer-events-auto flex justify-between items-start">
            {/* Player 1 Stats (Left) */}
            <div className="flex flex-col gap-4 w-64 relative">
              <div className="glass-panel px-6 py-3 rounded-2xl border border-primary/30 flex flex-col items-start bg-primary/5 shadow-[0_0_20px_rgba(0,185,209,0.2)] relative overflow-hidden">
                <span className="font-headline text-primary/80 text-xs tracking-[0.2em] mb-1">{player1Name || 'PLAYER 1'}</span>
                <span className="font-mono text-3xl font-black text-white glow-primary">
                  {scores[0].toLocaleString()}
                </span>
                {quizFeedback?.playerIndex === 0 && (
                  <span key={quizFeedback.id} className={`absolute top-1/2 -translate-y-1/2 right-6 font-black text-3xl animate-bounce ${quizFeedback.color}`}>
                    {quizFeedback.message}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-end">
                  <span className="font-headline font-bold text-white tracking-widest text-xs uppercase">
                    Fever Mode
                  </span>
                  <span className={`font-headline font-black text-sm ${feverModes[0] ? 'text-primary animate-pulse' : 'text-white/70'}`}>
                    {feverModes[0] ? 'MAX' : `${combos[0]}/20`}
                  </span>
                </div>
                <div className="h-2 bg-black/50 rounded-full overflow-hidden border border-white/10 p-0.5">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${feverModes[0] ? 'bg-primary shadow-[0_0_10px_rgba(0,185,209,0.8)]' : 'bg-primary/50'}`}
                    style={{ width: `${(combos[0] / 20) * 100}%` }}
                  ></div>
                </div>
                {feverModes[0] && <div className="text-primary text-[10px] font-bold tracking-widest animate-pulse mt-1">FEVER MODE!</div>}
              </div>
            </div>

            {/* Time (Center) */}
            <div className="flex flex-col items-center gap-2">
              <div className="font-mono text-4xl font-black text-white tracking-widest drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">
                {formatTime(timeRemaining)}
              </div>
            </div>

            {/* Player 2 Stats (Right) */}
            {numPlayers === 2 ? (
              <div className="flex flex-col gap-4 w-64 items-end relative">
                <div className="glass-panel px-6 py-3 rounded-2xl border border-secondary/30 flex flex-col items-end bg-secondary/5 shadow-[0_0_20px_rgba(255,0,255,0.2)] relative overflow-hidden">
                  <span className="font-headline text-secondary/80 text-xs tracking-[0.2em] mb-1">{player2Name || 'PLAYER 2'}</span>
                  <span className="font-mono text-3xl font-black text-white shadow-[0_0_15px_rgba(255,0,255,0.5)]">
                    {scores[1].toLocaleString()}
                  </span>
                  {quizFeedback?.playerIndex === 1 && (
                    <span key={quizFeedback.id} className={`absolute top-1/2 -translate-y-1/2 left-6 font-black text-3xl animate-bounce ${quizFeedback.color}`}>
                      {quizFeedback.message}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-2 w-full">
                  <div className="flex justify-between items-end">
                    <span className="font-headline font-bold text-white tracking-widest text-xs uppercase">Fever Mode</span>
                    <span className={`font-headline font-black text-sm ${feverModes[1] ? 'text-secondary animate-pulse' : 'text-white/70'}`}>
                      {feverModes[1] ? 'MAX' : `${combos[1]}/20`}
                    </span>
                  </div>
                  <div className="h-2 bg-black/50 rounded-full overflow-hidden border border-white/10 p-0.5">
                    <div 
                      className={`h-full rounded-full transition-all duration-300 ${feverModes[1] ? 'bg-secondary shadow-[0_0_10px_rgba(255,0,255,0.8)]' : 'bg-secondary/50'}`}
                      style={{ width: `${(combos[1] / 20) * 100}%` }}
                    ></div>
                  </div>
                  {feverModes[1] && <div className="text-secondary text-[10px] font-bold tracking-widest animate-pulse mt-1 text-right">FEVER MODE!</div>}
                </div>
              </div>
            ) : (
              <div className="w-64"></div>
            )}
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

      {/* Name Entry Modal */}
      {showNameEntry && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-xl pointer-events-auto">
          <div className="glass-panel border-primary/50 w-full max-w-md rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(0,185,209,0.3)] p-8 flex flex-col items-center gap-8">
            <div className="text-center">
              <h2 className="font-headline text-white text-3xl font-black tracking-[0.4rem] uppercase glow-primary mb-2">
                {language === 'en' ? 'IDENTIFY PILOTS' : 'NHẬP TÊN NGƯỜI CHƠI'}
              </h2>
              <p className="font-body text-white/60 text-[10px] uppercase font-bold tracking-widest">
                {language === 'en' ? 'ENTER YOUR CALLSIGNS TO BEGIN' : 'ĐIỀN TÊN CỦA BẠN ĐỂ BẮT ĐẦU'}
              </p>
            </div>

            <div className="flex flex-col gap-6 w-full">
              <div className="flex flex-col gap-2">
                <label className="text-primary text-[10px] font-black tracking-widest uppercase ml-1">
                  {language === 'en' ? 'PILOT 01' : 'NGƯỜI CHƠI 01'}
                </label>
                <input 
                  type="text" 
                  value={player1Name}
                  onChange={(e) => setPlayer1Name(e.target.value.toUpperCase())}
                  placeholder={language === 'en' ? "ENTER NAME" : "NHẬP TÊN"}
                  autoFocus
                  className="w-full bg-black/50 border-2 border-primary/30 rounded-xl px-4 py-3 text-white font-headline font-bold tracking-widest focus:outline-none focus:border-primary transition-all placeholder:text-white/20"
                />
              </div>

              {numPlayers === 2 && (
                <div className="flex flex-col gap-2">
                  <label className="text-secondary text-[10px] font-black tracking-widest uppercase ml-1">
                    {language === 'en' ? 'PILOT 02' : 'NGƯỜI CHƠI 02'}
                  </label>
                  <input 
                    type="text" 
                    value={player2Name}
                    onChange={(e) => setPlayer2Name(e.target.value.toUpperCase())}
                    placeholder={language === 'en' ? "ENTER NAME" : "NHẬP TÊN"}
                    className="w-full bg-black/50 border-2 border-secondary/30 rounded-xl px-4 py-3 text-white font-headline font-bold tracking-widest focus:outline-none focus:border-secondary transition-all placeholder:text-white/20"
                  />
                </div>
              )}
            </div>

            <button 
              onClick={confirmNamesAndStart}
              disabled={(numPlayers === 1 && !player1Name.trim()) || (numPlayers === 2 && (!player1Name.trim() || !player2Name.trim()))}
              className="group relative w-full h-14 rounded-xl overflow-hidden transition-all active:scale-95 shadow-[0_10px_30px_rgba(0,185,209,0.4)] disabled:opacity-50 disabled:pointer-events-none"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-primary to-secondary group-hover:from-secondary group-hover:to-primary transition-all duration-300"></div>
              <span className="relative flex items-center justify-center gap-3 text-white font-headline font-black tracking-[0.2em] text-base uppercase">
                {language === 'en' ? 'CONFIRM & LAUNCH' : 'XÁC NHẬN VÀ LÊN ĐƯỜNG'}
                <Rocket className="w-5 h-5 group-hover:-translate-y-1 transition-transform" />
              </span>
            </button>
            
            <button 
              onClick={() => setShowNameEntry(false)}
              className="text-white/40 hover:text-white text-[10px] font-bold tracking-widest uppercase transition-colors"
            >
              {language === 'en' ? 'CANCEL' : 'HỦY BỎ'}
            </button>
          </div>
        </div>
      )}

      {/* Game Entry Modal */}
      {gameState === 'menu' && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto">
          <div className="glass-panel border-primary/30 w-full max-w-md rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(255,0,0,0.2)] p-8 flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="font-headline text-white text-3xl font-black tracking-[0.4rem] uppercase glow-primary mb-2">
                {language === 'en' ? 'NEW GAME' : 'TRÒ CHƠI MỚI'}
              </h2>
              <p className="font-body text-white/60 text-[10px] uppercase font-bold tracking-widest">
                {language === 'en' ? 'SELECT PLAYERS & DURATION' : 'CHỌN NGƯỜI CHƠI & THỜI GIAN'}
              </p>
            </div>
            
            <div className="flex gap-4 w-full">
              <button 
                onClick={() => setNumPlayers(1)}
                className={`flex-1 py-4 rounded-xl border-2 transition-all font-headline font-black tracking-widest text-sm uppercase ${numPlayers === 1 ? 'bg-primary/20 border-primary text-white shadow-[0_0_20px_rgba(0,185,209,0.3)]' : 'bg-black/60 border-white/20 text-white/50 hover:border-white/50'}`}
              >
                {language === 'en' ? '1 PLAYER' : '1 NGƯỜI'}
              </button>
              <button 
                onClick={() => setNumPlayers(2)}
                className={`flex-1 py-4 rounded-xl border-2 transition-all font-headline font-black tracking-widest text-sm uppercase ${numPlayers === 2 ? 'bg-primary/20 border-primary text-white shadow-[0_0_20px_rgba(0,185,209,0.3)]' : 'bg-black/60 border-white/20 text-white/50 hover:border-white/50'}`}
              >
                {language === 'en' ? '2 PLAYERS' : '2 NGƯỜI'}
              </button>
            </div>

            <div className="flex gap-4 w-full">
              <button 
                onClick={() => setGameDuration(5)}
                className={`flex-1 py-4 rounded-xl border-2 transition-all font-headline font-black tracking-widest text-sm uppercase ${gameDuration === 5 ? 'bg-primary/20 border-primary text-white shadow-[0_0_20px_rgba(255,0,0,0.3)]' : 'bg-black/60 border-white/20 text-white/50 hover:border-white/50'}`}
              >
                {language === 'en' ? '5 MIN' : '5 PHÚT'}
              </button>
              <button 
                onClick={() => setGameDuration(10)}
                className={`flex-1 py-4 rounded-xl border-2 transition-all font-headline font-black tracking-widest text-sm uppercase ${gameDuration === 10 ? 'bg-primary/20 border-primary text-white shadow-[0_0_20px_rgba(255,0,0,0.3)]' : 'bg-black/60 border-white/20 text-white/50 hover:border-white/50'}`}
              >
                {language === 'en' ? '10 MIN' : '10 PHÚT'}
              </button>
            </div>

            <div className="w-full bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-yellow-500 shrink-0 mt-0.5" />
              <p className="text-yellow-500/90 font-body text-xs leading-relaxed text-left">
                <strong className="font-bold block mb-1">PRO TIP</strong>
                {language === 'en' 
                  ? 'When dropping trash into the reactor, make sure to open your fingers wide to release it properly!'
                  : 'Khi thả rác vào lò phản ứng trung tâm, hãy nhớ mở tay thật rộng ra để nhả rác một cách chính xác nhé!'
                }
              </p>
            </div>

            <button 
              onClick={startGame}
              className="group relative w-full h-14 rounded-xl overflow-hidden transition-all active:scale-95 shadow-[0_10px_30px_rgba(255,0,0,0.4)]"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-[#FF0000] to-[#FF4444] group-hover:from-[#FF4444] group-hover:to-[#FF0000] transition-all duration-300"></div>
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20"></div>
              <span className="relative flex items-center justify-center gap-3 text-white font-headline font-black tracking-[0.2em] text-base uppercase">
                {language === 'en' ? 'START MISSION' : 'BẮT ĐẦU CHƠI'}
                <Zap className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </span>
            </button>
          </div>

          <div className="absolute bottom-6 flex bg-black/60 rounded-full border border-white/20 p-1">
            <button
              onClick={() => setLanguage('en')}
              className={`px-4 py-1.5 text-xs font-bold font-headline tracking-widest rounded-full transition-all ${language === 'en' ? 'bg-primary text-white shadow-lg' : 'text-white/50 hover:text-white'}`}
            >
              ENGLISH
            </button>
            <button
              onClick={() => setLanguage('vi')}
              className={`px-4 py-1.5 text-xs font-bold font-headline tracking-widest rounded-full transition-all ${language === 'vi' ? 'bg-primary text-white shadow-lg' : 'text-white/50 hover:text-white'}`}
            >
              TIẾNG VIỆT
            </button>
          </div>
        </div>
      )}

      {/* Game Over Modal */}
      {gameState === 'gameover' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md pointer-events-auto">
          <div className="glass-panel border-primary/50 w-full max-w-md rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(255,0,0,0.3)] p-8 flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="font-headline text-white text-4xl font-black tracking-[0.4rem] uppercase glow-primary mb-2">
                {language === 'en' ? 'MISSION OVER' : 'HOÀN THÀNH'}
              </h2>
              <div className="flex flex-col gap-2 mt-4">
                <p className="font-body text-primary text-sm uppercase font-bold tracking-widest">
                  {player1Name || (language === 'en' ? 'PLAYER 1' : 'NGƯỜI CHƠI 1')}: <span className="text-white text-xl">{scores[0].toLocaleString()} XP</span>
                </p>
                {numPlayers === 2 && (
                  <p className="font-body text-secondary text-sm uppercase font-bold tracking-widest">
                    {player2Name || (language === 'en' ? 'PLAYER 2' : 'NGƯỜI CHƠI 2')}: <span className="text-white text-xl">{scores[1].toLocaleString()} XP</span>
                  </p>
                )}
              </div>
              {numPlayers === 2 ? (
                <>
                  {scores[0] > scores[1] && <p className="text-primary font-bold mt-4 text-3xl tracking-widest glow-primary">{player1Name || (language === 'en' ? 'PLAYER 1' : 'NGƯỜI CHƠI 1')} {language === 'en' ? 'WINS!' : 'CHIẾN THẮNG!'}</p>}
                  {scores[1] > scores[0] && <p className="text-secondary font-bold mt-4 text-3xl tracking-widest glow-secondary">{player2Name || (language === 'en' ? 'PLAYER 2' : 'NGƯỜI CHƠI 2')} {language === 'en' ? 'WINS!' : 'CHIẾN THẮNG!'}</p>}
                  {scores[0] === scores[1] && <p className="text-white font-bold mt-4 text-3xl tracking-widest">{language === 'en' ? "IT'S A TIE!" : "HÒA NHAU!"}</p>}
                </>
              ) : (
                <p className="text-primary font-bold mt-4 text-3xl tracking-widest glow-primary">{language === 'en' ? 'CONGRATULATIONS' : 'CHÚC MỪNG'} {player1Name || (language === 'en' ? 'PLAYER' : 'NGƯỜI CHƠI')}!</p>
              )}
            </div>
            
            <button 
              onClick={() => setGameState('menu')}
              className="group relative w-full h-14 rounded-xl overflow-hidden transition-all active:scale-95 shadow-[0_10px_30px_rgba(0,185,209,0.4)]"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-secondary to-blue-500 group-hover:from-blue-500 group-hover:to-secondary transition-all duration-300"></div>
              <span className="relative flex items-center justify-center gap-3 text-white font-headline font-black tracking-[0.2em] text-base uppercase">
                {language === 'en' ? 'RETURN TO MENU' : 'QUAY LẠI TRANG CHỦ'}
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
            {language === 'en' ? 'NEW GAME' : 'CHƠI MỚI'}
          </span>
        </div>
        <div 
          className="flex flex-col items-center justify-center text-white/50 p-2 cursor-not-allowed transition-all"
        >
          <Trophy className="w-5 h-5 opacity-50" />
          <span className="font-headline text-[8px] font-bold tracking-widest mt-0.5 uppercase opacity-50">
            {language === 'en' ? 'LEADERS' : 'XẾP HẠNG'}
          </span>
        </div>
        <div
          className="flex flex-col items-center justify-center bg-primary text-on-primary px-6 py-1.5 rounded-lg active:scale-95 transition-all shadow-[0_0_15px_#d67779] pointer-events-auto"
          style={{ boxShadow: '0 0 15px #FF0000' }}
          onClick={startGame}
        >
          <Play className="w-5 h-5" />
          <span className="font-headline text-[8px] font-bold tracking-widest mt-0.5 uppercase">
            {language === 'en' ? 'START' : 'BẮT ĐẦU'}
          </span>
        </div>
      </footer>
    </div>
  );
}
