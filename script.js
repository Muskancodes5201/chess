'use strict';
/* =========================================================
   Ivory & Ebony Chess — script.js
   Modular vanilla JS chess engine + UI controller.
   Sections: 1) ChessEngine  2) Sound  3) UI Controller
   ========================================================= */

/* =========================================================
   1) CHESS ENGINE
   board[row][col] -> row 0 = rank 8 ... row 7 = rank 1
   col 0 = file a ... col 7 = file h
   ========================================================= */
class ChessEngine {
  constructor() { this.reset(); }

  reset() {
    this.board = this.createInitialBoard();
    this.turn = 'w';
    this.castling = { wK: true, wQ: true, bK: true, bQ: true };
    this.enPassant = null;        // {row,col} target square
    this.halfmoveClock = 0;
    this.fullmoveNumber = 1;
    this.history = [];            // move objects for undo
    this.redoStack = [];
    this.capturedByWhite = [];    // black pieces captured by white
    this.capturedByBlack = [];
    this.status = 'ongoing';      // ongoing | check | checkmate | stalemate | draw
  }

  createInitialBoard() {
    const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    const b = Array.from({ length: 8 }, () => Array(8).fill(null));
    for (let c = 0; c < 8; c++) {
      b[0][c] = { type: back[c], color: 'b' };
      b[1][c] = { type: 'p', color: 'b' };
      b[6][c] = { type: 'p', color: 'w' };
      b[7][c] = { type: back[c], color: 'w' };
    }
    return b;
  }

  clone() {
    const e = new ChessEngine();
    e.board = this.board.map(row => row.map(p => p ? { ...p } : null));
    e.turn = this.turn;
    e.castling = { ...this.castling };
    e.enPassant = this.enPassant ? { ...this.enPassant } : null;
    e.halfmoveClock = this.halfmoveClock;
    e.fullmoveNumber = this.fullmoveNumber;
    e.history = [];
    e.redoStack = [];
    e.capturedByWhite = [...this.capturedByWhite];
    e.capturedByBlack = [...this.capturedByBlack];
    e.status = this.status;
    return e;
  }

  inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }
  pieceAt(r, c) { return this.board[r][c]; }
  enemyColor(color) { return color === 'w' ? 'b' : 'w'; }

  /* ---------- Pseudo-legal move generation (no king-safety check) ---------- */
  getPseudoMoves(r, c, board = this.board, castling = this.castling, enPassant = this.enPassant) {
    const piece = board[r][c];
    if (!piece) return [];
    const moves = [];
    const dir = piece.color === 'w' ? -1 : 1;
    const addIf = (nr, nc, captureOnly = false, quietOnly = false) => {
      if (!this.inBounds(nr, nc)) return false;
      const target = board[nr][nc];
      if (target) {
        if (target.color !== piece.color && !quietOnly) moves.push({ r: nr, c: nc, capture: true });
        return false; // blocked beyond this
      } else if (!captureOnly) {
        moves.push({ r: nr, c: nc, capture: false });
      }
      return !target; // can continue sliding
    };

    switch (piece.type) {
      case 'p': {
        // forward
        if (this.inBounds(r + dir, c) && !board[r + dir][c]) {
          moves.push({ r: r + dir, c, capture: false });
          const startRow = piece.color === 'w' ? 6 : 1;
          if (r === startRow && !board[r + 2 * dir][c]) {
            moves.push({ r: r + 2 * dir, c, capture: false, doubleStep: true });
          }
        }
        // captures
        for (const dc of [-1, 1]) {
          const nr = r + dir, nc = c + dc;
          if (!this.inBounds(nr, nc)) continue;
          const target = board[nr][nc];
          if (target && target.color !== piece.color) {
            moves.push({ r: nr, c: nc, capture: true });
          } else if (enPassant && enPassant.row === nr && enPassant.col === nc) {
            moves.push({ r: nr, c: nc, capture: true, enPassant: true });
          }
        }
        break;
      }
      case 'n': {
        const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        for (const [dr, dc] of deltas) addIf(r + dr, c + dc);
        break;
      }
      case 'b': this.slide(r, c, board, piece, [[-1,-1],[-1,1],[1,-1],[1,1]], moves); break;
      case 'r': this.slide(r, c, board, piece, [[-1,0],[1,0],[0,-1],[0,1]], moves); break;
      case 'q': this.slide(r, c, board, piece, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]], moves); break;
      case 'k': {
        const deltas = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        for (const [dr, dc] of deltas) addIf(r + dr, c + dc);
        // castling
        const row = piece.color === 'w' ? 7 : 0;
        if (r === row && c === 4) {
          const kSide = piece.color === 'w' ? castling.wK : castling.bK;
          const qSide = piece.color === 'w' ? castling.wQ : castling.bQ;
          if (kSide && !board[row][5] && !board[row][6] && board[row][7]?.type === 'r') {
            moves.push({ r: row, c: 6, capture: false, castle: 'K' });
          }
          if (qSide && !board[row][1] && !board[row][2] && !board[row][3] && board[row][0]?.type === 'r') {
            moves.push({ r: row, c: 2, capture: false, castle: 'Q' });
          }
        }
        break;
      }
    }
    return moves;
  }

  slide(r, c, board, piece, dirs, moves) {
    for (const [dr, dc] of dirs) {
      let nr = r + dr, nc = c + dc;
      while (this.inBounds(nr, nc)) {
        const target = board[nr][nc];
        if (target) {
          if (target.color !== piece.color) moves.push({ r: nr, c: nc, capture: true });
          break;
        }
        moves.push({ r: nr, c: nc, capture: false });
        nr += dr; nc += dc;
      }
    }
  }

  findKing(color, board = this.board) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (p && p.type === 'k' && p.color === color) return { r, c };
    }
    return null;
  }

  isSquareAttacked(r, c, byColor, board = this.board) {
    for (let rr = 0; rr < 8; rr++) {
      for (let cc = 0; cc < 8; cc++) {
        const p = board[rr][cc];
        if (!p || p.color !== byColor) continue;
        if (p.type === 'p') {
          const dir = p.color === 'w' ? -1 : 1;
          if (rr + dir === r && (cc - 1 === c || cc + 1 === c)) return true;
          continue;
        }
        if (p.type === 'k') {
          if (Math.abs(rr - r) <= 1 && Math.abs(cc - c) <= 1) return true;
          continue;
        }
        const pseudo = this.getPseudoMoves(rr, cc, board, this.castling, null);
        if (pseudo.some(m => m.r === r && m.c === c)) return true;
      }
    }
    return false;
  }

  isInCheck(color, board = this.board) {
    const k = this.findKing(color, board);
    if (!k) return false;
    return this.isSquareAttacked(k.r, k.c, this.enemyColor(color), board);
  }

  /* Apply a move to a board copy, return new board + meta (does not mutate state) */
  simulateMove(board, from, move) {
    const b = board.map(row => row.map(p => p ? { ...p } : null));
    const piece = b[from.r][from.c];
    let captured = b[move.r][move.c];
    if (move.enPassant) {
      const capRow = piece.color === 'w' ? move.r + 1 : move.r - 1;
      captured = b[capRow][move.c];
      b[capRow][move.c] = null;
    }
    b[move.r][move.c] = piece;
    b[from.r][from.c] = null;
    if (move.castle === 'K') {
      const row = from.r;
      b[row][5] = b[row][7]; b[row][7] = null;
    } else if (move.castle === 'Q') {
      const row = from.r;
      b[row][3] = b[row][0]; b[row][0] = null;
    }
    if (move.promotion) b[move.r][move.c] = { type: move.promotion, color: piece.color };
    return { board: b, captured };
  }

  /* Get fully legal moves for a square (filters out moves leaving own king in check) */
  getLegalMoves(r, c) {
    const piece = this.board[r][c];
    if (!piece) return [];
    const pseudo = this.getPseudoMoves(r, c, this.board, this.castling, this.enPassant);
    const legal = [];
    for (const m of pseudo) {
      if (m.castle) {
        // king cannot castle through/into check
        const row = r;
        const path = m.castle === 'K' ? [4, 5, 6] : [4, 3, 2];
        const enemy = this.enemyColor(piece.color);
        if (path.some(col => this.isSquareAttacked(row, col, enemy, this.board))) continue;
      }
      const { board: nb } = this.simulateMove(this.board, { r, c }, m);
      if (!this.isInCheck(piece.color, nb)) legal.push(m);
    }
    return legal;
  }

  getAllLegalMoves(color) {
    const all = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = this.board[r][c];
      if (p && p.color === color) {
        const moves = this.getLegalMoves(r, c);
        moves.forEach(m => all.push({ from: { r, c }, ...m }));
      }
    }
    return all;
  }

  squareName(r, c) { return 'abcdefgh'[c] + (8 - r); }

  /* Make a move (mutates engine state). move = {r,c,...flags}; from={r,c} */
  makeMove(from, move, promotionType) {
    const piece = this.board[from.r][from.c];
    if (!piece) return null;
    const targetPiece = this.board[move.r][move.c];
    const isPawn = piece.type === 'p';
    const isCapture = move.capture;
    let promotion = null;
    if (isPawn && (move.r === 0 || move.r === 7)) promotion = promotionType || 'q';

    const fullMove = { ...move, promotion };
    const { board: newBoard, captured } = this.simulateMove(this.board, from, fullMove);

    // Update captured lists
    if (captured) {
      if (piece.color === 'w') this.capturedByWhite.push(captured);
      else this.capturedByBlack.push(captured);
    }

    // Update castling rights
    const castling = { ...this.castling };
    if (piece.type === 'k') {
      if (piece.color === 'w') { castling.wK = false; castling.wQ = false; }
      else { castling.bK = false; castling.bQ = false; }
    }
    if (piece.type === 'r') {
      if (from.r === 7 && from.c === 0) castling.wQ = false;
      if (from.r === 7 && from.c === 7) castling.wK = false;
      if (from.r === 0 && from.c === 0) castling.bQ = false;
      if (from.r === 0 && from.c === 7) castling.bK = false;
    }
    if (move.r === 7 && move.c === 0) castling.wQ = false;
    if (move.r === 7 && move.c === 7) castling.wK = false;
    if (move.r === 0 && move.c === 0) castling.bQ = false;
    if (move.r === 0 && move.c === 7) castling.bK = false;

    // En passant target
    let newEnPassant = null;
    if (isPawn && move.doubleStep) {
      newEnPassant = { row: (from.r + move.r) / 2, col: from.c };
    }

    // SAN-ish notation will be computed by caller before mutation for disambiguation ease;
    // here we record raw data for history.
    const moveRecord = {
      from, to: { r: move.r, c: move.c }, piece: { ...piece }, captured: captured ? { ...captured } : null,
      castle: move.castle || null, enPassant: !!move.enPassant, promotion,
      prevCastling: this.castling, prevEnPassant: this.enPassant,
      prevHalfmove: this.halfmoveClock, boardBefore: this.board
    };

    this.board = newBoard;
    this.castling = castling;
    this.enPassant = newEnPassant;
    this.halfmoveClock = (isPawn || isCapture) ? 0 : this.halfmoveClock + 1;
    if (piece.color === 'b') this.fullmoveNumber++;
    this.turn = this.enemyColor(piece.color);
    this.redoStack = [];
    this.history.push(moveRecord);
    this.updateStatus();
    return moveRecord;
  }

  undo() {
    const rec = this.history.pop();
    if (!rec) return null;
    this.board = rec.boardBefore;
    this.castling = rec.prevCastling;
    this.enPassant = rec.prevEnPassant;
    this.halfmoveClock = rec.prevHalfmove;
    if (rec.piece.color === 'b') this.fullmoveNumber--;
    this.turn = rec.piece.color;
    if (rec.captured) {
      const list = rec.piece.color === 'w' ? this.capturedByWhite : this.capturedByBlack;
      const idx = list.findIndex(p => p.type === rec.captured.type && p.color === rec.captured.color);
      if (idx > -1) list.splice(idx, 1);
    }
    this.redoStack.push(rec);
    this.updateStatus();
    return rec;
  }

  redo() {
    const rec = this.redoStack.pop();
    if (!rec) return null;
    const move = { r: rec.to.r, c: rec.to.c, capture: !!rec.captured, castle: rec.castle, enPassant: rec.enPassant, doubleStep: Math.abs(rec.to.r - rec.from.r) === 2 && rec.piece.type === 'p' };
    this.makeMove(rec.from, move, rec.promotion);
    return rec;
  }

  updateStatus() {
    const color = this.turn;
    const inCheck = this.isInCheck(color);
    const legal = this.getAllLegalMoves(color);
    if (legal.length === 0) {
      this.status = inCheck ? 'checkmate' : 'stalemate';
    } else if (this.halfmoveClock >= 100) {
      this.status = 'draw';
    } else if (inCheck) {
      this.status = 'check';
    } else {
      this.status = 'ongoing';
    }
  }

  /* Convert a move record into SAN-ish algebraic string */
  toSAN(rec, wasCheck, wasMate) {
    if (rec.castle === 'K') return wasMate ? 'O-O#' : wasCheck ? 'O-O+' : 'O-O';
    if (rec.castle === 'Q') return wasMate ? 'O-O-O#' : wasCheck ? 'O-O-O+' : 'O-O-O';
    const letters = { p: '', n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
    let san = letters[rec.piece.type];
    const fromSq = this.squareName(rec.from.r, rec.from.c);
    const toSq = this.squareName(rec.to.r, rec.to.c);
    if (rec.piece.type === 'p') {
      if (rec.captured || rec.enPassant) san += fromSq[0] + 'x' + toSq;
      else san += toSq;
      if (rec.promotion) san += '=' + letters[rec.promotion].toUpperCase();
    } else {
      if (rec.captured) san += 'x';
      san += toSq;
    }
    if (wasMate) san += '#'; else if (wasCheck) san += '+';
    return san;
  }
}

/* =========================================================
   2) SIMPLE AI (minimax with alpha-beta, depth scales with difficulty)
   ========================================================= */
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const PST_PAWN = [
  0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10,
  5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5,
  5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0
];

function evaluateBoard(engine) {
  let score = 0;
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = engine.board[r][c];
    if (!p) continue;
    let val = PIECE_VALUES[p.type];
    if (p.type === 'p') {
      const idx = p.color === 'w' ? r * 8 + c : (7 - r) * 8 + c;
      val += PST_PAWN[idx] * 0.5;
    }
    score += p.color === 'w' ? val : -val;
  }
  return score;
}

function minimax(engine, depth, alpha, beta, maximizing) {
  if (depth === 0 || engine.status === 'checkmate' || engine.status === 'stalemate') {
    if (engine.status === 'checkmate') return maximizing ? -99999 + depth : 99999 - depth;
    if (engine.status === 'stalemate') return 0;
    return evaluateBoard(engine);
  }
  const color = maximizing ? 'w' : 'b';
  const moves = engine.getAllLegalMoves(color);
  if (moves.length === 0) return evaluateBoard(engine);
  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      const clone = engine.clone();
      clone.makeMove(m.from, m);
      best = Math.max(best, minimax(clone, depth - 1, alpha, beta, false));
      alpha = Math.max(alpha, best);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      const clone = engine.clone();
      clone.makeMove(m.from, m);
      best = Math.min(best, minimax(clone, depth - 1, alpha, beta, true));
      beta = Math.min(beta, best);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function getAIMove(engine, difficulty) {
  const color = engine.turn;
  const moves = engine.getAllLegalMoves(color);
  if (moves.length === 0) return null;
  if (difficulty === 'easy') {
    // 70% random, 30% best-1-ply (captures preferred)
    const captures = moves.filter(m => m.capture);
    if (Math.random() < 0.3 && captures.length) return captures[Math.floor(Math.random() * captures.length)];
    return moves[Math.floor(Math.random() * moves.length)];
  }
  const depth = difficulty === 'hard' ? 3 : 2;
  const maximizing = color === 'w';
  let bestMove = moves[0], bestScore = maximizing ? -Infinity : Infinity;
  // shuffle for variety among equal-score moves
  const shuffled = [...moves].sort(() => Math.random() - 0.5);
  for (const m of shuffled) {
    const clone = engine.clone();
    clone.makeMove(m.from, m);
    const score = minimax(clone, depth - 1, -Infinity, Infinity, !maximizing);
    if (maximizing ? score > bestScore : score < bestScore) { bestScore = score; bestMove = m; }
  }
  return bestMove;
}

/* =========================================================
   3) SOUND ENGINE (WebAudio synthesized beeps — zero asset files)
   ========================================================= */
class SoundEngine {
  constructor() { this.enabled = true; this.ctx = null; }
  getCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    }
    return this.ctx;
  }
  beep(freq, duration, type = 'sine', gainVal = 0.15) {
    if (!this.enabled) return;
    try {
      const ctx = this.getCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.value = gainVal;
      osc.connect(gain); gain.connect(ctx.destination);
      const now = ctx.currentTime;
      gain.gain.setValueAtTime(gainVal, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.start(now); osc.stop(now + duration);
    } catch (e) { /* audio not available */ }
  }
  move() { this.beep(440, 0.1); }
  capture() { this.beep(300, 0.12, 'square', 0.1); }
  check() { this.beep(600, 0.18, 'triangle'); }
  checkmate() { this.beep(200, 0.4, 'sawtooth', 0.12); }
  victory() { [523, 659, 784].forEach((f, i) => setTimeout(() => this.beep(f, 0.25), i * 150)); }
}

/* =========================================================
   4) UI CONTROLLER
   ========================================================= */
const PIECE_GLYPHS = {
  w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
  b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
};

const App = {
  engine: new ChessEngine(),
  sound: new SoundEngine(),
  flipped: false,
  selected: null,
  legalForSelected: [],
  mode: 'pvp',
  difficulty: 'easy',
  timeControl: 5,
  clocks: { w: 300, b: 300 },
  timerInterval: null,
  paused: false,
  players: { w: 'Player One', b: 'Player Two' },
  settings: { sound: true, animations: true, theme: 'classic', boardSize: 'medium' },
  gameStartTime: null,
  gameActive: false,

  /* ---------- Init ---------- */
  init() {
    this.loadSettings();
    this.applySettings();
    this.bindNav();
    this.bindSetup();
    this.bindControls();
    this.bindModals();
    this.bindMisc();
    this.renderStats();
    document.getElementById('footerYear').textContent = new Date().getFullYear();
    window.addEventListener('load', () => {
      setTimeout(() => document.getElementById('loadingScreen').classList.add('hidden'), 400);
    });
    setTimeout(() => document.getElementById('loadingScreen')?.classList.add('hidden'), 1500);
  },

  /* ---------- Local Storage helpers ---------- */
  loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem('chess_settings'));
      if (s) this.settings = { ...this.settings, ...s };
    } catch (e) {}
  },
  saveSettings() { localStorage.setItem('chess_settings', JSON.stringify(this.settings)); },
  getStats() {
    try {
      return JSON.parse(localStorage.getItem('chess_stats')) || { games: 0, wins: 0, losses: 0, draws: 0, longest: 0, fastestWinSec: null };
    } catch (e) { return { games: 0, wins: 0, losses: 0, draws: 0, longest: 0, fastestWinSec: null }; }
  },
  saveStats(stats) { localStorage.setItem('chess_stats', JSON.stringify(stats)); },

  applySettings() {
    document.body.setAttribute('data-theme', this.resolveTheme());
    document.body.setAttribute('data-board-size', this.settings.boardSize);
    document.getElementById('soundSetting').checked = this.settings.sound;
    document.getElementById('animSetting').checked = this.settings.animations;
    document.getElementById('themeSelect').value = this.settings.theme;
    document.getElementById('boardSizeSelect').value = this.settings.boardSize;
    this.sound.enabled = this.settings.sound;
    document.getElementById('muteToggle').textContent = this.settings.sound ? '🔊' : '🔇';
    document.getElementById('muteToggle').setAttribute('aria-pressed', String(!this.settings.sound));
    document.getElementById('chessBoard')?.classList.toggle('no-anim', !this.settings.animations);
  },
  resolveTheme() {
    if (this.settings.theme === 'auto') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'classic';
    }
    return this.settings.theme;
  },

  /* ---------- Navigation ---------- */
  bindNav() {
    const hamburger = document.getElementById('navHamburger');
    const links = document.getElementById('navLinks');
    hamburger.addEventListener('click', () => {
      const open = links.classList.toggle('open');
      hamburger.setAttribute('aria-expanded', String(open));
    });
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => links.classList.remove('open')));

    document.getElementById('muteToggle').addEventListener('click', () => {
      this.settings.sound = !this.settings.sound;
      this.saveSettings(); this.applySettings();
    });

    window.addEventListener('scroll', () => {
      document.getElementById('scrollTopBtn').hidden = window.scrollY < 400;
    });
    document.getElementById('scrollTopBtn').addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

    // Ripple effect on all .ripple buttons
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.ripple');
      if (!btn) return;
      const circle = document.createElement('span');
      circle.className = 'ripple-circle';
      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height);
      circle.style.width = circle.style.height = size + 'px';
      circle.style.left = (e.clientX - rect.left - size / 2) + 'px';
      circle.style.top = (e.clientY - rect.top - size / 2) + 'px';
      btn.appendChild(circle);
      setTimeout(() => circle.remove(), 650);
    });
  },

  /* ---------- Setup screen ---------- */
  bindSetup() {
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-mode]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
        btn.classList.add('active'); btn.setAttribute('aria-checked', 'true');
        this.mode = btn.dataset.mode;
        document.getElementById('difficultyRow').hidden = this.mode !== 'pvc';
        document.getElementById('p2Label').firstChild.textContent = this.mode === 'pvc' ? 'Computer' : 'Player 2 (Black)';
        document.getElementById('p2Name').disabled = this.mode === 'pvc';
        if (this.mode === 'pvc') document.getElementById('p2Name').value = 'Computer';
      });
    });
    document.querySelectorAll('[data-diff]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-diff]').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-checked', 'false'); });
        btn.classList.add('active'); btn.setAttribute('aria-checked', 'true');
        this.difficulty = btn.dataset.diff;
      });
    });
    document.querySelectorAll('[data-time]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-time]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.timeControl = parseInt(btn.dataset.time, 10);
      });
    });
    document.getElementById('startGameBtn').addEventListener('click', () => this.startGame());
    document.getElementById('loadGameBtn').addEventListener('click', () => this.loadGame());
  },

  startGame() {
    this.players.w = document.getElementById('p1Name').value.trim() || 'Player One';
    this.players.b = document.getElementById('p2Name').value.trim() || (this.mode === 'pvc' ? 'Computer' : 'Player Two');
    this.engine.reset();
    this.flipped = false;
    this.selected = null;
    this.legalForSelected = [];
    this.clocks.w = this.clocks.b = this.timeControl * 60;
    this.paused = false;
    this.gameStartTime = Date.now();
    this.gameActive = true;
    document.getElementById('gameSetup').hidden = true;
    document.getElementById('gameArea').hidden = false;
    document.getElementById('gameOverOverlay').hidden = true;
    this.updatePlayerLabels();
    this.renderBoard();
    this.renderCoords();
    this.updateStatusBar();
    this.renderMoveList();
    this.startTimer();
    document.getElementById('play').scrollIntoView({ behavior: 'smooth', block: 'start' });
    this.toast('New game started — good luck!');
  },

  loadGame() {
    const raw = localStorage.getItem('chess_save');
    if (!raw) { this.toast('No saved game found.'); return; }
    try {
      const data = JSON.parse(raw);
      this.engine.reset();
      this.engine.board = data.board;
      this.engine.turn = data.turn;
      this.engine.castling = data.castling;
      this.engine.enPassant = data.enPassant;
      this.engine.halfmoveClock = data.halfmoveClock;
      this.engine.fullmoveNumber = data.fullmoveNumber;
      this.engine.capturedByWhite = data.capturedByWhite;
      this.engine.capturedByBlack = data.capturedByBlack;
      this.engine.history = data.history.map(h => ({ ...h, boardBefore: h.boardBefore }));
      this.engine.updateStatus();
      this.players = data.players;
      this.clocks = data.clocks;
      this.mode = data.mode || 'pvp';
      this.timeControl = data.timeControl || 5;
      this.flipped = data.flipped || false;
      this.gameActive = true;
      this.paused = false;
      document.getElementById('gameSetup').hidden = true;
      document.getElementById('gameArea').hidden = false;
      document.getElementById('gameOverOverlay').hidden = true;
      this.updatePlayerLabels();
      this.renderBoard();
      this.renderCoords();
      this.updateStatusBar();
      this.renderMoveList();
      this.startTimer();
      this.toast('Saved game loaded.');
    } catch (e) { this.toast('Could not load saved game.'); }
  },

  updatePlayerLabels() {
    document.getElementById('playerTopName').textContent = this.players.b;
    document.getElementById('playerBottomName').textContent = this.players.w;
    document.getElementById('playerTopStatus').textContent = 'Black';
    document.getElementById('playerBottomStatus').textContent = 'White';
  },

  /* ---------- Board rendering ---------- */
  renderCoords() {
    const files = 'abcdefgh'.split('');
    const filesOrdered = this.flipped ? [...files].reverse() : files;
    const ranksOrdered = this.flipped ? [1,2,3,4,5,6,7,8] : [8,7,6,5,4,3,2,1];
    ['filesTop', 'filesBottom'].forEach(id => {
      document.getElementById(id).innerHTML = filesOrdered.map(f => `<span>${f}</span>`).join('');
    });
    ['ranksLeft', 'ranksRight'].forEach(id => {
      document.getElementById(id).innerHTML = ranksOrdered.map(r => `<span>${r}</span>`).join('');
    });
  },

  boardCoordToDisplay(r, c) {
    return this.flipped ? { r: 7 - r, c: 7 - c } : { r, c };
  },
  displayToBoardCoord(r, c) {
    return this.flipped ? { r: 7 - r, c: 7 - c } : { r, c };
  },

  renderBoard() {
    const boardEl = document.getElementById('chessBoard');
    boardEl.innerHTML = '';
    boardEl.classList.toggle('no-anim', !this.settings.animations);
    const lastMove = this.engine.history[this.engine.history.length - 1];
    const inCheckColor = (this.engine.status === 'check' || this.engine.status === 'checkmate') ? this.engine.turn : null;
    const kingPos = inCheckColor ? this.engine.findKing(inCheckColor) : null;

    for (let dr = 0; dr < 8; dr++) {
      for (let dc = 0; dc < 8; dc++) {
        const { r, c } = this.displayToBoardCoord(dr, dc);
        const piece = this.engine.board[r][c];
        const sq = document.createElement('div');
        sq.className = 'square ' + (((r + c) % 2 === 0) ? 'light' : 'dark');
        sq.dataset.r = r; sq.dataset.c = c;
        sq.setAttribute('role', 'gridcell');
        sq.setAttribute('aria-label', this.engine.squareName(r, c));
        if (lastMove && ((lastMove.from.r === r && lastMove.from.c === c) || (lastMove.to.r === r && lastMove.to.c === c))) {
          sq.classList.add('last-move');
        }
        if (kingPos && kingPos.r === r && kingPos.c === c) sq.classList.add('in-check');
        if (this.selected && this.selected.r === r && this.selected.c === c) sq.classList.add('selected');

        if (piece) {
          const span = document.createElement('span');
          span.className = 'piece ' + (piece.color === 'w' ? 'white-piece' : 'black-piece');
          span.textContent = PIECE_GLYPHS[piece.color][piece.type];
          span.setAttribute('aria-hidden', 'true');
          span.draggable = false;
          sq.appendChild(span);
        }
        const moveHere = this.legalForSelected.find(m => m.r === r && m.c === c);
        if (moveHere) {
          const marker = document.createElement('span');
          marker.className = moveHere.capture ? 'capture-ring' : 'move-dot';
          sq.appendChild(marker);
        }
        sq.addEventListener('click', () => this.onSquareClick(r, c));
        boardEl.appendChild(sq);
      }
    }
    this.renderCaptured();
    document.getElementById('playerTopCard').classList.toggle('active-turn', this.engine.turn === 'b');
    document.getElementById('playerBottomCard').classList.toggle('active-turn', this.engine.turn === 'w');
  },

  renderCaptured() {
    const byWhite = document.getElementById('capturedByWhite');
    const byBlack = document.getElementById('capturedByBlack');
    byWhite.innerHTML = this.engine.capturedByWhite.map(p => `<span>${PIECE_GLYPHS.b[p.type]}</span>`).join('');
    byBlack.innerHTML = this.engine.capturedByBlack.map(p => `<span>${PIECE_GLYPHS.w[p.type]}</span>`).join('');
  },

  /* ---------- Interaction ---------- */
  onSquareClick(r, c) {
    if (!this.gameActive || this.paused) return;
    if (this.engine.status === 'checkmate' || this.engine.status === 'stalemate' || this.engine.status === 'draw') return;
    if (this.mode === 'pvc' && this.engine.turn === 'b') return; // computer's turn

    const piece = this.engine.board[r][c];
    if (this.selected) {
      const move = this.legalForSelected.find(m => m.r === r && m.c === c);
      if (move) {
        this.executeMove(this.selected, move);
        return;
      }
      if (piece && piece.color === this.engine.turn) {
        this.selectSquare(r, c);
      } else {
        this.selected = null; this.legalForSelected = []; this.renderBoard();
      }
      return;
    }
    if (piece && piece.color === this.engine.turn) this.selectSquare(r, c);
  },

  selectSquare(r, c) {
    this.selected = { r, c };
    this.legalForSelected = this.engine.getLegalMoves(r, c);
    this.renderBoard();
  },

  async executeMove(from, move) {
    const piece = this.engine.board[from.r][from.c];
    let promotionType = null;
    if (piece.type === 'p' && (move.r === 0 || move.r === 7)) {
      promotionType = await this.askPromotion(piece.color);
    }
    const rec = this.engine.makeMove(from, move, promotionType);
    this.selected = null; this.legalForSelected = [];
    this.afterMove(rec);
  },

  afterMove(rec) {
    const wasCheck = this.engine.status === 'check' || this.engine.status === 'checkmate';
    const wasMate = this.engine.status === 'checkmate';
    rec.san = this.engine.toSAN(rec, wasCheck, wasMate);
    this.renderBoard();
    this.renderMoveList();
    this.updateStatusBar();

    if (rec.captured) this.sound.capture(); else this.sound.move();
    if (wasMate) this.sound.checkmate();
    else if (wasCheck) this.sound.check();

    this.checkGameEnd();

    if (this.gameActive && this.mode === 'pvc' && this.engine.turn === 'b' &&
        !['checkmate', 'stalemate', 'draw'].includes(this.engine.status)) {
      this.paused = true; // prevent input race
      setTimeout(() => this.makeAIMove(), 500);
    }
  },

  makeAIMove() {
    this.paused = false;
    if (!this.gameActive) return;
    const move = getAIMove(this.engine, this.difficulty);
    if (!move) return;
    const rec = this.engine.makeMove(move.from, move, 'q');
    this.afterMove(rec);
  },

  async askPromotion(color) {
    return new Promise(resolve => {
      const modal = document.getElementById('promotionModal');
      const opts = document.getElementById('promoOptions');
      opts.innerHTML = '';
      ['q', 'r', 'b', 'n'].forEach(type => {
        const btn = document.createElement('button');
        btn.textContent = PIECE_GLYPHS[color][type];
        btn.setAttribute('aria-label', 'Promote to ' + type);
        btn.addEventListener('click', () => { modal.hidden = true; resolve(type); });
        opts.appendChild(btn);
      });
      modal.hidden = false;
    });
  },

  updateStatusBar() {
    const turnText = this.engine.turn === 'w' ? `${this.players.w} (White) to move` : `${this.players.b} (Black) to move`;
    document.getElementById('turnIndicator').textContent =
      this.engine.status === 'checkmate' ? 'Checkmate!' :
      this.engine.status === 'stalemate' ? 'Stalemate' :
      this.engine.status === 'draw' ? 'Draw' :
      this.engine.status === 'check' ? turnText + ' — Check!' : turnText;
    const last = this.engine.history[this.engine.history.length - 1];
    document.getElementById('lastMoveText').textContent = 'Last move: ' + (last ? last.san : '—');
    document.getElementById('moveCountText').textContent = 'Moves: ' + this.engine.history.length;
  },

  renderMoveList() {
    const list = document.getElementById('moveList');
    list.innerHTML = '';
    const h = this.engine.history;
    for (let i = 0; i < h.length; i += 2) {
      const li = document.createElement('li');
      const num = document.createElement('span'); num.className = 'move-num'; num.textContent = (i / 2 + 1) + '.';
      const w = document.createElement('span'); w.className = 'move-san'; w.textContent = h[i]?.san || '';
      const b = document.createElement('span'); b.className = 'move-san'; b.textContent = h[i + 1]?.san || '';
      if (i === h.length - 1 || i + 1 === h.length - 1) {
        (h.length - 1 === i ? w : b).classList.add('current');
      }
      li.append(num, w, b);
      list.appendChild(li);
    }
    list.scrollTop = list.scrollHeight;
  },

  checkGameEnd() {
    const status = this.engine.status;
    if (status === 'checkmate' || status === 'stalemate' || status === 'draw') {
      this.gameActive = false;
      this.stopTimer();
      const overlay = document.getElementById('gameOverOverlay');
      const title = document.getElementById('gameOverTitle');
      const msg = document.getElementById('gameOverMsg');
      let winner = null;
      if (status === 'checkmate') {
        winner = this.engine.turn === 'w' ? 'b' : 'w';
        title.textContent = 'Checkmate';
        msg.textContent = `${this.players[winner]} wins!`;
        this.sound.victory();
      } else if (status === 'stalemate') {
        title.textContent = 'Stalemate'; msg.textContent = 'The game is a draw.';
      } else {
        title.textContent = 'Draw'; msg.textContent = 'Draw by the fifty-move rule.';
      }
      overlay.hidden = false;
      this.recordStats(winner);
    }
  },

  recordStats(winnerColor) {
    if (this.mode !== 'pvc') {
      // For PvP we still log generic stats from White's perspective is ambiguous; record neutrally.
    }
    const stats = this.getStats();
    stats.games++;
    const moves = this.engine.history.length;
    stats.longest = Math.max(stats.longest, moves);
    if (winnerColor === null) {
      stats.draws++;
    } else if (this.mode === 'pvc') {
      if (winnerColor === 'w') {
        stats.wins++;
        const elapsed = Math.round((Date.now() - this.gameStartTime) / 1000);
        if (stats.fastestWinSec === null || elapsed < stats.fastestWinSec) stats.fastestWinSec = elapsed;
      } else {
        stats.losses++;
      }
    } else {
      stats.wins++; // PvP: count as a completed win for engagement tracking
    }
    this.saveStats(stats);
    this.renderStats();
  },

  renderStats() {
    const s = this.getStats();
    document.getElementById('statGames').textContent = s.games;
    document.getElementById('statWins').textContent = s.wins;
    document.getElementById('statLosses').textContent = s.losses;
    document.getElementById('statDraws').textContent = s.draws;
    document.getElementById('statWinPct').textContent = s.games ? Math.round((s.wins / s.games) * 100) + '%' : '0%';
    document.getElementById('statLongest').textContent = s.longest;
    document.getElementById('statFastest').textContent = s.fastestWinSec ? `${Math.floor(s.fastestWinSec / 60)}m ${s.fastestWinSec % 60}s` : '—';
  },

  /* ---------- Timer ---------- */
  startTimer() {
    this.stopTimer();
    this.updateClockDisplay();
    if (this.timeControl === 0) return;
    this.timerInterval = setInterval(() => {
      if (this.paused || !this.gameActive) return;
      this.clocks[this.engine.turn]--;
      if (this.clocks[this.engine.turn] <= 0) {
        this.clocks[this.engine.turn] = 0;
        this.updateClockDisplay();
        this.timeOut(this.engine.turn);
        return;
      }
      this.updateClockDisplay();
    }, 1000);
  },
  stopTimer() { if (this.timerInterval) clearInterval(this.timerInterval); this.timerInterval = null; },
  updateClockDisplay() {
    const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    const wEl = document.getElementById('clockWhite'), bEl = document.getElementById('clockBlack');
    wEl.textContent = fmt(this.clocks.w);
    bEl.textContent = fmt(this.clocks.b);
    wEl.classList.toggle('low-time', this.clocks.w <= 30 && this.timeControl > 0);
    bEl.classList.toggle('low-time', this.clocks.b <= 30 && this.timeControl > 0);
  },
  timeOut(color) {
    this.gameActive = false;
    this.stopTimer();
    const winner = color === 'w' ? 'b' : 'w';
    document.getElementById('gameOverTitle').textContent = 'Time Out';
    document.getElementById('gameOverMsg').textContent = `${this.players[color]} ran out of time. ${this.players[winner]} wins!`;
    document.getElementById('gameOverOverlay').hidden = false;
    this.sound.checkmate();
    this.recordStats(winner);
  },

  /* ---------- Controls ---------- */
  bindControls() {
    document.getElementById('btnNewGame').addEventListener('click', () => this.confirmAction('Start a new game? Current progress will be lost.', () => {
      this.stopTimer();
      document.getElementById('gameArea').hidden = true;
      document.getElementById('gameSetup').hidden = false;
      this.gameActive = false;
    }));
    document.getElementById('btnRestart').addEventListener('click', () => this.confirmAction('Restart this game from the beginning?', () => this.startGame()));
    document.getElementById('btnUndo').addEventListener('click', () => {
      if (!this.engine.history.length) return;
      this.engine.undo();
      if (this.mode === 'pvc' && this.engine.history.length && this.engine.turn === 'b') this.engine.undo();
      this.selected = null; this.legalForSelected = [];
      this.renderBoard(); this.renderMoveList(); this.updateStatusBar();
      this.gameActive = true;
      document.getElementById('gameOverOverlay').hidden = true;
    });
    document.getElementById('btnRedo').addEventListener('click', () => {
      if (!this.engine.redoStack.length) return;
      this.engine.redo();
      this.renderBoard(); this.renderMoveList(); this.updateStatusBar();
    });
    document.getElementById('btnFlip').addEventListener('click', () => {
      this.flipped = !this.flipped;
      this.renderBoard(); this.renderCoords();
    });
    document.getElementById('btnHint').addEventListener('click', () => this.showHint());
    document.getElementById('btnPause').addEventListener('click', () => this.togglePause());
    document.getElementById('resumeBtn').addEventListener('click', () => this.togglePause());
    document.getElementById('btnSave').addEventListener('click', () => this.saveGame());
    document.getElementById('btnExportPgn').addEventListener('click', () => this.exportPGN());
    document.getElementById('btnImportPgn').addEventListener('click', () => {
      document.getElementById('pgnTextarea').value = '';
      document.getElementById('pgnConfirmBtn').textContent = 'Import';
      document.getElementById('pgnModal').hidden = false;
    });
    document.getElementById('btnSidebar').addEventListener('click', () => document.getElementById('historySidebar').classList.toggle('open'));
    document.getElementById('closeSidebar').addEventListener('click', () => document.getElementById('historySidebar').classList.remove('open'));
    document.getElementById('overlayNewGame').addEventListener('click', () => {
      document.getElementById('gameOverOverlay').hidden = true;
      document.getElementById('gameArea').hidden = true;
      document.getElementById('gameSetup').hidden = false;
    });
    document.getElementById('overlayClose').addEventListener('click', () => { document.getElementById('gameOverOverlay').hidden = true; });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (!this.gameActive && e.key !== 'Escape') return;
      if (e.key === 'ArrowLeft') document.getElementById('btnUndo').click();
      if (e.key === 'ArrowRight') document.getElementById('btnRedo').click();
      if (e.key.toLowerCase() === 'f') document.getElementById('btnFlip').click();
      if (e.key === ' ') { e.preventDefault(); document.getElementById('btnPause').click(); }
      if (e.key === 'Escape') { this.selected = null; this.legalForSelected = []; this.renderBoard(); }
    });
  },

  togglePause() {
    if (!this.gameActive) return;
    this.paused = !this.paused;
    document.getElementById('pauseOverlay').hidden = !this.paused;
    document.getElementById('btnPause').textContent = this.paused ? '▶ Resume' : '⏸ Pause';
  },

  showHint() {
    if (!this.gameActive || this.engine.status === 'checkmate') return;
    const move = getAIMove(this.engine, 'hard');
    if (!move) return;
    this.selected = move.from;
    this.legalForSelected = this.engine.getLegalMoves(move.from.r, move.from.c);
    this.renderBoard();
    this.toast(`Hint: try ${this.engine.squareName(move.from.r, move.from.c)} → ${this.engine.squareName(move.r, move.c)}`);
  },

  saveGame() {
    const data = {
      board: this.engine.board, turn: this.engine.turn, castling: this.engine.castling,
      enPassant: this.engine.enPassant, halfmoveClock: this.engine.halfmoveClock,
      fullmoveNumber: this.engine.fullmoveNumber, capturedByWhite: this.engine.capturedByWhite,
      capturedByBlack: this.engine.capturedByBlack, history: this.engine.history,
      players: this.players, clocks: this.clocks, mode: this.mode, timeControl: this.timeControl, flipped: this.flipped
    };
    try {
      localStorage.setItem('chess_save', JSON.stringify(data));
      this.toast('Game saved locally.');
    } catch (e) { this.toast('Could not save game.'); }
  },

  exportPGN() {
    const h = this.engine.history;
    let pgn = `[Event "Casual Game"]\n[White "${this.players.w}"]\n[Black "${this.players.b}"]\n[Result "*"]\n\n`;
    for (let i = 0; i < h.length; i += 2) {
      pgn += `${i / 2 + 1}. ${h[i]?.san || ''} ${h[i + 1]?.san || ''} `;
    }
    document.getElementById('pgnTextarea').value = pgn.trim();
    document.getElementById('pgnConfirmBtn').textContent = 'Copy to Clipboard';
    document.getElementById('pgnModal').hidden = false;
    document.getElementById('pgnConfirmBtn').onclick = () => {
      navigator.clipboard?.writeText(pgn.trim()).then(() => this.toast('PGN copied to clipboard.'));
    };
  },

  /* ---------- Modals / misc ---------- */
  bindModals() {
    document.getElementById('pgnCloseBtn').addEventListener('click', () => { document.getElementById('pgnModal').hidden = true; this.resetPgnImportBtn(); });
    document.getElementById('confirmNo').addEventListener('click', () => document.getElementById('confirmModal').hidden = true);
  },
  resetPgnImportBtn() {
    document.getElementById('pgnConfirmBtn').textContent = 'Import';
    document.getElementById('pgnConfirmBtn').onclick = () => this.importPGN();
  },
  importPGN() {
    const raw = document.getElementById('pgnTextarea').value;
    const movesText = raw.replace(/\[[^\]]*\]/g, '').replace(/\d+\./g, '').replace(/\*|1-0|0-1|1\/2-1\/2/g, '').trim();
    if (!movesText) { this.toast('No moves found in PGN.'); return; }
    const sanTokens = movesText.split(/\s+/).filter(Boolean);
    this.engine.reset();
    for (const san of sanTokens) {
      const ok = this.applySAN(san);
      if (!ok) { this.toast('PGN import stopped — could not parse "' + san + '".'); break; }
    }
    document.getElementById('pgnModal').hidden = true;
    this.gameActive = true;
    document.getElementById('gameSetup').hidden = true;
    document.getElementById('gameArea').hidden = false;
    this.renderBoard(); this.renderCoords(); this.renderMoveList(); this.updateStatusBar();
    this.toast('PGN imported.');
  },
  applySAN(san) {
    const clean = san.replace(/[+#]/, '');
    const color = this.engine.turn;
    if (clean === 'O-O' || clean === 'O-O-O') {
      const row = color === 'w' ? 7 : 0;
      const moves = this.engine.getLegalMoves(row, 4);
      const m = moves.find(mv => mv.castle === (clean === 'O-O' ? 'K' : 'Q'));
      if (!m) return false;
      this.engine.makeMove({ r: row, c: 4 }, m);
      return true;
    }
    const promoMatch = clean.match(/=([QRBN])$/);
    const promotion = promoMatch ? promoMatch[1].toLowerCase() : null;
    const core = clean.replace(/=([QRBN])$/, '');
    const pieceLetterMatch = core.match(/^[KQRBN]/);
    const pieceType = pieceLetterMatch ? pieceLetterMatch[0].toLowerCase() : 'p';
    const destMatch = core.match(/([a-h][1-8])$/);
    if (!destMatch) return false;
    const dest = destMatch[1];
    const destCol = 'abcdefgh'.indexOf(dest[0]);
    const destRow = 8 - parseInt(dest[1], 10);
    // disambiguation chars between piece letter and destination
    let disamb = core.slice(pieceLetterMatch ? 1 : 0, core.length - 2).replace('x', '');
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = this.engine.board[r][c];
      if (!p || p.color !== color || p.type !== pieceType) continue;
      if (disamb) {
        if (/[a-h]/.test(disamb) && 'abcdefgh'[c] !== disamb[0]) continue;
        if (/[1-8]/.test(disamb) && String(8 - r) !== disamb.replace(/[a-h]/, '')) continue;
      }
      const moves = this.engine.getLegalMoves(r, c);
      const m = moves.find(mv => mv.r === destRow && mv.c === destCol);
      if (m) { this.engine.makeMove({ r, c }, m, promotion); return true; }
    }
    return false;
  },

  confirmAction(message, onYes) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmMsg').textContent = message;
    modal.hidden = false;
    const yesBtn = document.getElementById('confirmYes');
    const handler = () => { modal.hidden = true; yesBtn.removeEventListener('click', handler); onYes(); };
    yesBtn.addEventListener('click', handler);
  },

  toast(message) {
    const container = document.getElementById('toastContainer');
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = message;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  },

  bindMisc() {
    document.getElementById('soundSetting').addEventListener('change', (e) => { this.settings.sound = e.target.checked; this.saveSettings(); this.applySettings(); });
    document.getElementById('animSetting').addEventListener('change', (e) => { this.settings.animations = e.target.checked; this.saveSettings(); this.applySettings(); });
    document.getElementById('themeSelect').addEventListener('change', (e) => { this.settings.theme = e.target.value; this.saveSettings(); this.applySettings(); });
    document.getElementById('boardSizeSelect').addEventListener('change', (e) => { this.settings.boardSize = e.target.value; this.saveSettings(); this.applySettings(); });
    document.getElementById('resetSettingsBtn').addEventListener('click', () => {
      this.settings = { sound: true, animations: true, theme: 'classic', boardSize: 'medium' };
      this.saveSettings(); this.applySettings();
      this.toast('Settings reset to default.');
    });
    document.getElementById('resetStatsBtn').addEventListener('click', () => this.confirmAction('Reset all statistics? This cannot be undone.', () => {
      localStorage.removeItem('chess_stats');
      this.renderStats();
      this.toast('Statistics reset.');
    }));
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
