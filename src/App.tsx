import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "./utils/cn";

type Player = "human" | "ai";
type EdgeType = "h" | "v";
type Difficulty = "novice" | "tactique" | "expert";

type EdgeOwner = Player | null;

type BoxCoord = [number, number];

interface Move {
  type: EdgeType;
  r: number;
  c: number;
}

interface Level {
  id: number;
  nom: string;
  icone: string;
  rows: number;
  cols: number;
  difficulte: Difficulty;
  reflexionMs: number;
  description: string;
  ambiance: string;
}

interface GameState {
  rows: number;
  cols: number;
  h: EdgeOwner[][];
  v: EdgeOwner[][];
  boxes: EdgeOwner[][];
  scores: Record<Player, number>;
  currentPlayer: Player;
  gameOver: boolean;
  lastMove: Move | null;
  lastClaimed: BoxCoord[];
  moveCount: number;
}

interface AudioEngine {
  context: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  ambientTimer: number | null;
  progressionIndex: number;
}

const STORAGE = {
  selectedLevel: "hylst-dots-selected-level",
  unlockedLevel: "hylst-dots-unlocked-level",
  audioEnabled: "hylst-dots-audio-enabled",
};

const LEVELS: Level[] = [
  {
    id: 1,
    nom: "Aube cristalline",
    icone: "✦",
    rows: 3,
    cols: 3,
    difficulte: "novice",
    reflexionMs: 760,
    description: "Un plateau compact pour apprendre à préparer puis fermer les cases.",
    ambiance: "Calme et accessible, idéal pour lancer la campagne.",
  },
  {
    id: 2,
    nom: "Brume orbitale",
    icone: "☾",
    rows: 4,
    cols: 4,
    difficulte: "novice",
    reflexionMs: 680,
    description: "Plus d'espace, davantage de lignes sûres, mais déjà quelques pièges.",
    ambiance: "L'IA commence à mieux défendre ses territoires.",
  },
  {
    id: 3,
    nom: "Relais stellaire",
    icone: "⚡",
    rows: 5,
    cols: 5,
    difficulte: "tactique",
    reflexionMs: 580,
    description: "Les chaînes de captures deviennent importantes : anticipez chaque ouverture.",
    ambiance: "Une vraie partie tactique où les fins de tours comptent.",
  },
  {
    id: 4,
    nom: "Temple du vide",
    icone: "◆",
    rows: 5,
    cols: 5,
    difficulte: "expert",
    reflexionMs: 500,
    description: "Même taille, mais une IA plus agressive et plus lucide sur les enchaînements.",
    ambiance: "Le moindre cadeau offert à l'IA peut coûter très cher.",
  },
  {
    id: 5,
    nom: "Atlas photonique",
    icone: "☀",
    rows: 6,
    cols: 6,
    difficulte: "expert",
    reflexionMs: 450,
    description: "Le champ de bataille s'étend, les territoires prennent de l'ampleur.",
    ambiance: "Vision d'ensemble et patience deviennent essentielles.",
  },
  {
    id: 6,
    nom: "Couronne quantique",
    icone: "✹",
    rows: 7,
    cols: 7,
    difficulte: "expert",
    reflexionMs: 420,
    description: "Le défi final : grand plateau, rythme soutenu, erreurs sévèrement punies.",
    ambiance: "Une finale exigeante pour maîtriser totalement le jeu.",
  },
];

const PLAYER_META: Record<
  Player,
  {
    nom: string;
    accent: string;
    accentBg: string;
    surface: string;
    line: string;
    glow: string;
    territoryFill: string;
    territoryStroke: string;
    badge: string;
    short: string;
  }
> = {
  human: {
    nom: "Vous",
    accent: "text-cyan-200",
    accentBg: "from-cyan-500/25 to-sky-500/10",
    surface: "border-cyan-400/30 bg-cyan-500/10",
    line: "#63e6ff",
    glow: "rgba(99, 230, 255, 0.65)",
    territoryFill: "url(#territoryHuman)",
    territoryStroke: "rgba(125, 211, 252, 0.85)",
    badge: "bg-cyan-400 text-slate-950",
    short: "V",
  },
  ai: {
    nom: "IA",
    accent: "text-rose-200",
    accentBg: "from-rose-500/25 to-fuchsia-500/10",
    surface: "border-rose-400/30 bg-rose-500/10",
    line: "#ff7ab6",
    glow: "rgba(255, 122, 182, 0.65)",
    territoryFill: "url(#territoryAI)",
    territoryStroke: "rgba(253, 164, 175, 0.85)",
    badge: "bg-rose-400 text-slate-950",
    short: "IA",
  },
};

function readStoredNumber(key: string, fallback: number) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "true";
  } catch {
    return fallback;
  }
}

function getLevel(levelId: number) {
  return LEVELS.find((level) => level.id === levelId) ?? LEVELS[0];
}

function createGame(level: Level): GameState {
  return {
    rows: level.rows,
    cols: level.cols,
    h: Array.from({ length: level.rows + 1 }, () => Array(level.cols).fill(null)),
    v: Array.from({ length: level.rows }, () => Array(level.cols + 1).fill(null)),
    boxes: Array.from({ length: level.rows }, () => Array(level.cols).fill(null)),
    scores: { human: 0, ai: 0 },
    currentPlayer: "human",
    gameOver: false,
    lastMove: null,
    lastClaimed: [],
    moveCount: 0,
  };
}

function otherPlayer(player: Player): Player {
  return player === "human" ? "ai" : "human";
}

function cloneState(state: GameState): GameState {
  return {
    rows: state.rows,
    cols: state.cols,
    h: state.h.map((row) => [...row]),
    v: state.v.map((row) => [...row]),
    boxes: state.boxes.map((row) => [...row]),
    scores: { ...state.scores },
    currentPlayer: state.currentPlayer,
    gameOver: state.gameOver,
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    lastClaimed: state.lastClaimed.map(([r, c]) => [r, c]),
    moveCount: state.moveCount,
  };
}

function moveKey(type: EdgeType, r: number, c: number) {
  return `${type}-${r}-${c}`;
}

function sameMove(a: Move | null, b: Move | null) {
  return !!a && !!b && a.type === b.type && a.r === b.r && a.c === b.c;
}

function affectedBoxes(state: GameState, type: EdgeType, r: number, c: number): BoxCoord[] {
  const boxes: BoxCoord[] = [];

  if (type === "h") {
    if (r > 0) boxes.push([r - 1, c]);
    if (r < state.rows) boxes.push([r, c]);
  } else {
    if (c > 0) boxes.push([r, c - 1]);
    if (c < state.cols) boxes.push([r, c]);
  }

  return boxes;
}

function boxSideCount(state: GameState, r: number, c: number) {
  return (
    Number(Boolean(state.h[r][c])) +
    Number(Boolean(state.h[r + 1][c])) +
    Number(Boolean(state.v[r][c])) +
    Number(Boolean(state.v[r][c + 1]))
  );
}

function applyMove(prev: GameState, move: Move): GameState {
  if (prev.gameOver) return prev;

  const state = cloneState(prev);

  if (move.type === "h") {
    if (state.h[move.r][move.c]) return prev;
    state.h[move.r][move.c] = prev.currentPlayer;
  } else {
    if (state.v[move.r][move.c]) return prev;
    state.v[move.r][move.c] = prev.currentPlayer;
  }

  const claimed: BoxCoord[] = [];

  for (const [br, bc] of affectedBoxes(state, move.type, move.r, move.c)) {
    if (!state.boxes[br][bc] && boxSideCount(state, br, bc) === 4) {
      state.boxes[br][bc] = prev.currentPlayer;
      state.scores[prev.currentPlayer] += 1;
      claimed.push([br, bc]);
    }
  }

  state.lastMove = move;
  state.lastClaimed = claimed;
  state.moveCount = prev.moveCount + 1;

  if (claimed.length === 0) {
    state.currentPlayer = otherPlayer(prev.currentPlayer);
  }

  if (state.scores.human + state.scores.ai === state.rows * state.cols) {
    state.gameOver = true;
  }

  return state;
}

function allMoves(state: GameState): Move[] {
  const moves: Move[] = [];

  for (let r = 0; r <= state.rows; r += 1) {
    for (let c = 0; c < state.cols; c += 1) {
      if (!state.h[r][c]) moves.push({ type: "h", r, c });
    }
  }

  for (let r = 0; r < state.rows; r += 1) {
    for (let c = 0; c <= state.cols; c += 1) {
      if (!state.v[r][c]) moves.push({ type: "v", r, c });
    }
  }

  return moves;
}

function randomPick<T>(items: T[]) {
  return items[Math.floor(Math.random() * items.length)];
}

function immediateCaptureCount(state: GameState, move: Move) {
  return affectedBoxes(state, move.type, move.r, move.c).filter(
    ([br, bc]) => !state.boxes[br][bc] && boxSideCount(state, br, bc) === 3
  ).length;
}

function isSafeMove(state: GameState, move: Move) {
  return affectedBoxes(state, move.type, move.r, move.c).every(
    ([br, bc]) => state.boxes[br][bc] || boxSideCount(state, br, bc) <= 1
  );
}

function dangerCreated(state: GameState, move: Move) {
  return affectedBoxes(state, move.type, move.r, move.c).filter(
    ([br, bc]) => !state.boxes[br][bc] && boxSideCount(state, br, bc) === 2
  ).length;
}

function chooseBestCapture(state: GameState): Move | null {
  const captures = allMoves(state).map((move) => ({ move, value: immediateCaptureCount(state, move) }));
  const available = captures.filter((entry) => entry.value > 0);
  if (!available.length) return null;
  const best = Math.max(...available.map((entry) => entry.value));
  return randomPick(available.filter((entry) => entry.value === best)).move;
}

function estimateForcedCaptures(input: GameState) {
  const player = input.currentPlayer;
  let simulated = cloneState(input);
  let captured = 0;
  let guard = 0;

  while (!simulated.gameOver && simulated.currentPlayer === player && guard < 200) {
    const move = chooseBestCapture(simulated);
    if (!move) break;
    const before = simulated.scores[player];
    simulated = applyMove(simulated, move);
    captured += simulated.scores[player] - before;
    guard += 1;
  }

  return captured;
}

function chooseAIMove(state: GameState, difficulty: Difficulty) {
  const moves = allMoves(state);
  if (!moves.length) return null;

  const scored = moves.map((move) => {
    const captureNow = immediateCaptureCount(state, move);
    const safe = isSafeMove(state, move);
    const danger = dangerCreated(state, move);
    const next = applyMove(state, move);
    const aiGain = next.scores.ai - state.scores.ai;
    const centerBias = -(
      Math.abs(move.r - state.rows / 2) + Math.abs(move.c - state.cols / 2)
    );

    let score = 0;

    if (difficulty === "novice") {
      score = aiGain * 110 + captureNow * 45 + (safe ? 28 : 0) - danger * 18 + centerBias + Math.random() * 24;
    }

    if (difficulty === "tactique") {
      const opponentChain = next.currentPlayer === "human" ? estimateForcedCaptures(next) : 0;
      score =
        aiGain * 135 +
        captureNow * 40 +
        (safe ? 34 : 0) -
        danger * 16 -
        opponentChain * 72 +
        centerBias * 1.5 +
        Math.random() * 10;
    }

    if (difficulty === "expert") {
      const opponentChain = next.currentPlayer === "human" ? estimateForcedCaptures(next) : 0;
      const aiChain = next.currentPlayer === "ai" ? estimateForcedCaptures(next) : 0;
      score =
        aiGain * 180 +
        captureNow * 60 +
        aiChain * 68 +
        (safe ? 42 : 0) -
        danger * 20 -
        opponentChain * 110 +
        centerBias * 2 +
        Math.random() * 4;
    }

    return { move, score };
  });

  scored.sort((a, b) => b.score - a.score);

  if (difficulty === "novice") {
    return randomPick(scored.slice(0, Math.min(3, scored.length))).move;
  }

  if (difficulty === "tactique") {
    return randomPick(scored.slice(0, Math.min(2, scored.length))).move;
  }

  return scored[0].move;
}

function difficultyLabel(difficulte: Difficulty) {
  if (difficulte === "novice") return "Novice";
  if (difficulte === "tactique") return "Tactique";
  return "Expert";
}

function difficultyText(difficulte: Difficulty) {
  if (difficulte === "novice") return "IA prudente, erreurs occasionnelles.";
  if (difficulte === "tactique") return "IA qui évite mieux les cadeaux et lit les chaînes.";
  return "IA offensive, très attentive aux fins de partie.";
}

function midiToFrequency(midi: number) {
  return 440 * 2 ** ((midi - 69) / 12);
}

function scheduleTone(
  engine: AudioEngine,
  options: {
    freq: number;
    start: number;
    duration: number;
    volume: number;
    type?: OscillatorType;
    attack?: number;
    lowpass?: number;
    pan?: number;
    detune?: number;
    bus?: "music" | "sfx";
  }
) {
  const oscillatorA = engine.context.createOscillator();
  const oscillatorB = engine.context.createOscillator();
  const gain = engine.context.createGain();
  const filter = engine.context.createBiquadFilter();
  const panner = engine.context.createStereoPanner();
  const destination = options.bus === "music" ? engine.music : engine.sfx;
  const attack = options.attack ?? 0.02;
  const end = options.start + options.duration;

  oscillatorA.type = options.type ?? "triangle";
  oscillatorA.frequency.setValueAtTime(options.freq, options.start);
  oscillatorA.detune.setValueAtTime(options.detune ?? 0, options.start);

  oscillatorB.type = options.type ?? "triangle";
  oscillatorB.frequency.setValueAtTime(options.freq * 0.5, options.start);
  oscillatorB.detune.setValueAtTime((options.detune ?? 0) - 7, options.start);

  filter.type = "lowpass";
  filter.frequency.setValueAtTime(options.lowpass ?? 2400, options.start);
  filter.Q.value = 0.4;

  panner.pan.setValueAtTime(options.pan ?? 0, options.start);

  gain.gain.setValueAtTime(0.0001, options.start);
  gain.gain.linearRampToValueAtTime(options.volume, options.start + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  oscillatorA.connect(filter);
  oscillatorB.connect(filter);
  filter.connect(panner);
  panner.connect(gain);
  gain.connect(destination);

  oscillatorA.start(options.start);
  oscillatorB.start(options.start);
  oscillatorA.stop(end + 0.04);
  oscillatorB.stop(end + 0.04);

  oscillatorA.onended = () => {
    oscillatorA.disconnect();
    oscillatorB.disconnect();
    filter.disconnect();
    panner.disconnect();
    gain.disconnect();
  };
}

function startAmbient(engine: AudioEngine) {
  if (engine.ambientTimer !== null) return;

  const progression = [
    [45, 52, 57, 61],
    [43, 50, 55, 59],
    [47, 54, 57, 62],
    [40, 47, 52, 57],
  ];

  const emit = () => {
    const chord = progression[engine.progressionIndex % progression.length];
    const start = engine.context.currentTime + 0.04;

    chord.forEach((note, index) => {
      scheduleTone(engine, {
        freq: midiToFrequency(note),
        start: start + index * 0.12,
        duration: 2.3,
        volume: index === 0 ? 0.026 : 0.018,
        type: index === 0 ? "sine" : "triangle",
        attack: 0.18,
        lowpass: index === 0 ? 700 : 1800,
        pan: (index - 1.5) * 0.28,
        bus: "music",
      });
    });

    scheduleTone(engine, {
      freq: midiToFrequency(chord[2] + 12),
      start: start + 0.84,
      duration: 1.4,
      volume: 0.01,
      type: "sine",
      attack: 0.1,
      lowpass: 2200,
      pan: 0.2,
      bus: "music",
    });

    engine.progressionIndex += 1;
  };

  engine.music.gain.cancelScheduledValues(engine.context.currentTime);
  engine.music.gain.setTargetAtTime(0.12, engine.context.currentTime, 0.5);
  emit();
  engine.ambientTimer = window.setInterval(emit, 1700);
}

function stopAmbient(engine: AudioEngine) {
  if (engine.ambientTimer !== null) {
    window.clearInterval(engine.ambientTimer);
    engine.ambientTimer = null;
  }

  engine.music.gain.cancelScheduledValues(engine.context.currentTime);
  engine.music.gain.setTargetAtTime(0.0001, engine.context.currentTime, 0.25);
}

export default function App() {
  const initialUnlocked = Math.min(LEVELS.length, Math.max(1, readStoredNumber(STORAGE.unlockedLevel, 1)));
  const initialSelected = Math.min(initialUnlocked, Math.max(1, readStoredNumber(STORAGE.selectedLevel, 1)));
  const initialLevel = getLevel(initialSelected);

  const [selectedLevelId, setSelectedLevelId] = useState(initialSelected);
  const [unlockedLevelId, setUnlockedLevelId] = useState(initialUnlocked);
  const [game, setGame] = useState<GameState>(() => createGame(initialLevel));
  const [hoveredMoveKey, setHoveredMoveKey] = useState<string | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(() => readStoredBoolean(STORAGE.audioEnabled, true));
  const [audioReady, setAudioReady] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  const currentLevel = useMemo(() => getLevel(selectedLevelId), [selectedLevelId]);
  const gameRef = useRef(game);
  const appRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<AudioEngine | null>(null);
  const handledMoveCount = useRef(0);
  const gameOverHandled = useRef(false);

  const spacing = Math.max(76, 112 - game.rows * 5);
  const padding = 52;
  const dotRadius = Math.max(5, 9 - game.rows * 0.35);
  const lineWidth = Math.max(5, 9 - game.rows * 0.45);
  const hitWidth = Math.max(24, 34 - game.rows);
  const viewBoxWidth = game.cols * spacing + padding * 2;
  const viewBoxHeight = game.rows * spacing + padding * 2;

  const totalBoxes = game.rows * game.cols;
  const totalClaimed = game.scores.human + game.scores.ai;
  const remainingBoxes = totalBoxes - totalClaimed;
  const humanWon = game.gameOver && game.scores.human > game.scores.ai;
  const aiWon = game.gameOver && game.scores.ai > game.scores.human;
  const draw = game.gameOver && game.scores.human === game.scores.ai;
  const progress = totalBoxes === 0 ? 0 : (totalClaimed / totalBoxes) * 100;
  const canGoNextLevel = humanWon && selectedLevelId < LEVELS.length && unlockedLevelId >= selectedLevelId + 1;

  const availableMoves = useMemo(() => allMoves(game), [game]);

  const criticalBoxes = useMemo(() => {
    const result: BoxCoord[] = [];
    for (let r = 0; r < game.rows; r += 1) {
      for (let c = 0; c < game.cols; c += 1) {
        if (!game.boxes[r][c] && boxSideCount(game, r, c) === 3) {
          result.push([r, c]);
        }
      }
    }
    return result;
  }, [game]);

  const safeMovesCount = useMemo(
    () => availableMoves.filter((move) => isSafeMove(game, move)).length,
    [availableMoves, game]
  );

  const status = useMemo(() => {
    if (game.gameOver) {
      if (humanWon) {
        return {
          titre: "Niveau réussi !",
          texte: "Vous avez conquis plus de territoires que l'IA. Continuez votre ascension.",
          ton: "from-cyan-500/25 via-sky-400/10 to-transparent",
        };
      }

      if (aiWon) {
        return {
          titre: "Défaite tactique",
          texte: "L'IA a mieux exploité les chaînes. Rejouez ce niveau pour prendre votre revanche.",
          ton: "from-rose-500/25 via-fuchsia-400/10 to-transparent",
        };
      }

      return {
        titre: "Égalité parfaite",
        texte: "Aucun territoire n'a pris le dessus. Une nouvelle partie départagera ce duel.",
        ton: "from-violet-500/25 via-indigo-400/10 to-transparent",
      };
    }

    if (game.currentPlayer === "human") {
      if (criticalBoxes.length > 0) {
        return {
          titre: "Des cases sont prêtes !",
          texte: "Fermez-les avant de redonner la main : vous rejouerez immédiatement après capture.",
          ton: "from-amber-500/25 via-yellow-400/10 to-transparent",
        };
      }

      if (safeMovesCount > 0) {
        return {
          titre: "À vous de tracer",
          texte: "Repérez les lignes sûres pour préparer les chaînes favorables en fin de manche.",
          ton: "from-cyan-500/25 via-sky-400/10 to-transparent",
        };
      }

      return {
        titre: "Fin de partie tendue",
        texte: "Chaque coup ouvre une opportunité. Essayez de limiter la chaîne offerte à l'IA.",
        ton: "from-rose-500/25 via-fuchsia-400/10 to-transparent",
      };
    }

    return {
      titre: "L'IA calcule...",
      texte: "Elle évalue les captures immédiates, les lignes sûres et les chaînes à venir.",
      ton: "from-rose-500/25 via-fuchsia-400/10 to-transparent",
    };
  }, [aiWon, criticalBoxes.length, draw, game.currentPlayer, game.gameOver, humanWon, safeMovesCount]);

  useEffect(() => {
    gameRef.current = game;
  }, [game]);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE.selectedLevel, String(selectedLevelId));
      window.localStorage.setItem(STORAGE.unlockedLevel, String(unlockedLevelId));
      window.localStorage.setItem(STORAGE.audioEnabled, String(audioEnabled));
    } catch {
      // ignore storage issues
    }
  }, [audioEnabled, selectedLevelId, unlockedLevelId]);

  useEffect(() => {
    const handleFullscreen = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handleFullscreen);
    return () => document.removeEventListener("fullscreenchange", handleFullscreen);
  }, []);

  useEffect(() => {
    return () => {
      const engine = audioRef.current;
      if (!engine) return;
      stopAmbient(engine);
      void engine.context.close();
    };
  }, []);

  useEffect(() => {
    if (!audioEnabled) {
      const engine = audioRef.current;
      if (engine) stopAmbient(engine);
    }
  }, [audioEnabled]);

  useEffect(() => {
    if (game.currentPlayer !== "ai" || game.gameOver) return;

    let cancelled = false;

    const run = async () => {
      while (!cancelled && gameRef.current.currentPlayer === "ai" && !gameRef.current.gameOver) {
        const move = chooseAIMove(gameRef.current, currentLevel.difficulte);
        if (!move) break;

        await new Promise((resolve) => window.setTimeout(resolve, currentLevel.reflexionMs));
        if (cancelled) break;

        setGame((prev) => {
          if (prev.currentPlayer !== "ai" || prev.gameOver) return prev;
          const next = applyMove(prev, move);
          gameRef.current = next;
          return next;
        });
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [currentLevel, game.currentPlayer, game.gameOver]);

  useEffect(() => {
    if (game.moveCount === 0 || handledMoveCount.current === game.moveCount) return;
    handledMoveCount.current = game.moveCount;

    if (game.lastClaimed.length > 0) {
      playClaimSound(game.lastClaimed.length);
      return;
    }

    playDrawSound();
  }, [game.lastClaimed.length, game.moveCount]);

  useEffect(() => {
    if (game.gameOver && !gameOverHandled.current) {
      gameOverHandled.current = true;
      if (humanWon) {
        playVictorySound();
      } else if (aiWon) {
        playDefeatSound();
      } else {
        playDrawEndSound();
      }
    }

    if (!game.gameOver) {
      gameOverHandled.current = false;
    }
  }, [aiWon, game.gameOver, humanWon]);

  useEffect(() => {
    if (!humanWon) return;
    if (selectedLevelId >= LEVELS.length) return;
    if (unlockedLevelId >= selectedLevelId + 1) return;

    setUnlockedLevelId(selectedLevelId + 1);
    setAnnouncement(`Niveau débloqué : ${getLevel(selectedLevelId + 1).nom}`);
    playUnlockSound();
  }, [humanWon, selectedLevelId, unlockedLevelId]);

  useEffect(() => {
    if (!announcement) return;
    const timer = window.setTimeout(() => setAnnouncement(""), 2800);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  function ensureAudioEngine() {
    if (typeof window === "undefined") return null;
    if (audioRef.current) return audioRef.current;

    const AudioCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return null;

    const context = new AudioCtor();
    const master = context.createGain();
    const music = context.createGain();
    const sfx = context.createGain();

    master.gain.value = 0.72;
    music.gain.value = 0.0001;
    sfx.gain.value = 0.24;

    music.connect(master);
    sfx.connect(master);
    master.connect(context.destination);

    audioRef.current = {
      context,
      master,
      music,
      sfx,
      ambientTimer: null,
      progressionIndex: 0,
    };

    return audioRef.current;
  }

  async function activateAudio(force = false) {
    if (!force && !audioEnabled) return;

    const engine = ensureAudioEngine();
    if (!engine) return;

    if (engine.context.state === "suspended") {
      await engine.context.resume();
    }

    setAudioReady(true);

    if (audioEnabled) {
      startAmbient(engine);
    }
  }

  function playDrawSound() {
    const engine = audioRef.current;
    if (!engine || !audioEnabled || engine.context.state !== "running") return;

    const now = engine.context.currentTime + 0.01;
    scheduleTone(engine, {
      freq: 680,
      start: now,
      duration: 0.18,
      volume: 0.1,
      type: "triangle",
      attack: 0.01,
      lowpass: 2600,
      pan: -0.12,
      bus: "sfx",
    });
    scheduleTone(engine, {
      freq: 920,
      start: now + 0.04,
      duration: 0.12,
      volume: 0.05,
      type: "sine",
      attack: 0.01,
      lowpass: 3200,
      pan: 0.16,
      bus: "sfx",
    });
  }

  function playClaimSound(multiplier: number) {
    const engine = audioRef.current;
    if (!engine || !audioEnabled || engine.context.state !== "running") return;

    const base = engine.context.currentTime + 0.01;
    [740, 910, 1090, 1290].slice(0, Math.min(4, multiplier + 2)).forEach((freq, index) => {
      scheduleTone(engine, {
        freq,
        start: base + index * 0.06,
        duration: 0.24,
        volume: 0.12,
        type: "sine",
        attack: 0.01,
        lowpass: 3400,
        pan: -0.2 + index * 0.12,
        bus: "sfx",
      });
    });
  }

  function playVictorySound() {
    const engine = audioRef.current;
    if (!engine || !audioEnabled || engine.context.state !== "running") return;

    const base = engine.context.currentTime + 0.02;
    [660, 880, 990, 1320].forEach((freq, index) => {
      scheduleTone(engine, {
        freq,
        start: base + index * 0.09,
        duration: 0.4,
        volume: 0.14,
        type: "triangle",
        attack: 0.015,
        lowpass: 3600,
        pan: -0.3 + index * 0.18,
        bus: "sfx",
      });
    });
  }

  function playDefeatSound() {
    const engine = audioRef.current;
    if (!engine || !audioEnabled || engine.context.state !== "running") return;

    const base = engine.context.currentTime + 0.02;
    [520, 410, 320].forEach((freq, index) => {
      scheduleTone(engine, {
        freq,
        start: base + index * 0.08,
        duration: 0.34,
        volume: 0.12,
        type: "sawtooth",
        attack: 0.02,
        lowpass: 2200,
        pan: 0.12 - index * 0.1,
        bus: "sfx",
      });
    });
  }

  function playDrawEndSound() {
    const engine = audioRef.current;
    if (!engine || !audioEnabled || engine.context.state !== "running") return;

    const base = engine.context.currentTime + 0.02;
    [620, 780, 620].forEach((freq, index) => {
      scheduleTone(engine, {
        freq,
        start: base + index * 0.08,
        duration: 0.26,
        volume: 0.09,
        type: "triangle",
        attack: 0.02,
        lowpass: 2800,
        pan: index === 1 ? 0 : -0.1 + index * 0.14,
        bus: "sfx",
      });
    });
  }

  function playUnlockSound() {
    const engine = audioRef.current;
    if (!engine || !audioEnabled || engine.context.state !== "running") return;

    const base = engine.context.currentTime + 0.02;
    [880, 1108, 1320].forEach((freq, index) => {
      scheduleTone(engine, {
        freq,
        start: base + index * 0.05,
        duration: 0.22,
        volume: 0.12,
        type: "sine",
        attack: 0.01,
        lowpass: 3600,
        pan: -0.18 + index * 0.18,
        bus: "sfx",
      });
    });
  }

  function startLevel(levelId: number) {
    const level = getLevel(levelId);
    const next = createGame(level);
    setSelectedLevelId(level.id);
    setGame(next);
    gameRef.current = next;
    setHoveredMoveKey(null);
    handledMoveCount.current = 0;
    gameOverHandled.current = false;
  }

  function handleLevelSelect(levelId: number) {
    void activateAudio();

    if (levelId > unlockedLevelId) {
      setAnnouncement("Ce niveau est encore verrouillé. Gagnez le précédent pour l'ouvrir.");
      return;
    }

    startLevel(levelId);
  }

  function handleRestart() {
    void activateAudio();
    startLevel(selectedLevelId);
  }

  function handleNextLevel() {
    void activateAudio();
    if (selectedLevelId >= LEVELS.length) return;
    startLevel(Math.min(LEVELS.length, selectedLevelId + 1));
  }

  async function handleAudioToggle() {
    if (audioEnabled) {
      setAudioEnabled(false);
      const engine = audioRef.current;
      if (engine) stopAmbient(engine);
      return;
    }

    setAudioEnabled(true);
    await activateAudio(true);
    playUnlockSound();
  }

  async function handleFullscreenToggle() {
    void activateAudio();

    if (!document.fullscreenElement) {
      if (!appRef.current) return;
      try {
        await appRef.current.requestFullscreen();
      } catch {
        setAnnouncement("Le mode plein écran n'est pas disponible sur cet appareil.");
      }
      return;
    }

    try {
      await document.exitFullscreen();
    } catch {
      setAnnouncement("Impossible de quitter le plein écran pour le moment.");
    }
  }

  function handleEdgeClick(move: Move) {
    void activateAudio();

    if (game.gameOver || game.currentPlayer !== "human") return;

    setHoveredMoveKey(null);
    setGame((prev) => {
      const next = applyMove(prev, move);
      gameRef.current = next;
      return next;
    });
  }

  return (
    <div ref={appRef} className="app-cosmos min-h-screen overflow-hidden text-slate-100">
      <div className="orb orb-one" />
      <div className="orb orb-two" />
      <div className="orb orb-three" />
      <div className="noise-layer" />

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <header className="glass-card panel-shine rounded-[2rem] p-5 sm:p-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-center xl:justify-between">
            <div className="max-w-3xl space-y-4">
              <div className="info-pill w-fit">Campagne progressive · IA adaptative · audio spatial</div>
              <div>
                <h1 className="text-4xl font-black tracking-tight text-white sm:text-5xl lg:text-6xl">
                  Conquête de Cases
                </h1>
                <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
                  Une version premium de Dots and Boxes : tout est en français, les graphismes sont enrichis,
                  les animations sont plus vivantes, la musique d'ambiance est générée en direct et chaque niveau
                  augmente progressivement la difficulté.
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs sm:text-sm">
                <span className="rounded-full border border-white/15 bg-white/8 px-3 py-1.5 text-slate-200">
                  Créateur de l'app : Hylst - Geoffroy avec l'aide d'une IA
                </span>
                <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 text-cyan-100">
                  Territoires colorés et captures animées
                </span>
                <span className="rounded-full border border-violet-400/25 bg-violet-400/10 px-3 py-1.5 text-violet-100">
                  {audioEnabled
                    ? audioReady
                      ? "Musique active"
                      : "Touchez l'interface pour activer l'audio"
                    : "Audio désactivé"}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[320px]">
              <button onClick={handleRestart} className="energy-button">
                Rejouer le niveau
              </button>
              <button onClick={handleFullscreenToggle} className="energy-button secondary">
                {fullscreen ? "Quitter le plein écran" : "Mode plein écran"}
              </button>
              <button onClick={handleAudioToggle} className="energy-button secondary">
                {audioEnabled ? "Couper musique & SFX" : "Activer musique & SFX"}
              </button>
              <button
                onClick={canGoNextLevel ? handleNextLevel : () => handleLevelSelect(selectedLevelId)}
                className="energy-button secondary"
              >
                {canGoNextLevel ? "Niveau suivant" : "Relancer ce niveau"}
              </button>
              <button onClick={() => setShowInfo(true)} className="energy-button secondary">
                ℹ️ Comment ce jeu a été fait
              </button>
            </div>
          </div>
        </header>

        {showInfo && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setShowInfo(false)}>
            <div className="glass-card w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-[2rem] p-7 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <h3 className="text-2xl font-black text-white">Comment ce jeu a été fait</h3>
              <div className="mt-4 space-y-3.5 text-sm leading-relaxed text-slate-300">
                <p><strong className="text-white">Stack :</strong> React 19, TypeScript 5.9, Tailwind CSS 4, Vite 7, compilé en un seul fichier HTML, aucune dépendance chargée depuis l'extérieur.</p>
                <p><strong className="text-white">Graphismes :</strong> plateau et territoires en DOM/CSS avec dégradés et animations de capture, aucun Canvas.</p>
                <p><strong className="text-white">Musique &amp; sons :</strong> synthétisés en direct avec l'API Web Audio, aucun fichier audio chargé.</p>
                <p><strong className="text-white">Interactions :</strong> clic sur un trait entre deux points pour le tracer ; fermer le 4e côté d'une case la capture et rejoue immédiatement.</p>
                <p><strong className="text-white">Architecture :</strong> une campagne de niveaux progressifs, chacun avec sa propre taille de grille et son propre réglage de difficulté pour l'IA.</p>
                <p><strong className="text-white">Algorithmes notables :</strong> l'IA évalue chaque coup possible avec une fonction heuristique plutôt qu'une recherche exhaustive : elle estime le nombre de cases qu'un coup donnerait en chaîne à l'adversaire (plutôt que de lui offrir une case prête à capturer) et privilégie les coups qui limitent ce risque tout en maximisant ses propres captures en chaîne.</p>
              </div>
              <button onClick={() => setShowInfo(false)} className="energy-button mt-6 w-full">
                Fermer
              </button>
            </div>
          </div>
        )}

        {announcement && (
          <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-50 shadow-lg shadow-cyan-950/20 backdrop-blur-md">
            {announcement}
          </div>
        )}

        <section className="mt-6 grid gap-4 lg:grid-cols-3">
          {(["human", "ai"] as Player[]).map((player) => {
            const active = game.currentPlayer === player && !game.gameOver;
            const meta = PLAYER_META[player];

            return (
              <div
                key={player}
                className={cn(
                  "glass-card rounded-[1.75rem] p-5 transition-all duration-300",
                  meta.surface,
                  active && "player-card-active"
                )}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className={cn("text-xs font-semibold uppercase tracking-[0.3em]", meta.accent)}>
                      {meta.nom}
                    </div>
                    <div className="mt-2 text-5xl font-black text-white">{game.scores[player]}</div>
                  </div>
                  <div className={cn("rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.25em]", meta.badge)}>
                    {active ? "Tour" : "Score"}
                  </div>
                </div>
                <div className="mt-4 text-sm text-slate-300">
                  {player === "human"
                    ? "Fermez des cases pour enchaîner les tours et prendre l'avantage."
                    : difficultyText(currentLevel.difficulte)}
                </div>
              </div>
            );
          })}

          <div className="glass-card rounded-[1.75rem] p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-200">Niveau actuel</div>
                <div className="mt-2 text-2xl font-black text-white">
                  {currentLevel.icone} {currentLevel.nom}
                </div>
                <div className="mt-1 text-sm text-slate-300">{currentLevel.description}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/8 px-3 py-2 text-right text-xs text-slate-200">
                <div>{currentLevel.rows} × {currentLevel.cols}</div>
                <div>{difficultyLabel(currentLevel.difficulte)}</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
              <div className="rounded-2xl border border-white/10 bg-white/6 p-3">
                <div className="text-lg font-black text-white">{totalClaimed}</div>
                <div className="text-slate-400">cases prises</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/6 p-3">
                <div className="text-lg font-black text-white">{criticalBoxes.length}</div>
                <div className="text-slate-400">cases prêtes</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/6 p-3">
                <div className="text-lg font-black text-white">{safeMovesCount}</div>
                <div className="text-slate-400">lignes sûres</div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6 glass-card rounded-[2rem] p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300">Campagne</div>
              <h2 className="mt-2 text-2xl font-black text-white">Choisissez votre défi</h2>
            </div>
            <div className="rounded-full border border-white/10 bg-white/8 px-4 py-2 text-sm text-slate-200">
              Débloqués : {unlockedLevelId}/{LEVELS.length}
            </div>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {LEVELS.map((level) => {
              const locked = level.id > unlockedLevelId;
              const selected = level.id === selectedLevelId;

              return (
                <button
                  key={level.id}
                  onClick={() => handleLevelSelect(level.id)}
                  className={cn(
                    "level-card rounded-[1.5rem] border p-4 text-left transition-all duration-300",
                    locked
                      ? "cursor-not-allowed border-white/8 bg-white/4 text-slate-500"
                      : "cursor-pointer border-white/12 bg-white/6 text-slate-100 hover:-translate-y-1 hover:border-cyan-300/30 hover:bg-cyan-300/6",
                    selected && "level-card-active",
                    locked && "level-card-locked"
                  )}
                  disabled={locked}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-2xl">{level.icone}</div>
                      <div className="mt-2 text-lg font-black">{level.nom}</div>
                      <div className="mt-1 text-sm text-slate-300/90">
                        {level.rows} × {level.cols} · {difficultyLabel(level.difficulte)}
                      </div>
                    </div>
                    <div className="rounded-full border border-white/10 bg-white/8 px-3 py-1 text-[11px] uppercase tracking-[0.25em]">
                      {locked ? "Verrouillé" : selected ? "En jeu" : "Disponible"}
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300/80">{level.ambiance}</p>
                </button>
              );
            })}
          </div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_360px]">
          <section className="glass-card rounded-[2rem] p-4 sm:p-6">
            <div className={cn("rounded-[1.5rem] border border-white/10 bg-gradient-to-r p-4 sm:p-5", status.ton)}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-200">État de la partie</div>
                  <div className="mt-1 text-2xl font-black text-white">{status.titre}</div>
                </div>
                <div className="rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold text-slate-100">
                  {game.gameOver
                    ? `Score final : ${game.scores.human} - ${game.scores.ai}`
                    : game.currentPlayer === "human"
                      ? "Votre main"
                      : "Tour de l'IA"}
                </div>
              </div>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-200/90">{status.texte}</p>

              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between text-xs uppercase tracking-[0.25em] text-slate-300">
                  <span>Progression du plateau</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-white/10">
                  <div className="progress-glow h-full rounded-full" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-3 text-sm text-slate-300">
              <div className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-4 py-2">
                Vos territoires : {game.scores.human}
              </div>
              <div className="rounded-full border border-rose-300/20 bg-rose-400/10 px-4 py-2">
                Territoires IA : {game.scores.ai}
              </div>
              <div className="rounded-full border border-amber-300/20 bg-amber-400/10 px-4 py-2">
                Cases en tension : {criticalBoxes.length}
              </div>
            </div>

            <div className="board-frame mt-5 overflow-hidden rounded-[2rem] p-3 sm:p-5">
              <svg
                role="img"
                aria-label="Plateau de Conquête de Cases"
                viewBox={`${-padding} ${-padding} ${viewBoxWidth} ${viewBoxHeight}`}
                className="board-svg mx-auto h-auto w-full select-none"
                style={{ maxHeight: fullscreen ? "84vh" : "70vh" }}
              >
                <defs>
                  <linearGradient id="boardBackdrop" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#081120" />
                    <stop offset="45%" stopColor="#0f1f3b" />
                    <stop offset="100%" stopColor="#120f29" />
                  </linearGradient>
                  <linearGradient id="territoryHuman" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(56, 189, 248, 0.38)" />
                    <stop offset="100%" stopColor="rgba(34, 211, 238, 0.16)" />
                  </linearGradient>
                  <linearGradient id="territoryAI" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="rgba(251, 113, 133, 0.38)" />
                    <stop offset="100%" stopColor="rgba(217, 70, 239, 0.16)" />
                  </linearGradient>
                  <radialGradient id="dotGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="100%" stopColor="#b9c6ff" stopOpacity="0.08" />
                  </radialGradient>
                </defs>

                <rect
                  x={-padding + 8}
                  y={-padding + 8}
                  width={viewBoxWidth - 16}
                  height={viewBoxHeight - 16}
                  rx={28}
                  fill="url(#boardBackdrop)"
                  stroke="rgba(255,255,255,0.08)"
                />

                {game.boxes.map((row, r) =>
                  row.map((owner, c) => {
                    if (!owner) return null;
                    const fresh = game.lastClaimed.some(([br, bc]) => br === r && bc === c);
                    const meta = PLAYER_META[owner];
                    return (
                      <g key={`box-${r}-${c}`} className={fresh ? "box-claim" : undefined}>
                        <rect
                          x={c * spacing + 8}
                          y={r * spacing + 8}
                          width={spacing - 16}
                          height={spacing - 16}
                          rx={18}
                          fill={meta.territoryFill}
                          stroke={meta.territoryStroke}
                          strokeWidth={2.5}
                        />
                        <text
                          x={c * spacing + spacing / 2}
                          y={r * spacing + spacing / 2 + 1}
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fill="rgba(255,255,255,0.8)"
                          fontSize={Math.max(18, spacing * 0.26)}
                          fontWeight={900}
                        >
                          {meta.short}
                        </text>
                      </g>
                    );
                  })
                )}

                {criticalBoxes.map(([r, c]) => (
                  <g key={`danger-${r}-${c}`} className="danger-pulse">
                    <rect
                      x={c * spacing + 14}
                      y={r * spacing + 14}
                      width={spacing - 28}
                      height={spacing - 28}
                      rx={16}
                      fill="rgba(250, 204, 21, 0.07)"
                      stroke="rgba(250, 204, 21, 0.8)"
                      strokeDasharray="10 8"
                      strokeWidth={2.5}
                    />
                  </g>
                ))}

                {Array.from({ length: game.rows + 1 }, (_, r) =>
                  Array.from({ length: game.cols }, (_, c) => {
                    const owner = game.h[r][c];
                    const x1 = c * spacing;
                    const x2 = (c + 1) * spacing;
                    const y = r * spacing;
                    const key = moveKey("h", r, c);
                    const hovered = hoveredMoveKey === key && !owner && game.currentPlayer === "human" && !game.gameOver;
                    const last = sameMove(game.lastMove, { type: "h", r, c });

                    return (
                      <g key={key}>
                        {hovered && (
                          <line
                            x1={x1}
                            y1={y}
                            x2={x2}
                            y2={y}
                            stroke={PLAYER_META.human.line}
                            strokeOpacity={0.48}
                            strokeWidth={lineWidth + 2}
                            strokeLinecap="round"
                            strokeDasharray={`${spacing * 0.18} ${spacing * 0.1}`}
                            pointerEvents="none"
                          />
                        )}

                        {owner && (
                          <g className={last ? "edge-drawn" : undefined}>
                            <line
                              x1={x1}
                              y1={y}
                              x2={x2}
                              y2={y}
                              stroke={PLAYER_META[owner].glow}
                              strokeWidth={lineWidth + 10}
                              strokeLinecap="round"
                            />
                            <line
                              x1={x1}
                              y1={y}
                              x2={x2}
                              y2={y}
                              stroke={PLAYER_META[owner].line}
                              strokeWidth={lineWidth}
                              strokeLinecap="round"
                            />
                            <line
                              x1={x1}
                              y1={y}
                              x2={x2}
                              y2={y}
                              stroke="rgba(255,255,255,0.35)"
                              strokeWidth={1.4}
                              strokeLinecap="round"
                            />
                          </g>
                        )}

                        {!owner && (
                          <line
                            x1={x1}
                            y1={y}
                            x2={x2}
                            y2={y}
                            role="button"
                            tabIndex={game.currentPlayer === "human" && !game.gameOver ? 0 : -1}
                            aria-label={`Tracer la ligne horizontale ${r + 1}, ${c + 1}`}
                            onClick={() => handleEdgeClick({ type: "h", r, c })}
                            onMouseEnter={() => setHoveredMoveKey(key)}
                            onMouseLeave={() => setHoveredMoveKey(null)}
                            onFocus={() => setHoveredMoveKey(key)}
                            onBlur={() => setHoveredMoveKey(null)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleEdgeClick({ type: "h", r, c });
                              }
                            }}
                            className={cn(
                              "transition-colors focus:outline-none",
                              game.currentPlayer === "human" && !game.gameOver ? "cursor-pointer" : "cursor-default"
                            )}
                            stroke={hovered ? "rgba(99, 230, 255, 0.18)" : "transparent"}
                            strokeWidth={hitWidth}
                            strokeLinecap="round"
                          />
                        )}
                      </g>
                    );
                  })
                )}

                {Array.from({ length: game.rows }, (_, r) =>
                  Array.from({ length: game.cols + 1 }, (_, c) => {
                    const owner = game.v[r][c];
                    const y1 = r * spacing;
                    const y2 = (r + 1) * spacing;
                    const x = c * spacing;
                    const key = moveKey("v", r, c);
                    const hovered = hoveredMoveKey === key && !owner && game.currentPlayer === "human" && !game.gameOver;
                    const last = sameMove(game.lastMove, { type: "v", r, c });

                    return (
                      <g key={key}>
                        {hovered && (
                          <line
                            x1={x}
                            y1={y1}
                            x2={x}
                            y2={y2}
                            stroke={PLAYER_META.human.line}
                            strokeOpacity={0.48}
                            strokeWidth={lineWidth + 2}
                            strokeLinecap="round"
                            strokeDasharray={`${spacing * 0.18} ${spacing * 0.1}`}
                            pointerEvents="none"
                          />
                        )}

                        {owner && (
                          <g className={last ? "edge-drawn" : undefined}>
                            <line
                              x1={x}
                              y1={y1}
                              x2={x}
                              y2={y2}
                              stroke={PLAYER_META[owner].glow}
                              strokeWidth={lineWidth + 10}
                              strokeLinecap="round"
                            />
                            <line
                              x1={x}
                              y1={y1}
                              x2={x}
                              y2={y2}
                              stroke={PLAYER_META[owner].line}
                              strokeWidth={lineWidth}
                              strokeLinecap="round"
                            />
                            <line
                              x1={x}
                              y1={y1}
                              x2={x}
                              y2={y2}
                              stroke="rgba(255,255,255,0.35)"
                              strokeWidth={1.4}
                              strokeLinecap="round"
                            />
                          </g>
                        )}

                        {!owner && (
                          <line
                            x1={x}
                            y1={y1}
                            x2={x}
                            y2={y2}
                            role="button"
                            tabIndex={game.currentPlayer === "human" && !game.gameOver ? 0 : -1}
                            aria-label={`Tracer la ligne verticale ${r + 1}, ${c + 1}`}
                            onClick={() => handleEdgeClick({ type: "v", r, c })}
                            onMouseEnter={() => setHoveredMoveKey(key)}
                            onMouseLeave={() => setHoveredMoveKey(null)}
                            onFocus={() => setHoveredMoveKey(key)}
                            onBlur={() => setHoveredMoveKey(null)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter" || event.key === " ") {
                                event.preventDefault();
                                handleEdgeClick({ type: "v", r, c });
                              }
                            }}
                            className={cn(
                              "transition-colors focus:outline-none",
                              game.currentPlayer === "human" && !game.gameOver ? "cursor-pointer" : "cursor-default"
                            )}
                            stroke={hovered ? "rgba(99, 230, 255, 0.18)" : "transparent"}
                            strokeWidth={hitWidth}
                            strokeLinecap="round"
                          />
                        )}
                      </g>
                    );
                  })
                )}

                {Array.from({ length: game.rows + 1 }, (_, r) =>
                  Array.from({ length: game.cols + 1 }, (_, c) => (
                    <g key={`dot-${r}-${c}`}>
                      <circle cx={c * spacing} cy={r * spacing} r={dotRadius + 4} fill="rgba(132, 146, 255, 0.08)" />
                      <circle cx={c * spacing} cy={r * spacing} r={dotRadius + 1.6} fill="url(#dotGlow)" />
                      <circle cx={c * spacing} cy={r * spacing} r={dotRadius} fill="#f8fafc" />
                    </g>
                  ))
                )}
              </svg>
            </div>
          </section>

          <aside className="space-y-6">
            <div className="glass-card rounded-[2rem] p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300">Lecture tactique</div>
              <h3 className="mt-2 text-2xl font-black text-white">Analyse du plateau</h3>
              <div className="mt-4 space-y-3">
                <div className="rounded-[1.25rem] border border-white/10 bg-white/6 p-4">
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>Cases encore libres</span>
                    <span className="text-lg font-black text-white">{remainingBoxes}</span>
                  </div>
                </div>
                <div className="rounded-[1.25rem] border border-white/10 bg-white/6 p-4">
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>Lignes restantes</span>
                    <span className="text-lg font-black text-white">{availableMoves.length}</span>
                  </div>
                </div>
                <div className="rounded-[1.25rem] border border-white/10 bg-white/6 p-4">
                  <div className="flex items-center justify-between text-sm text-slate-300">
                    <span>Différentiel</span>
                    <span className="text-lg font-black text-white">
                      {game.scores.human === game.scores.ai
                        ? "0"
                        : game.scores.human > game.scores.ai
                          ? `+${game.scores.human - game.scores.ai}`
                          : `-${game.scores.ai - game.scores.human}`}
                    </span>
                  </div>
                </div>
              </div>
              <p className="mt-4 text-sm leading-7 text-slate-300">{difficultyText(currentLevel.difficulte)}</p>
            </div>

            <div className="glass-card rounded-[2rem] p-5">
              <div className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-300">Objectif</div>
              <h3 className="mt-2 text-2xl font-black text-white">Mission du niveau</h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">{currentLevel.ambiance}</p>
              <ul className="mt-4 space-y-3 text-sm text-slate-200">
                <li className="rounded-[1.25rem] border border-cyan-300/15 bg-cyan-400/8 p-3">
                  • Capturez une case pour rejouer immédiatement et créer une chaîne à votre avantage.
                </li>
                <li className="rounded-[1.25rem] border border-amber-300/15 bg-amber-400/8 p-3">
                  • Les cadres dorés signalent les cases prêtes à être fermées.
                </li>
                <li className="rounded-[1.25rem] border border-violet-300/15 bg-violet-400/8 p-3">
                  • Gagnez ce niveau pour débloquer le suivant et monter en difficulté.
                </li>
              </ul>
            </div>
          </aside>
        </div>

        <footer className="mt-6 pb-2 text-center text-sm text-slate-400">
          Créateur de l'app : <span className="font-semibold text-slate-200">Hylst - Geoffroy</span> avec
          l'aide d'une IA · Mode campagne, plein écran, musique d'ambiance et effets sonores inclus.
        </footer>
      </div>
    </div>
  );
}
