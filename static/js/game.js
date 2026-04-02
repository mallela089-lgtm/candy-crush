/* global fetch */
(() => {
  "use strict";

  // ----------------------------
  // DOM
  // ----------------------------
  const el = {
    screenStart: document.getElementById("screen-start"),
    screenGame: document.getElementById("screen-game"),
    startLevel: document.getElementById("startLevel"),
    btnStart: document.getElementById("btn-start"),
    btnResume: document.getElementById("btn-resume"),
    uiLevel: document.getElementById("ui-level"),
    uiScore: document.getElementById("ui-score"),
    uiTime: document.getElementById("ui-time"),
    uiObjective: document.getElementById("ui-objective"),
    btnPause: document.getElementById("btn-pause"),
    btnHint: document.getElementById("btn-hint"),
    btnShuffle: document.getElementById("btn-shuffle"),
    btnRestart: document.getElementById("btn-restart"),
    btnRestartOverlay: document.getElementById("btn-restart-overlay"),
    board: document.getElementById("board"),
    boardOverlay: document.getElementById("board-overlay"),
    btnResume2: document.getElementById("btn-resume2"),
    modalGameover: document.getElementById("modal-gameover"),
    modalTitle: document.getElementById("modal-title"),
    modalBody: document.getElementById("modal-body"),
    btnModalRestart: document.getElementById("btn-modal-restart"),
    btnModalNext: document.getElementById("btn-modal-next"),
    btnModalExit: document.getElementById("btn-modal-exit"),
    statsMsg: document.getElementById("stats-msg"),
  };

  // ----------------------------
  // Game State
  // ----------------------------
  const SAVE_KEY = "cc_save_v1";
  const MAX_LEVEL = 100;
  const SWAP_ANIM_MS = 170;
  const EXPLODE_ANIM_MS = 160;
  const FALL_ANIM_MS = 210;
  const SPAWN_ANIM_MS = 210;
  const MAX_GENERATION_ATTEMPTS = 30;
  const MAX_CASCADES_PER_MOVE = 25;

  const typeColors = [
    "#ff4b5c",
    "#ffb703",
    "#7ae582",
    "#219ebc",
    "#9b5de5",
    "#f15bb5",
    "#00bbf9",
    "#00f5d4",
    "#ffd166",
    "#ef476f",
  ];

  const state = {
    status: "start", // start|playing|paused|level_complete|game_over
    levelNumber: 1,
    config: null,
    level: null,
    gridSize: 8,

    board: [], // 2D array
    nextCandyId: 1,
    candiesById: new Map(), // id -> candy object
    spriteById: new Map(), // id -> DOM element
    blockers: [], // list of {r,c,el}

    score: 0,
    clearedCount: 0,
    timeLeftSeconds: 0,
    timerId: null,

    isPaused: false,
    isAnimating: false,
    selected: null, // {r,c}

    rng: null,
    sessionSeedOffset: 0,
  };

  // ----------------------------
  // Sound (WebAudio, no external files)
  // ----------------------------
  const SOUND_STORAGE_KEY = "cc_sound_on";
  const sound = {
    enabled: true,
    ctx: null,
    masterGain: null,
  };

  function soundPrefEnabled() {
    try {
      const v = localStorage.getItem(SOUND_STORAGE_KEY);
      if (v === null) return true;
      return v === "1";
    } catch {
      return true;
    }
  }

  function ensureAudio() {
    sound.enabled = soundPrefEnabled();
    if (!sound.enabled) return false;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return false;

    if (sound.ctx) {
      if (sound.ctx.state === "suspended") sound.ctx.resume().catch(() => {});
      return true;
    }

    sound.ctx = new AudioContext();
    sound.masterGain = sound.ctx.createGain();
    sound.masterGain.gain.value = 0.06; // global volume
    sound.masterGain.connect(sound.ctx.destination);
    return true;
  }

  function playWebAudioEnvelope({ freqs, type = "sine", durationMs = 90, gain = 1, detune = 0 }) {
    if (!sound.ctx || !sound.masterGain) return;
    const now = sound.ctx.currentTime;

    const nodes = freqs.map((f) => {
      const osc = sound.ctx.createOscillator();
      osc.type = type;
      osc.frequency.setValueAtTime(f, now);
      if (detune) osc.detune.setValueAtTime(detune, now);
      return osc;
    });

    const g = sound.ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    // Quick attack then decay.
    g.gain.exponentialRampToValueAtTime(0.12 * gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    g.connect(sound.masterGain);

    for (const osc of nodes) osc.connect(g);

    for (const osc of nodes) osc.start(now);
    for (const osc of nodes) osc.stop(now + durationMs / 1000 + 0.02);
  }

  function playSoundSwap() {
    if (!ensureAudio()) return;
    playWebAudioEnvelope({ freqs: [440, 660], type: "triangle", durationMs: 85, gain: 0.7 });
  }

  function playSoundMatch(cascadeIndex) {
    if (!ensureAudio()) return;
    const base = 330 + Math.min(260, (cascadeIndex - 1) * 45);
    playWebAudioEnvelope({ freqs: [base, base * 1.25], type: "sine", durationMs: 95, gain: 0.85 });
  }

  function playSoundSpecial(reqKind) {
    if (!ensureAudio()) return;
    if (reqKind === "bomb") {
      // Low + quick high "pop"
      playWebAudioEnvelope({ freqs: [120], type: "sawtooth", durationMs: 85, gain: 0.75, detune: -10 });
      playWebAudioEnvelope({ freqs: [740], type: "square", durationMs: 60, gain: 0.55 });
    } else {
      // Striped
      playWebAudioEnvelope({ freqs: [520, 880], type: "triangle", durationMs: 90, gain: 0.65 });
    }
  }

  function playSoundHint() {
    if (!ensureAudio()) return;
    playWebAudioEnvelope({ freqs: [392, 523], type: "sine", durationMs: 70, gain: 0.45 });
  }

  function playSoundShuffle() {
    if (!ensureAudio()) return;
    // Short "tick-tick"
    playWebAudioEnvelope({ freqs: [260], type: "square", durationMs: 40, gain: 0.35 });
    setTimeout(() => playWebAudioEnvelope({ freqs: [330], type: "square", durationMs: 40, gain: 0.35 }), 55);
  }

  function playSoundPause(paused) {
    if (!ensureAudio()) return;
    if (paused) {
      playWebAudioEnvelope({ freqs: [220], type: "sine", durationMs: 110, gain: 0.45 });
    } else {
      playWebAudioEnvelope({ freqs: [330], type: "sine", durationMs: 90, gain: 0.45 });
    }
  }

  function playSoundWin() {
    if (!ensureAudio()) return;
    // Triad-ish arpeggio
    playWebAudioEnvelope({ freqs: [523], type: "triangle", durationMs: 85, gain: 0.6 });
    setTimeout(() => playWebAudioEnvelope({ freqs: [659], type: "triangle", durationMs: 85, gain: 0.55 }), 90);
    setTimeout(() => playWebAudioEnvelope({ freqs: [784], type: "triangle", durationMs: 110, gain: 0.5 }), 180);
  }

  function playSoundLose() {
    if (!ensureAudio()) return;
    playWebAudioEnvelope({ freqs: [250, 200], type: "sawtooth", durationMs: 170, gain: 0.55 });
  }

  // ----------------------------
  // Helpers
  // ----------------------------
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function posKey(r, c) {
    return `${r},${c}`;
  }

  function isCandyCell(cell) {
    return cell && (cell.kind === "candy" || cell.kind === "locked");
  }

  function isMovableCandy(cell) {
    return cell && cell.kind === "candy";
  }

  function isObstacleCell(cell) {
    // Gravity cannot pass blockers or locked candies.
    return cell && (cell.kind === "blocker" || cell.kind === "locked");
  }

  function within(r, c) {
    return r >= 0 && c >= 0 && r < state.gridSize && c < state.gridSize;
  }

  function getCandyType(cell) {
    if (!cell) return null;
    return isCandyCell(cell) ? cell.type : null;
  }

  function getCellAt(r, c) {
    if (!within(r, c)) return null;
    return state.board[r][c];
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a += 0x6d2b79f5;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function randInt(rng, minInclusive, maxInclusive) {
    return Math.floor(rng() * (maxInclusive - minInclusive + 1)) + minInclusive;
  }

  function shuffleArray(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }

  function getCellSizePx() {
    const cs = window.getComputedStyle(el.board).getPropertyValue("--cell").trim();
    const val = parseFloat(cs);
    return Number.isFinite(val) ? val : 48;
  }

  function updateBoardCssGridSize() {
    el.board.style.setProperty("--grid-size", `${state.gridSize}`);
  }

  function candyBgForType(type) {
    const color = typeColors[type % typeColors.length];
    return `radial-gradient(circle at 30% 30%, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.25) 28%, rgba(0,0,0,0.15) 65%), linear-gradient(135deg, ${color}, ${color}cc)`;
  }

  function setSpriteTransform(spriteEl, r, c, cellSizePx) {
    const x = c * cellSizePx;
    const y = r * cellSizePx;
    spriteEl.style.transform = `translate(${x}px, ${y}px)`;
  }

  function removeAllBoardElements() {
    el.board.innerHTML = "";
    state.candiesById.clear();
    state.spriteById.clear();
    state.blockers = [];
  }

  // ----------------------------
  // Rendering
  // ----------------------------
  function createBlocker(r, c) {
    const blockerEl = document.createElement("div");
    blockerEl.className = "blocker";
    blockerEl.style.left = "0px";
    blockerEl.style.top = "0px";
    el.board.appendChild(blockerEl);
    const cellSizePx = getCellSizePx();
    blockerEl.style.transform = `translate(${c * cellSizePx}px, ${r * cellSizePx}px)`;
    state.blockers.push({ r, c, el: blockerEl });
  }

  function createCandySprite(candy, { spawnFromAbove = false } = {}) {
    const cellSizePx = getCellSizePx();
    const spriteEl = document.createElement("div");
    spriteEl.className = "candy-sprite";
    spriteEl.dataset.candyId = String(candy.id);
    spriteEl.style.background = candyBgForType(candy.type);
    spriteEl.style.boxShadow = "inset 0 0 0 2px rgba(255,255,255,0.12), 0 12px 26px rgba(0,0,0,0.25)";

    if (candy.kind === "locked") {
      spriteEl.classList.add("locked");
      spriteEl.style.filter = "saturate(0.95) brightness(0.95)";
      const badge = document.createElement("div");
      badge.className = "locked-badge";
      badge.textContent = `x${candy.health}`;
      spriteEl.appendChild(badge);
    }

    if (candy.special) {
      if (candy.special === "stripedH") spriteEl.classList.add("special-stripedH");
      if (candy.special === "stripedV") spriteEl.classList.add("special-stripedV");
      if (candy.special === "bomb") spriteEl.classList.add("special-bomb");
    }

    spriteEl.addEventListener("pointerdown", (ev) => {
      if (!state.isAnimating && !state.isPaused) {
        ev.preventDefault();
        // Create the AudioContext on a user gesture (required by most browsers).
        ensureAudio();
        onCandyPointerDown(candy.id);
      }
    });

    el.board.appendChild(spriteEl);

    // Initial placement
    if (spawnFromAbove) {
      spriteEl.style.transition = "none";
      // Spawn slightly above its final row.
      const startR = candy.row - 2;
      setSpriteTransform(spriteEl, startR, candy.col, cellSizePx);
      // next frame: move into place with animation
      requestAnimationFrame(() => {
        spriteEl.style.transition = "";
        setSpriteTransform(spriteEl, candy.row, candy.col, cellSizePx);
      });
    } else {
      setSpriteTransform(spriteEl, candy.row, candy.col, cellSizePx);
    }

    state.spriteById.set(candy.id, spriteEl);
    state.candiesById.set(candy.id, candy);
  }

  function updateLockedBadge(candy) {
    const spriteEl = state.spriteById.get(candy.id);
    if (!spriteEl) return;
    const badge = spriteEl.querySelector(".locked-badge");
    if (badge) badge.textContent = `x${candy.health}`;
  }

  function highlightHintMove(r1, c1, r2, c2) {
    clearHintHighlights();
    const s1 = state.board[r1]?.[c1];
    const s2 = state.board[r2]?.[c2];
    if (s1 && state.spriteById.has(s1.id)) state.spriteById.get(s1.id).classList.add("highlight");
    if (s2 && state.spriteById.has(s2.id)) state.spriteById.get(s2.id).classList.add("highlight");
  }

  function clearHintHighlights() {
    for (const spriteEl of state.spriteById.values()) {
      spriteEl.classList.remove("highlight");
    }
  }

  function renderFullBoard(board) {
    removeAllBoardElements();
    updateBoardCssGridSize();

    for (let r = 0; r < state.gridSize; r++) {
      for (let c = 0; c < state.gridSize; c++) {
        const cell = board[r][c];
        if (!cell) continue;
        if (cell.kind === "blocker") {
          createBlocker(r, c);
        } else {
          createCandySprite(cell);
        }
      }
    }
  }

  // ----------------------------
  // Board Serialization (LocalStorage)
  // ----------------------------
  function serializeBoard(board) {
    const out = [];
    for (let r = 0; r < state.gridSize; r++) {
      out[r] = [];
      for (let c = 0; c < state.gridSize; c++) {
        const cell = board[r][c];
        if (!cell) {
          out[r][c] = null;
        } else if (cell.kind === "blocker") {
          out[r][c] = { kind: "blocker" };
        } else if (cell.kind === "locked") {
          out[r][c] = { kind: "locked", type: cell.type, health: cell.health };
        } else {
          out[r][c] = { kind: "candy", type: cell.type, special: cell.special };
        }
      }
    }
    return out;
  }

  function deserializeBoard(serialized) {
    const board = Array.from({ length: state.gridSize }, () => Array(state.gridSize).fill(null));
    state.nextCandyId = 1;
    state.candiesById.clear();
    state.spriteById.clear();

    for (let r = 0; r < state.gridSize; r++) {
      for (let c = 0; c < state.gridSize; c++) {
        const cell = serialized[r][c];
        if (!cell) continue;
        if (cell.kind === "blocker") {
          board[r][c] = { kind: "blocker" };
        } else if (cell.kind === "locked") {
          const id = state.nextCandyId++;
          board[r][c] = { id, kind: "locked", type: cell.type, health: cell.health, row: r, col: c };
        } else if (cell.kind === "candy") {
          const id = state.nextCandyId++;
          board[r][c] = {
            id,
            kind: "candy",
            type: cell.type,
            special: cell.special || null,
            row: r,
            col: c,
          };
        }
      }
    }
    return board;
  }

  function saveProgress() {
    if (state.status !== "playing" && state.status !== "paused") return;
    const payload = {
      levelNumber: state.levelNumber,
      score: state.score,
      clearedCount: state.clearedCount,
      timeLeftSeconds: state.timeLeftSeconds,
      board: serializeBoard(state.board),
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
  }

  function clearProgress() {
    localStorage.removeItem(SAVE_KEY);
  }

  function loadSavedProgress() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ----------------------------
  // Match Detection
  // ----------------------------
  function findMatchGroups(board) {
    const matches = [];
    const N = state.gridSize;

    // Horizontal runs
    for (let r = 0; r < N; r++) {
      let c = 0;
      while (c < N) {
        const cell = board[r][c];
        const t = isCandyCell(cell) ? cell.type : null;
        if (t === null) {
          c++;
          continue;
        }
        const startC = c;
        const runType = t;
        c++;
        while (c < N) {
          const cell2 = board[r][c];
          const t2 = isCandyCell(cell2) ? cell2.type : null;
          if (t2 === runType) c++;
          else break;
        }
        const len = c - startC;
        if (len >= 3) {
          const positions = [];
          for (let cc = startC; cc < c; cc++) positions.push({ r, c: cc });
          matches.push({ orientation: "H", length: len, positions, type: runType });
        }
      }
    }

    // Vertical runs
    for (let c = 0; c < N; c++) {
      let r = 0;
      while (r < N) {
        const cell = board[r][c];
        const t = isCandyCell(cell) ? cell.type : null;
        if (t === null) {
          r++;
          continue;
        }
        const startR = r;
        const runType = t;
        r++;
        while (r < N) {
          const cell2 = board[r][c];
          const t2 = isCandyCell(cell2) ? cell2.type : null;
          if (t2 === runType) r++;
          else break;
        }
        const len = r - startR;
        if (len >= 3) {
          const positions = [];
          for (let rr = startR; rr < r; rr++) positions.push({ r: rr, c });
          matches.push({ orientation: "V", length: len, positions, type: runType });
        }
      }
    }

    return matches;
  }

  // ----------------------------
  // Move Validation + Hinting
  // ----------------------------
  function wouldSwapCreateMatch(r1, c1, r2, c2) {
    const a = state.board[r1][c1];
    const b = state.board[r2][c2];
    if (!isMovableCandy(a) || !isMovableCandy(b)) return false;

    state.board[r1][c1] = b;
    state.board[r2][c2] = a;
    const groups = findMatchGroups(state.board);
    state.board[r1][c1] = a;
    state.board[r2][c2] = b;
    return groups.length > 0;
  }

  function hasAnyValidMove() {
    const N = state.gridSize;
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = state.board[r][c];
        if (!isMovableCandy(cell)) continue;
        // Right
        if (c + 1 < N && wouldSwapCreateMatch(r, c, r, c + 1)) return true;
        // Down
        if (r + 1 < N && wouldSwapCreateMatch(r, c, r + 1, c)) return true;
      }
    }
    return false;
  }

  function bestHintMove() {
    const N = state.gridSize;
    let best = null; // {r1,c1,r2,c2,scoreHint}

    const estimateScoreFromGroups = (groups) => {
      // Base estimation: total candies in all matching groups (with duplicates removed).
      const posSet = new Set();
      for (const g of groups) for (const p of g.positions) posSet.add(posKey(p.r, p.c));
      return posSet.size;
    };

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = state.board[r][c];
        if (!isMovableCandy(cell)) continue;

        const neighbors = [
          { r: r, c: c + 1 },
          { r: r + 1, c: c },
          { r: r, c: c - 1 },
          { r: r - 1, c: c },
        ];

        for (const nb of neighbors) {
          if (!within(nb.r, nb.c)) continue;
          if (!isMovableCandy(state.board[nb.r][nb.c])) continue;

          state.board[r][c] = state.board[nb.r][nb.c];
          state.board[nb.r][nb.c] = cell;
          const groups = findMatchGroups(state.board);
          state.board[nb.r][nb.c] = state.board[r][c];
          state.board[r][c] = cell;

          if (groups.length === 0) continue;
          const hintScore = estimateScoreFromGroups(groups);
          if (!best || hintScore > best.scoreHint) {
            best = { r1: r, c1: c, r2: nb.r, c2: nb.c, scoreHint: hintScore };
          }
        }
      }
    }

    return best;
  }

  // ----------------------------
  // Board Generation
  // ----------------------------
  function pickTypeAvoidingImmediateMatch(r, c, rng, board) {
    const N = state.gridSize;
    const types = state.config.candy_types;

    // We'll retry a few times; since board is small this is fast enough.
    for (let tries = 0; tries < 40; tries++) {
      const t = randInt(rng, 0, types - 1);

      // Avoid 3-in-a-row on spawn.
      let bad = false;
      if (c >= 2) {
        const a = board[r][c - 1];
        const b = board[r][c - 2];
        if (isCandyCell(a) && isCandyCell(b) && a.type === t && b.type === t) bad = true;
      }
      if (r >= 2) {
        const a = board[r - 1][c];
        const b = board[r - 2][c];
        if (isCandyCell(a) && isCandyCell(b) && a.type === t && b.type === t) bad = true;
      }
      if (!bad) return t;
    }
    // Fallback (should be rare)
    return randInt(rng, 0, state.config.candy_types - 1);
  }

  function generateEmptyBoard() {
    return Array.from({ length: state.gridSize }, () => Array(state.gridSize).fill(null));
  }

  function placeRandomBlockers(board, rng, count) {
    const N = state.gridSize;
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 2000) {
      attempts++;
      const r = randInt(rng, 0, N - 1);
      const c = randInt(rng, 0, N - 1);
      if (board[r][c] !== null) continue;

      // Avoid fully blocking the first rows to keep interaction fair.
      if (r < 1 && c < 1) continue;

      board[r][c] = { kind: "blocker" };
      placed++;
    }
  }

  function placeRandomLockedCandies(board, rng, count, health) {
    const N = state.gridSize;
    let placed = 0;
    let attempts = 0;
    while (placed < count && attempts < 2500) {
      attempts++;
      const r = randInt(rng, 0, N - 1);
      const c = randInt(rng, 0, N - 1);
      if (board[r][c] !== null) continue;
      if (board[r][c] !== null) continue;
      // Locked candies are still matchable, but they never fall.
      const id = state.nextCandyId++;
      const type = randInt(rng, 0, state.config.candy_types - 1);
      board[r][c] = { id, kind: "locked", type, health, row: r, col: c };
      placed++;
    }
  }

  function spawnCandyAt(board, r, c, rng, { locked = false } = {}) {
    const type = pickTypeAvoidingImmediateMatch(r, c, rng, board);
    if (locked) {
      const id = state.nextCandyId++;
      board[r][c] = { id, kind: "locked", type, health: state.level.locked_candy_health, row: r, col: c };
    } else {
      const id = state.nextCandyId++;
      board[r][c] = { id, kind: "candy", type, special: null, row: r, col: c };
    }
  }

  function generateBoardForLevel() {
    const N = state.gridSize;
    const level = state.level;

    let attempt = 0;
    while (attempt < MAX_GENERATION_ATTEMPTS) {
      attempt++;
      state.nextCandyId = 1;
      state.candiesById.clear();
      state.spriteById.clear();

      const seed = (level.pattern_seed || 0) + attempt * 9973 + state.sessionSeedOffset;
      state.rng = mulberry32(seed);
      const rng = state.rng;

      const board = generateEmptyBoard();
      placeRandomBlockers(board, rng, level.blocker_count || 0);
      placeRandomLockedCandies(board, rng, level.locked_candy_count || 0, level.locked_candy_health || 2);

      // Fill remaining cells with candies (specials start off disabled).
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          if (board[r][c] !== null) continue;
          const type = pickTypeAvoidingImmediateMatch(r, c, rng, board);
          const id = state.nextCandyId++;
          board[r][c] = { id, kind: "candy", type, special: null, row: r, col: c };
        }
      }

      // Avoid immediate matches if possible.
      if (findMatchGroups(board).length > 0) continue;

      // Ensure at least one valid move exists.
      state.board = board; // temporarily for wouldSwap
      if (!hasAnyValidMove()) continue;
      state.board = board;
      return board;
    }

    // Fallback: generate a board and then shuffle until it has a valid move.
    const seed = (level.pattern_seed || 0) + 123456 + state.sessionSeedOffset;
    state.rng = mulberry32(seed);
    const rng = state.rng;
    state.nextCandyId = 1;

    const board = generateEmptyBoard();
    placeRandomBlockers(board, rng, level.blocker_count || 0);
    placeRandomLockedCandies(board, rng, level.locked_candy_count || 0, level.locked_candy_health || 2);

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        if (board[r][c] !== null) continue;
        const type = pickTypeAvoidingImmediateMatch(r, c, rng, board);
        const id = state.nextCandyId++;
        board[r][c] = { id, kind: "candy", type, special: null, row: r, col: c };
      }
    }
    state.board = board;
    if (!hasAnyValidMove()) shuffleBoardUntilValidMoves(board, rng);
    return board;
  }

  function shuffleBoardUntilValidMoves(board, rng) {
    const N = state.gridSize;
    const movablePositions = [];
    const movableCandies = [];

    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const cell = board[r][c];
        if (isMovableCandy(cell)) {
          movablePositions.push({ r, c });
          movableCandies.push(cell);
        }
      }
    }

    for (let i = 0; i < 25; i++) {
      shuffleArray(movableCandies, rng);
      for (let k = 0; k < movablePositions.length; k++) {
        const p = movablePositions[k];
        const candy = movableCandies[k];
        candy.row = p.r;
        candy.col = p.c;
        board[p.r][p.c] = candy;
      }

      if (findMatchGroups(board).length > 0) continue;
      state.board = board;
      if (hasAnyValidMove()) return;
    }
  }

  async function shuffleCurrentBoard() {
    if (state.isAnimating || state.isPaused || state.status !== "playing") return;
    playSoundShuffle();
    state.isAnimating = true;
    try {
      const rng = mulberry32((state.level.pattern_seed || 0) + Date.now());
      // Shuffle only movable candies; keep locked/blockers fixed.
      const N = state.gridSize;
      const movablePositions = [];
      const movableCandies = [];

      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const cell = state.board[r][c];
          if (isMovableCandy(cell)) {
            movablePositions.push({ r, c });
            movableCandies.push(cell);
          }
        }
      }

      shuffleArray(movableCandies, rng);

      for (let k = 0; k < movablePositions.length; k++) {
        const p = movablePositions[k];
        const candy = movableCandies[k];
        candy.row = p.r;
        candy.col = p.c;
        state.board[p.r][p.c] = candy;
      }

      // Clear selection + remove any hint highlights.
      state.selected = null;
      clearHintHighlights();

      // If we landed on an immediate match, or no moves, reshuffle a bit more.
      let tries = 0;
      while (tries < 15) {
        tries++;
        if (findMatchGroups(state.board).length === 0 && hasAnyValidMove()) break;
        shuffleArray(movableCandies, rng);
        for (let k = 0; k < movablePositions.length; k++) {
          const p = movablePositions[k];
          const candy = movableCandies[k];
          candy.row = p.r;
          candy.col = p.c;
          state.board[p.r][p.c] = candy;
        }
      }

      // Animate moved candies by updating transforms.
      const cellSizePx = getCellSizePx();
      for (const candy of movableCandies) {
        const spriteEl = state.spriteById.get(candy.id);
        if (spriteEl) setSpriteTransform(spriteEl, candy.row, candy.col, cellSizePx);
      }
      await wait(FALL_ANIM_MS);
    } finally {
      state.isAnimating = false;
    }
  }

  // ----------------------------
  // Physics: Gravity + Spawning
  // ----------------------------
  function pickTypeAvoidingAutoMatchDuringSpawn(r, c, rng) {
    return pickTypeAvoidingImmediateMatch(r, c, rng, state.board);
  }

  async function applyGravityAndSpawn() {
    const N = state.gridSize;
    const rng = state.rng || mulberry32((state.level.pattern_seed || 0) + Date.now());
    state.rng = rng;

    const cellSizePx = getCellSizePx();

    // Move candies down within each column segment.
    for (let c = 0; c < N; c++) {
      let writeRow = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        const cell = state.board[r][c];
        if (!cell) continue;

        if (isObstacleCell(cell)) {
          // Locked candies act as barriers (no movement through them).
          writeRow = r - 1;
          continue;
        }

        if (isMovableCandy(cell)) {
          if (writeRow !== r) {
            state.board[writeRow][c] = cell;
            state.board[r][c] = null;
            cell.row = writeRow;
            cell.col = c;
            const spriteEl = state.spriteById.get(cell.id);
            if (spriteEl) setSpriteTransform(spriteEl, cell.row, cell.col, cellSizePx);
          }
          writeRow--;
        }
      }

      // Spawn new candies in empty cells above the last writeRow, but below any obstacles.
      for (let r = 0; r < N; r++) {
        const cell = state.board[r][c];
        if (cell === null) {
          // Ensure we don't spawn where a blocker or locked candy exists (shouldn't happen).
          const t = pickTypeAvoidingAutoMatchDuringSpawn(r, c, rng);
          const id = state.nextCandyId++;
          const candy = { id, kind: "candy", type: t, special: null, row: r, col: c };
          state.board[r][c] = candy;
          state.candiesById.set(id, candy);
          createCandySprite(candy, { spawnFromAbove: true });
        }
      }
    }

    await wait(FALL_ANIM_MS);
    await wait(SPAWN_ANIM_MS);
  }

  // ----------------------------
  // Match Resolution + Specials
  // ----------------------------
  function determineSpecialCreateRequests(groups) {
    // If multiple groups create specials on same cell, bomb wins.
    const requests = new Map(); // key -> request
    const bombPriority = 3;
    const stripedPriority = 2;

    for (const g of groups) {
      const len = g.length;
      if (len < 4) continue;
      const centerIdx = Math.floor(g.positions.length / 2);
      const p = g.positions[centerIdx];
      const key = posKey(p.r, p.c);
      const type = g.type;

      if (len >= 5) {
        const req = { kind: "bomb", priority: bombPriority, type };
        const existing = requests.get(key);
        if (!existing || req.priority > existing.priority) requests.set(key, req);
      } else if (len === 4) {
        const req = {
          kind: "striped",
          priority: stripedPriority,
          type,
          dir: g.orientation === "H" ? "stripedH" : "stripedV",
        };
        const existing = requests.get(key);
        if (!existing || req.priority > existing.priority) requests.set(key, req);
      }
    }
    return requests;
  }

  function expandSpecialEffects(initialToClear) {
    const N = state.gridSize;
    const toClear = new Set(initialToClear);
    const queue = [];
    const triggered = new Set();

    const addIfPresentCandy = (r, c) => {
      const cell = state.board[r][c];
      if (!cell) return;
      if (cell.kind === "blocker") return;
      toClear.add(posKey(r, c));
      if (cell.kind === "candy" && cell.special) {
        queue.push({ r, c });
      }
    };

    for (const key of initialToClear) {
      const [rStr, cStr] = key.split(",");
      const r = parseInt(rStr, 10);
      const c = parseInt(cStr, 10);
      const cell = state.board[r][c];
      if (cell && cell.kind === "candy" && cell.special) {
        queue.push({ r, c });
      }
    }

    let specialTriggered = false;
    while (queue.length) {
      const { r, c } = queue.shift();
      const key = posKey(r, c);
      if (triggered.has(key)) continue;
      triggered.add(key);

      const cell = state.board[r][c];
      if (!cell || cell.kind !== "candy" || !cell.special) continue;

      specialTriggered = true;

      if (cell.special === "bomb") {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (!within(nr, nc)) continue;
            addIfPresentCandy(nr, nc);
          }
        }
      } else if (cell.special === "stripedH") {
        for (let nc = 0; nc < N; nc++) addIfPresentCandy(r, nc);
      } else if (cell.special === "stripedV") {
        for (let nr = 0; nr < N; nr++) addIfPresentCandy(nr, c);
      }
    }

    return { toClear, specialTriggered };
  }

  async function clearPositionsAndCreateSpecials(positionsToClearSet, createRequests, comboIndex) {
    const cleared = [];
    const removedSpriteIds = [];
    let removedCandies = 0;

    if (createRequests && createRequests.size > 0) {
      const kinds = new Set([...createRequests.values()].map((req) => req.kind));
      for (const k of kinds) playSoundSpecial(k);
    }

    // First pass: apply damage/removals, but don't create specials yet.
    for (const key of positionsToClearSet) {
      const [rStr, cStr] = key.split(",");
      const r = parseInt(rStr, 10);
      const c = parseInt(cStr, 10);
      const cell = state.board[r][c];
      if (!cell || cell.kind === "blocker") continue;

      if (cell.kind === "locked") {
        cell.health -= 1;
        if (cell.health <= 0) {
          state.board[r][c] = null;
          removedCandies++;
          removedSpriteIds.push(cell.id);
        } else {
          // Update badge in-place.
          cleared.push(cell.id);
        }
      } else if (cell.kind === "candy") {
        state.board[r][c] = null;
        removedCandies++;
        removedSpriteIds.push(cell.id);
      }
    }

    // Animate locked badge updates quickly (no explosion).
    for (const lockedId of cleared) {
      const candy = state.candiesById.get(lockedId);
      if (candy) updateLockedBadge(candy);
    }

    // Animate explosions for removed sprites.
    for (const id of removedSpriteIds) {
      const spriteEl = state.spriteById.get(id);
      if (!spriteEl) continue;
      const currentTransform = spriteEl.style.transform || "translate(0px, 0px)";
      spriteEl.style.transition = "transform 160ms ease, opacity 160ms ease";
      spriteEl.style.opacity = "0";
      spriteEl.style.transform = `${currentTransform} scale(0.75)`;
    }

    await wait(EXPLODE_ANIM_MS);

    // Remove exploded elements
    for (const id of removedSpriteIds) {
      const spriteEl = state.spriteById.get(id);
      if (spriteEl && spriteEl.parentNode) spriteEl.parentNode.removeChild(spriteEl);
      state.spriteById.delete(id);
      state.candiesById.delete(id);
    }

    // Create specials at the center positions of 4+ matches.
    for (const [key, req] of createRequests.entries()) {
      const [rStr, cStr] = key.split(",");
      const r = parseInt(rStr, 10);
      const c = parseInt(cStr, 10);
      const cellNow = state.board[r][c];
      if (cellNow) continue; // Only create on an empty spot.
      if (req.kind === "bomb") {
        const id = state.nextCandyId++;
        const candy = { id, kind: "candy", type: req.type, special: "bomb", row: r, col: c };
        state.board[r][c] = candy;
        createCandySprite(candy);
      } else if (req.kind === "striped") {
        const id = state.nextCandyId++;
        const candy = { id, kind: "candy", type: req.type, special: req.dir, row: r, col: c };
        state.board[r][c] = candy;
        createCandySprite(candy);
      }
    }

    // Score
    state.clearedCount += removedCandies;

    const scoring = state.config.scoring || {};
    const baseScore = scoring.base_score_per_candy || state.config.base_score_per_candy || 10;
    const comboBonus = scoring.combo_bonus_per_combo || state.config.combo_bonus_per_combo || 10;
    const cascadeBonus = scoring.cascade_bonus_per_cascade || state.config.cascade_bonus_per_cascade || 25;
    const maxMult = scoring.max_combo_multiplier || state.config.max_combo_multiplier || 5;

    // Multiplier grows slightly each cascade.
    const mult = Math.min(maxMult, 1 + (comboIndex - 1) * 0.35);
    const specialExtra = removedCandies > 0 ? (comboIndex >= 2 ? 20 : 0) : 0;
    const scoreDelta = Math.floor((removedCandies * baseScore + comboIndex * comboBonus + comboIndex * cascadeBonus + specialExtra) * mult);
    state.score += scoreDelta;
    el.uiScore.textContent = String(state.score);

    return { removedCandies, scoreDelta };
  }

  async function resolveMatchesAfterSwap() {
    let comboIndex = 0;
    let totalRemovedThisMove = 0;

    for (let cascade = 0; cascade < MAX_CASCADES_PER_MOVE; cascade++) {
      const groups = findMatchGroups(state.board);
      if (groups.length === 0) break;

      comboIndex++;
      playSoundMatch(comboIndex);

      // Determine which positions are part of a match.
      const initialToClear = new Set();
      for (const g of groups) {
        for (const p of g.positions) initialToClear.add(posKey(p.r, p.c));
      }

      const createRequests = determineSpecialCreateRequests(groups);
      const { toClear } = expandSpecialEffects(initialToClear);

      const res = await clearPositionsAndCreateSpecials(toClear, createRequests, comboIndex);
      totalRemovedThisMove += res.removedCandies;

      // Gravity and new candies spawn
      await applyGravityAndSpawn();
    }

    return { comboIndex, totalRemovedThisMove };
  }

  // ----------------------------
  // Player Interaction
  // ----------------------------
  function areAdjacent(r1, c1, r2, c2) {
    const dr = Math.abs(r1 - r2);
    const dc = Math.abs(c1 - c2);
    return (dr + dc) === 1;
  }

  function onCandyPointerDown(candyId) {
    const candy = state.candiesById.get(candyId);
    if (!candy || candy.kind !== "candy") return; // only movable candies can be selected

    const r = candy.row;
    const c = candy.col;
    if (state.selected) {
      const sr = state.selected.r;
      const sc = state.selected.c;
      if (sr === r && sc === c) {
        state.selected = null;
        return;
      }

      if (!areAdjacent(sr, sc, r, c)) return;

      // Attempt swap with validation.
      attemptSwap(sr, sc, r, c);
    } else {
      state.selected = { r, c };
    }

    // Simple selection highlight
    clearHintHighlights();
    const spriteEl = state.spriteById.get(candyId);
    if (spriteEl) spriteEl.classList.add("highlight");
  }

  async function attemptSwap(r1, c1, r2, c2) {
    if (state.isAnimating || state.isPaused) return;
    const a = state.board[r1][c1];
    const b = state.board[r2][c2];
    if (!isMovableCandy(a) || !isMovableCandy(b)) return;

    if (!wouldSwapCreateMatch(r1, c1, r2, c2)) {
      // Invalid swap: disallow by swapping back visually (optional). We'll just shake highlight.
      // For simplicity: do nothing.
      state.selected = { r, c };
      return;
    }

    playSoundSwap();
    state.isAnimating = true;
    state.selected = null;
    clearHintHighlights();

    // Swap board references
    state.board[r1][c1] = b;
    state.board[r2][c2] = a;

    // Update logical positions
    a.row = r2; a.col = c2;
    b.row = r1; b.col = c1;

    // Animate swap
    const cellSizePx = getCellSizePx();
    const spriteA = state.spriteById.get(a.id);
    const spriteB = state.spriteById.get(b.id);
    if (spriteA) setSpriteTransform(spriteA, a.row, a.col, cellSizePx);
    if (spriteB) setSpriteTransform(spriteB, b.row, b.col, cellSizePx);

    await wait(SWAP_ANIM_MS);

    // Resolve cascades
    await resolveMatchesAfterSwap();

    // Ensure valid moves exist (shuffle if necessary).
    if (state.status === "playing" && !hasAnyValidMove()) {
      await shuffleCurrentBoard();
    }

    // Objective checks
    maybeCompleteLevel();
    saveProgress();

    state.isAnimating = false;
  }

  // ----------------------------
  // Objective / End States
  // ----------------------------
  function formatTime(seconds) {
    const s = Math.max(0, seconds | 0);
    return String(s);
  }

  function objectiveSatisfied() {
    const t = state.level.target_score || 0;
    const c = state.level.objective_clear || 0;

    const scoreOk = t > 0 ? state.score >= t : true;
    const clearOk = c > 0 ? state.clearedCount >= c : true;

    if (t > 0 && c > 0) return scoreOk && clearOk;
    if (t > 0) return scoreOk;
    if (c > 0) return clearOk;
    return false;
  }

  async function submitScoreToServer(completed) {
    if (!state.levelNumber) return;
    try {
      await fetch("/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          level_number: state.levelNumber,
          score: state.score,
          cleared_count: state.clearedCount,
          time_left_seconds: state.timeLeftSeconds,
          completed: completed,
        }),
      });
    } catch {
      // Don't break gameplay on network issues.
    }
  }

  function showModal({ title, body, showNext, onNext, onRestart, onExit }) {
    el.modalTitle.textContent = title;
    el.modalBody.textContent = body;
    el.btnModalNext.classList.toggle("d-none", !showNext);

    el.btnModalRestart.onclick = onRestart;
    el.btnModalNext.onclick = onNext || (() => {});
    el.btnModalExit.onclick = onExit;

    el.modalGameover.classList.remove("d-none");
  }

  function hideModal() {
    el.modalGameover.classList.add("d-none");
  }

  function stopTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.timerId = null;
  }

  function startTimer() {
    stopTimer();
    state.timerId = setInterval(() => {
      if (state.isPaused || state.isAnimating) return;
      if (state.status !== "playing") return;
      state.timeLeftSeconds -= 1;
      if (state.timeLeftSeconds < 0) state.timeLeftSeconds = 0;
      el.uiTime.textContent = formatTime(state.timeLeftSeconds);
      saveProgress();
      if (state.timeLeftSeconds <= 0) {
        stopTimer();
        gameOver(false);
      }
    }, 1000);
  }

  function gameOver(completed) {
    if (state.status !== "playing") return;
    state.status = "game_over";
    state.isPaused = true;
    stopTimer();
    saveProgress();

    if (completed) playSoundWin();
    else playSoundLose();

    const objective = state.level.target_score > 0 ? `Target score: ${state.level.target_score}` : `Clear: ${state.level.objective_clear}`;
    const body = completed
      ? `You beat the objective in time. Score: ${state.score}.`
      : `Time ran out. Score: ${state.score}. ${objective}`;

    submitScoreToServer(!!completed).finally(() => {
      showModal({
        title: completed ? "Level Complete!" : "Game Over",
        body,
        showNext: false,
        onRestart: () => {
          hideModal();
          clearProgress();
          startLevel(state.levelNumber);
        },
        onExit: () => {
          hideModal();
          state.status = "start";
          state.isPaused = false;
          state.selected = null;
          clearProgress();
          el.screenGame.classList.add("d-none");
          el.screenStart.classList.remove("d-none");
        },
      });
    });
  }

  function maybeCompleteLevel() {
    if (state.status !== "playing") return;
    if (!objectiveSatisfied()) return;
    levelComplete();
  }

  function levelComplete() {
    if (state.status !== "playing") return;
    state.status = "level_complete";
    state.isPaused = true;
    stopTimer();
    saveProgress();

    playSoundWin();

    const targetText =
      state.level.target_score > 0 ? `Target score: ${state.level.target_score}` : `Clear objective: ${state.level.objective_clear}`;
    const body = `Objective complete! ${targetText}. Score: ${state.score}. Candies cleared: ${state.clearedCount}.`;

    submitScoreToServer(true).finally(() => {
      const nextLevel = state.levelNumber + 1;
      const showNext = nextLevel <= MAX_LEVEL;
      showModal({
        title: "Level Complete",
        body,
        showNext,
        onNext: () => {
          hideModal();
          clearProgress();
          startLevel(nextLevel);
        },
        onRestart: () => {
          hideModal();
          clearProgress();
          startLevel(state.levelNumber);
        },
        onExit: () => {
          hideModal();
          state.status = "start";
          state.isPaused = false;
          state.selected = null;
          clearProgress();
          el.screenGame.classList.add("d-none");
          el.screenStart.classList.remove("d-none");
        },
      });
    });
  }

  // ----------------------------
  // Pause / Resume
  // ----------------------------
  function setPaused(paused) {
    state.isPaused = paused;
    el.boardOverlay.classList.toggle("d-none", !paused);
  }

  // ----------------------------
  // Controls
  // ----------------------------
  function pauseGame() {
    if (state.status !== "playing") return;
    setPaused(true);
    playSoundPause(true);
    state.status = "paused";
    saveProgress();
  }

  function resumeGame() {
    if (state.status !== "paused") return;
    state.status = "playing";
    setPaused(false);
    playSoundPause(false);
  }

  async function performHint() {
    if (state.isAnimating || state.isPaused || state.status !== "playing") return;
    clearHintHighlights();
    const best = bestHintMove();
    if (!best) {
      // No hint found: shuffle board to restore options.
      await shuffleCurrentBoard();
      return;
    }
    playSoundHint();
    highlightHintMove(best.r1, best.c1, best.r2, best.c2);
  }

  // ----------------------------
  // Level Startup
  // ----------------------------
  async function fetchLevel(levelNumber) {
    const res = await fetch(`/level/${levelNumber}`);
    if (!res.ok) throw new Error("Failed to load level");
    return res.json();
  }

  function updateObjectiveText() {
    const t = state.level.target_score || 0;
    const c = state.level.objective_clear || 0;
    if (t > 0 && c > 0) {
      el.uiObjective.textContent = `Score >= ${t} and Clear >= ${c}`;
      return;
    }
    if (t > 0) {
      el.uiObjective.textContent = `Reach score: ${t}`;
      return;
    }
    if (c > 0) {
      el.uiObjective.textContent = `Clear ${c} candies`;
      return;
    }
    el.uiObjective.textContent = "Objective";
  }

  async function startLevel(levelNumber, { resumeData = null } = {}) {
    hideModal();
    el.screenStart.classList.add("d-none");
    el.screenGame.classList.remove("d-none");

    state.levelNumber = levelNumber;
    state.status = "playing";
    state.isPaused = false;
    setPaused(false);
    state.selected = null;
    state.isAnimating = false;

    el.uiScore.textContent = "0";
    el.uiLevel.textContent = String(levelNumber);

    const payload = await fetchLevel(levelNumber);
    state.level = payload.level;
    state.config = payload.config;

    // Back-compat: the model public dict already nests scoring.
    state.gridSize = state.config.grid_size || 8;
    updateBoardCssGridSize();

    updateObjectiveText();

    // Seed RNG for this level session (resumes keep the current board).
    state.sessionSeedOffset = Math.floor(Math.random() * 100000);
    state.rng = mulberry32((state.level.pattern_seed || 0) + state.sessionSeedOffset);

    if (resumeData) {
      state.score = resumeData.score || 0;
      state.clearedCount = resumeData.clearedCount || 0;
      state.timeLeftSeconds = resumeData.timeLeftSeconds || state.level.time_limit_seconds;

      el.uiScore.textContent = String(state.score);
      el.uiTime.textContent = formatTime(state.timeLeftSeconds);

      // Restore board and render.
      state.board = deserializeBoard(resumeData.board);
      renderFullBoard(state.board);
    } else {
      state.score = 0;
      state.clearedCount = 0;
      state.timeLeftSeconds = state.level.time_limit_seconds;
      el.uiScore.textContent = "0";
      el.uiTime.textContent = formatTime(state.timeLeftSeconds);

      // Generate a board that is immediately playable.
      state.board = generateBoardForLevel();
      renderFullBoard(state.board);

      // Failsafe: ensure at least one valid move.
      if (!hasAnyValidMove()) {
        await shuffleCurrentBoard();
      }
    }

    state.status = "playing";
    startTimer();
    saveProgress();
  }

  // ----------------------------
  // Game Control Setup
  // ----------------------------
  function initStartScreen() {
    el.startLevel.innerHTML = "";
    for (let i = 1; i <= MAX_LEVEL; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Level ${i}`;
      el.startLevel.appendChild(opt);
    }

    const saved = loadSavedProgress();
    if (saved && saved.levelNumber && saved.timeLeftSeconds > 0 && saved.board) {
      el.btnResume.classList.remove("d-none");
    } else {
      el.btnResume.classList.add("d-none");
    }
  }

  // Bind buttons
  el.btnStart.addEventListener("click", async () => {
    const levelNumber = parseInt(el.startLevel.value, 10) || 1;
    clearProgress();
    await startLevel(levelNumber);
  });

  el.btnResume.addEventListener("click", async () => {
    const saved = loadSavedProgress();
    if (!saved) return;
    clearHintHighlights();
    await startLevel(saved.levelNumber, { resumeData: saved });
  });

  el.btnPause.addEventListener("click", () => pauseGame());
  el.btnResume2.addEventListener("click", () => {
    resumeGame();
  });

  el.btnRestart.addEventListener("click", async () => {
    if (!state.levelNumber) return;
    clearProgress();
    await startLevel(state.levelNumber);
  });

  if (el.btnRestartOverlay) {
    el.btnRestartOverlay.addEventListener("click", async () => {
      if (!state.levelNumber) return;
      clearProgress();
      await startLevel(state.levelNumber);
    });
  }

  el.btnHint.addEventListener("click", async () => {
    await performHint();
  });

  el.btnShuffle.addEventListener("click", async () => {
    await shuffleCurrentBoard();
  });

  el.btnModalRestart.addEventListener("click", () => {});
  el.btnModalExit.addEventListener("click", () => {});

  // When modal buttons are used, we set their handlers dynamically via showModal.
  // ----------------------------
  // Start
  // ----------------------------
  initStartScreen();
})();

