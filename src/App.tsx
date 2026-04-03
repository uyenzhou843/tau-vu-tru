import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { Rocket, Trophy, Zap, Play, X } from 'lucide-react';

// --- Game Constants ---
const TRASH_EMOJIS = ['🔩', '💥', '☄️'];
const SATELLITE_EMOJIS = ['🛰️', '📡'];
const FALL_SPEED = 2;
const SPAWN_RATE = 1000; // ms
const PINCH_THRESHOLD = 60; // px
const GRAB_RADIUS = 150; // px

interface GameObject {
  id: number;
  type: 'trash' | 'satellite';
  emoji: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  isGrabbed: boolean;
  grabbedByHandIndex: number | null;
  isRegretting: boolean;
}

function GameCanvas({
  onScoreChange,
  onComboChange,
  reactorRef,
  gameState,
}: {
  onScoreChange: (delta: number) => void;
  onComboChange: (combo: number, isFever: boolean) => void;
  reactorRef: React.RefObject<HTMLDivElement | null>;
  gameState: 'menu' | 'playing' | 'gameover';
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [handLandmarker, setHandLandmarker] = useState<HandLandmarker | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const objectsRef = useRef<GameObject[]>([]);
  const lastSpawnTimeRef = useRef<number>(0);
  const requestRef = useRef<number>(0);
  const nextIdRef = useRef<number>(0);

  const comboRef = useRef<number>(0);
  const feverEndTimeRef = useRef<number>(0);
  const feverModeRef = useRef<boolean>(false);
  const MAX_COMBO = 20;
  const FEVER_DURATION = 30000;

  // Initialize MediaPipe
  useEffect(() => {
    let active = true;
    const initMediaPipe = async () => {
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
      if (!active) return;
      setHandLandmarker(landmarker);
    };
    initMediaPipe();
    return () => {
      active = false;
      handLandmarker?.close();
    };
  }, []);

  // Start Webcam
  useEffect(() => {
    if (!videoRef.current) return;
    let currentStream: MediaStream | null = null;
    
    navigator.mediaDevices
      .getUserMedia({ video: { width: 640, height: 480, frameRate: { ideal: 60, min: 30 } } })
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
        setCameraError(null);
      })
      .catch((err) => {
        console.error('Error accessing webcam:', err);
        setCameraError(err.message || 'Permission denied');
      });
      
    return () => {
      if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Game Loop
  useEffect(() => {
    if (!handLandmarker || !videoRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastVideoTime = -1;

    const loop = (time: number) => {
      // Resize canvas to match window
      if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Spawn objects
      if (gameState === 'playing' && time - lastSpawnTimeRef.current > SPAWN_RATE) {
        const isTrash = Math.random() > 0.3;
        const emojiList = isTrash ? TRASH_EMOJIS : SATELLITE_EMOJIS;
        const emoji = emojiList[Math.floor(Math.random() * emojiList.length)];
        objectsRef.current.push({
          id: nextIdRef.current++,
          type: isTrash ? 'trash' : 'satellite',
          emoji,
          x: Math.random() * (canvas.width - 100) + 50,
          y: -50,
          vx: 0,
          vy: FALL_SPEED + Math.random() * 2,
          isGrabbed: false,
          grabbedByHandIndex: null,
          isRegretting: false,
        });
        lastSpawnTimeRef.current = time;
      }

      if (gameState !== 'playing') {
        objectsRef.current = [];
        if (comboRef.current > 0 || feverModeRef.current) {
          comboRef.current = 0;
          feverModeRef.current = false;
          feverEndTimeRef.current = 0;
          onComboChange(0, false);
        }
      }

      // Process Hand Landmarks
      let hands: { x: number; y: number; isPinching: boolean; index: number }[] = [];
      if (videoRef.current && videoRef.current.videoWidth > 0 && videoRef.current.videoHeight > 0) {
        if (videoRef.current.currentTime !== lastVideoTime) {
          lastVideoTime = videoRef.current.currentTime;
          const results = handLandmarker.detectForVideo(videoRef.current, performance.now());
          
          if (results.landmarks) {
          results.landmarks.forEach((landmarks, index) => {
            // Draw hand
            const colors = ['rgba(0, 255, 255, 0.5)', 'rgba(255, 0, 255, 0.5)'];
            const strokeColors = ['rgba(0, 255, 255, 0.8)', 'rgba(255, 0, 255, 0.8)'];
            ctx.fillStyle = colors[index % 2];
            ctx.strokeStyle = strokeColors[index % 2];
            ctx.lineWidth = 2;

            // Map landmarks to screen
            const mappedLandmarks = landmarks.map((l) => ({
              x: (1 - l.x) * canvas.width, // Mirror
              y: l.y * canvas.height,
            }));

            // Draw connections (simplified)
            ctx.beginPath();
            mappedLandmarks.forEach((l, i) => {
              if (i === 0) ctx.moveTo(l.x, l.y);
              else ctx.lineTo(l.x, l.y);
              ctx.fillRect(l.x - 2, l.y - 2, 4, 4);
            });
            ctx.stroke();

            // Check pinch (Thumb tip = 4, Index tip = 8)
            const thumb = mappedLandmarks[4];
            const indexFinger = mappedLandmarks[8];
            const dist = Math.hypot(thumb.x - indexFinger.x, thumb.y - indexFinger.y);
            const isPinching = dist < PINCH_THRESHOLD;

            if (isPinching) {
              console.log('Đang gắp!');
            }

            const pinchCenter = {
              x: (thumb.x + indexFinger.x) / 2,
              y: (thumb.y + indexFinger.y) / 2,
            };

            // Draw pinch indicator
            if (isPinching) {
              ctx.beginPath();
              ctx.arc(pinchCenter.x, pinchCenter.y, 15, 0, 2 * Math.PI);
              ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
              ctx.fill();
            }

            hands.push({
              x: pinchCenter.x,
              y: pinchCenter.y,
              isPinching,
              index,
            });
          });
        }
      }
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

      const isFever = time < feverEndTimeRef.current;
      if (isFever !== feverModeRef.current) {
        feverModeRef.current = isFever;
        if (!isFever) {
          comboRef.current = 0;
          onComboChange(0, false);
        } else {
          onComboChange(MAX_COMBO, true);
        }
      }

      // Update Objects
      for (let i = objectsRef.current.length - 1; i >= 0; i--) {
        const obj = objectsRef.current[i];

        if (isFever) {
          obj.isGrabbed = false;
          obj.grabbedByHandIndex = null;

          const dx = reactorCenterX - obj.x;
          const dy = reactorCenterY - obj.y;
          const dist = Math.hypot(dx, dy);
          
          let pushed = false;
          for (const hand of hands) {
            const distToHand = Math.hypot(obj.x - hand.x, obj.y - hand.y);
            if (distToHand < 200) {
              if (dist > 0) {
                obj.x += (dx / dist) * 30;
                obj.y += (dy / dist) * 30;
                pushed = true;
              }
            }
          }

          if (!pushed && dist > 0) {
            obj.x += (dx / dist) * 5;
            obj.y += (dy / dist) * 5;
          }

          if (dist < 50) {
            onScoreChange(obj.type === 'trash' ? 10 : -10);
            objectsRef.current.splice(i, 1);
            continue;
          }
        } else {
          // Check Grabbing
          if (obj.isGrabbed) {
            const grabbingHand = hands.find((h) => h.index === obj.grabbedByHandIndex);
            if (grabbingHand && grabbingHand.isPinching) {
              // Follow hand
              obj.x = grabbingHand.x;
              obj.y = grabbingHand.y;
            } else {
              // Release
              obj.isGrabbed = false;
              obj.grabbedByHandIndex = null;
              
              // Check if dropped in reactor
              if (
                obj.x > reactorBounds.left &&
                obj.x < reactorBounds.right &&
                obj.y > reactorBounds.top &&
                obj.y < reactorBounds.bottom
              ) {
                // Scored!
                onScoreChange(obj.type === 'trash' ? 10 : -10);
                if (obj.type === 'trash') {
                  comboRef.current = Math.min(comboRef.current + 1, MAX_COMBO);
                  if (comboRef.current >= MAX_COMBO) {
                    feverEndTimeRef.current = time + FEVER_DURATION;
                    feverModeRef.current = true;
                    onComboChange(MAX_COMBO, true);
                  } else {
                    onComboChange(comboRef.current, false);
                  }
                } else {
                  comboRef.current = 0;
                  onComboChange(0, false);
                }
                objectsRef.current.splice(i, 1);
                continue;
              }
            }
          } else {
            // Fall
            obj.x += obj.vx;
            obj.y += obj.vy;

            if (obj.isRegretting) {
              obj.vy += 0.05; // Gravity
            } else {
              // Check regret
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

            // Try to grab
            for (const hand of hands) {
              if (hand.isPinching) {
                const dist = Math.hypot(obj.x - hand.x, obj.y - hand.y);
                if (dist < GRAB_RADIUS) {
                  // Check if hand is already grabbing something
                  const handAlreadyGrabbing = objectsRef.current.some(o => o.isGrabbed && o.grabbedByHandIndex === hand.index);
                  if (!handAlreadyGrabbing) {
                    obj.isGrabbed = true;
                    obj.grabbedByHandIndex = hand.index;
                    obj.isRegretting = false;
                    obj.vx = 0;
                    break;
                  }
                }
              }
            }
          }
        }

        // Remove if off screen
        if (obj.y > canvas.height + 50 || obj.x < -50 || obj.x > canvas.width + 50) {
          objectsRef.current.splice(i, 1);
          continue;
        }

        // Draw Object
        ctx.font = '50px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(obj.emoji, obj.x, obj.y);
      }

      requestRef.current = requestAnimationFrame(loop);
    };

    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, [handLandmarker, onScoreChange, reactorRef, gameState]);

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
    </>
  );
}

export default function App() {
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [isFever, setIsFever] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [gameState, setGameState] = useState<'menu' | 'playing' | 'gameover'>('menu');
  const [gameDuration, setGameDuration] = useState<number>(5);
  const [timeRemaining, setTimeRemaining] = useState<number>(0);
  const [player1Name, setPlayer1Name] = useState('');
  const [player2Name, setPlayer2Name] = useState('');
  const [leaderboard, setLeaderboard] = useState<{name: string, score: number}[]>([]);
  const reactorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (gameState === 'playing') {
      const timer = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            setGameState('gameover');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    } else if (gameState === 'gameover') {
      // Add to leaderboard when game is over
      if (score > 0 && (player1Name.trim() !== '' || player2Name.trim() !== '')) {
        setLeaderboard(prev => {
          const name = player1Name.trim() || player2Name.trim() || 'UNKNOWN';
          const newLb = [...prev, { name, score }];
          // Sort descending and keep top 5
          return newLb.sort((a, b) => b.score - a.score).slice(0, 5);
        });
      }
    }
  }, [gameState, score, player1Name, player2Name]);

  const startGame = () => {
    setScore(0);
    setCombo(0);
    setIsFever(false);
    setTimeRemaining(gameDuration * 60);
    setGameState('playing');
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const handleScoreChange = useCallback((delta: number) => {
    setScore((prev) => prev + delta);
  }, []);

  const handleComboChange = useCallback((newCombo: number, fever: boolean) => {
    setCombo(newCombo);
    setIsFever(fever);
  }, []);

  return (
    <div className="bg-background text-on-surface font-body overflow-hidden select-none min-h-screen">
      <GameCanvas onScoreChange={handleScoreChange} onComboChange={handleComboChange} reactorRef={reactorRef} gameState={gameState} />

      {/* AR Background Layer */}
      <div className="fixed inset-0 z-0 bg-black overflow-hidden">
        {/* Background with Brighter Image */}
        <div className="absolute inset-0 z-5 nebula-glow pointer-events-none">
          <img
            alt="Deep space starfield"
            className="w-full h-full object-cover scale-105"
            src="https://images.unsplash.com/photo-1506318137071-a8e063b4bec0?q=80&w=2070&auto=format&fit=crop"
          />
        </div>
        {/* Darkened Overlay */}
        <div className="absolute inset-0 z-6 bg-black/70 pointer-events-none"></div>
        {/* Atmospheric Overlays */}
        <div className="absolute top-0 right-0 w-[1000px] h-[1000px] bg-tertiary/15 blur-[250px] -translate-y-1/3 translate-x-1/3 rounded-full"></div>
        <div className="absolute bottom-0 left-0 w-[800px] h-[800px] bg-secondary/15 blur-[200px] translate-y-1/3 -translate-x-1/4 rounded-full"></div>
      </div>

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
            <span className="text-white/50 text-xs">VS</span>
            <input 
              type="text" 
              value={player2Name}
              onChange={(e) => setPlayer2Name(e.target.value)}
              placeholder="PLAYER 2 NAME" 
              className="bg-black/50 border border-white/20 rounded px-3 py-1 text-xs text-white focus:outline-none focus:border-secondary pointer-events-auto"
            />
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
          <>
            <div className="absolute top-24 left-4 md:left-8 z-30 pointer-events-auto">
              {/* Galactic Score */}
              <div
                className="glass-panel neon-border-primary px-5 py-3 rounded-xl relative overflow-hidden group min-w-[200px] flex items-center gap-5 shadow-[0_0_20px_rgba(255,20,147,0.2)]"
                style={{ boxShadow: '0 0 20px rgba(255, 0, 0, 0.2)' }}
              >
                <div className="absolute -top-6 -right-6 w-16 h-16 bg-primary/20 blur-2xl rounded-full"></div>
                <div className="flex flex-col">
                  <div className="text-[8px] font-headline tracking-[0.15rem] text-primary font-black mb-1 uppercase">
                    GALACTIC SCORE
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-headline font-black text-white glow-primary tracking-tighter animate-score">
                      {score.toLocaleString()}
                    </span>
                    <span className="text-primary font-bold text-[8px]">XP</span>
                  </div>
                  <div className="mt-2 h-1 w-24 bg-white/10 rounded-full relative overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-r from-primary via-white to-primary animate-pulse w-3/4 shadow-[0_0_8px_#FF0000]"></div>
                  </div>
                </div>
              </div>

              {/* Combo Meter */}
              <div className="mt-4 glass-panel px-5 py-3 rounded-xl shadow-[0_0_15px_rgba(0,0,0,0.5)]">
                <div className="flex justify-between text-[10px] font-headline text-white/70 font-bold mb-2 uppercase tracking-widest">
                  <span>COMBO METER</span>
                  {isFever ? <span className="text-[#FF00FF] animate-pulse font-black drop-shadow-[0_0_5px_#FF00FF]">FEVER MODE!</span> : <span>{combo}/20</span>}
                </div>
                <div className="h-2 w-full bg-white/10 rounded-full relative overflow-hidden">
                  <div 
                    className={`absolute inset-y-0 left-0 transition-all duration-300 ${isFever ? 'bg-gradient-to-r from-[#FF00FF] to-[#00FFFF] animate-pulse w-full' : 'bg-secondary'}`}
                    style={{ width: isFever ? '100%' : `${(combo / 20) * 100}%` }}
                  ></div>
                </div>
              </div>
            </div>

            <div className="absolute top-24 right-4 md:right-8 z-30 pointer-events-auto">
              <div className="glass-panel neon-border-secondary px-5 py-3 rounded-xl relative overflow-hidden group min-w-[150px] flex flex-col items-center shadow-[0_0_20px_rgba(0,185,209,0.2)]">
                <div className="text-[8px] font-headline tracking-[0.15rem] text-secondary font-black mb-1 uppercase">
                  TIME REMAINING
                </div>
                <div className="text-2xl font-headline font-black text-white glow-secondary tracking-tighter">
                  {formatTime(timeRemaining)}
                </div>
              </div>
            </div>
          </>
        )}

        {/* Central Game Entry & Reactor Section */}
        <div className="flex-grow flex flex-col items-center justify-center pt-20">
          {/* MAG-BOTTLE REACTOR */}
          <div
            ref={reactorRef}
            className="relative w-96 h-96 flex items-center justify-center pointer-events-auto"
          >
            {isFever ? (
              <div className="absolute inset-0 bg-black rounded-full shadow-[0_0_150px_#FF00FF] animate-pulse flex items-center justify-center overflow-hidden">
                <div className="absolute inset-0 bg-[radial-gradient(circle,rgba(255,0,255,0.8)_0%,rgba(0,0,0,1)_70%)] animate-spin" style={{ animationDuration: '3s' }}></div>
                <div className="w-full h-full rounded-full border-8 border-[#00FFFF] border-dashed animate-spin" style={{ animationDuration: '2s', animationDirection: 'reverse' }}></div>
                <div className="absolute w-20 h-20 bg-black rounded-full shadow-[0_0_50px_#000]"></div>
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
                <div className="relative w-56 h-56 flex items-center justify-center">
                  <div className="absolute inset-0 bg-orange-600/30 blur-[60px] rounded-full animate-pulse"></div>
                  <div
                    className="absolute inset-0 bg-orange-500/20 blur-[70px] rounded-full animate-pulse"
                    style={{ animationDelay: '1.5s' }}
                  ></div>
                  <div className="absolute inset-0 bg-gradient-to-br from-[#FF4500] via-[#FF8C00] to-red-600 plasma-pulse-vibrant rounded-2xl"></div>
                  <div className="absolute inset-3 border-2 border-white/20 rotate-45 rounded-xl mix-blend-overlay"></div>
                  <div className="w-20 h-20 bg-white/60 rounded-full blur-2xl animate-pulse"></div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm pointer-events-auto">
          <div className="glass-panel border-primary/30 w-full max-w-md rounded-2xl overflow-hidden shadow-[0_0_50px_rgba(255,0,0,0.2)] p-8 flex flex-col items-center gap-6">
            <div className="text-center">
              <h2 className="font-headline text-white text-3xl font-black tracking-[0.4rem] uppercase glow-primary mb-2">
                NEW GAME
              </h2>
              <p className="font-body text-white/60 text-[10px] uppercase font-bold tracking-widest">
                SELECT MISSION DURATION
              </p>
            </div>
            
            <div className="flex gap-4 w-full">
              <button 
                onClick={() => setGameDuration(5)}
                className={`flex-1 py-4 rounded-xl border-2 transition-all font-headline font-black tracking-widest text-sm uppercase ${gameDuration === 5 ? 'bg-primary/20 border-primary text-white shadow-[0_0_20px_rgba(255,0,0,0.3)]' : 'bg-black/60 border-white/20 text-white/50 hover:border-white/50'}`}
              >
                5 MIN
              </button>
              <button 
                onClick={() => setGameDuration(10)}
                className={`flex-1 py-4 rounded-xl border-2 transition-all font-headline font-black tracking-widest text-sm uppercase ${gameDuration === 10 ? 'bg-primary/20 border-primary text-white shadow-[0_0_20px_rgba(255,0,0,0.3)]' : 'bg-black/60 border-white/20 text-white/50 hover:border-white/50'}`}
              >
                10 MIN
              </button>
            </div>

            <button 
              onClick={startGame}
              className="group relative w-full h-14 rounded-xl overflow-hidden transition-all active:scale-95 shadow-[0_10px_30px_rgba(255,0,0,0.4)]"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-[#FF0000] to-[#FF4444] group-hover:from-[#FF4444] group-hover:to-[#FF0000] transition-all duration-300"></div>
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20"></div>
              <span className="relative flex items-center justify-center gap-3 text-white font-headline font-black tracking-[0.2em] text-base uppercase">
                START MISSION
                <Zap className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
              </span>
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
                MISSION OVER
              </h2>
              <p className="font-body text-white/60 text-[12px] uppercase font-bold tracking-widest">
                FINAL SCORE: <span className="text-white text-lg">{score.toLocaleString()} XP</span>
              </p>
            </div>
            
            <button 
              onClick={() => setGameState('menu')}
              className="group relative w-full h-14 rounded-xl overflow-hidden transition-all active:scale-95 shadow-[0_10px_30px_rgba(0,185,209,0.4)]"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-secondary to-blue-500 group-hover:from-blue-500 group-hover:to-secondary transition-all duration-300"></div>
              <span className="relative flex items-center justify-center gap-3 text-white font-headline font-black tracking-[0.2em] text-base uppercase">
                RETURN TO MENU
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
            NEW GAME
          </span>
        </div>
        <div 
          className="flex flex-col items-center justify-center text-white/70 p-2 active:scale-90 transition-all pointer-events-auto"
          onClick={() => setShowLeaderboard(true)}
        >
          <Trophy className="w-5 h-5" />
          <span className="font-headline text-[8px] font-bold tracking-widest mt-0.5 uppercase">
            LEADERS
          </span>
        </div>
        <div
          className="flex flex-col items-center justify-center bg-primary text-on-primary px-6 py-1.5 rounded-lg active:scale-95 transition-all shadow-[0_0_15px_#d67779] pointer-events-auto"
          style={{ boxShadow: '0 0 15px #FF0000' }}
          onClick={startGame}
        >
          <Play className="w-5 h-5" />
          <span className="font-headline text-[8px] font-bold tracking-widest mt-0.5 uppercase">
            START
          </span>
        </div>
      </footer>

      {/* Leaderboard Modal */}
      {showLeaderboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-auto">
          <div className="glass-panel p-8 rounded-2xl border border-white/20 w-full max-w-md shadow-[0_0_30px_rgba(0,185,209,0.3)]">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-headline font-black text-white glow-primary tracking-widest uppercase">LEADERBOARD</h2>
              <button onClick={() => setShowLeaderboard(false)} className="text-white/50 hover:text-white">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              {leaderboard.length === 0 ? (
                <div className="text-center text-white/50 font-body py-8 uppercase tracking-widest">
                  NO ENTRIES YET. PLAY A GAME TO RANK UP!
                </div>
              ) : (
                leaderboard.map((entry, index) => {
                  let medal = '';
                  let borderColor = 'border-white/10';
                  let textColor = 'text-white/50';
                  
                  if (index === 0) { medal = '🥇'; borderColor = 'border-yellow-500/30'; textColor = 'text-yellow-500'; }
                  else if (index === 1) { medal = '🥈'; borderColor = 'border-gray-400/30'; textColor = 'text-gray-400'; }
                  else if (index === 2) { medal = '🥉'; borderColor = 'border-orange-500/30'; textColor = 'text-orange-500'; }

                  return (
                    <div key={index} className={`flex items-center justify-between bg-white/5 p-3 rounded-lg border ${borderColor}`}>
                      <div className="flex items-center gap-3">
                        {medal ? (
                          <span className="text-2xl">{medal}</span>
                        ) : (
                          <span className="text-lg font-bold text-white/50 w-8 text-center">{index + 1}</span>
                        )}
                        <span className="font-headline font-bold text-white uppercase">{entry.name}</span>
                      </div>
                      <span className={`font-mono font-bold ${textColor}`}>{entry.score.toLocaleString()} XP</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
