// solver.js — exhaustive best-move search for a batch of up to 3 pieces.
//
// Algorithm: try every ordering of the given pieces (up to 3! = 6), and for
// each ordering, exhaustively try every legal (row, col) for piece 1, then
// every legal (row, col) for piece 2 on the resulting board, then piece 3.
// Upper bound ~6 * 64^3 ~= 1.5M leaf placements, which is cheap on a
// bitboard. No heuristic pruning is applied to the legal search space
// itself — the only branches skipped are ones where a piece literally has
// zero legal placements on the current board, which can never lead to a
// complete (all pieces placed) solution anyway.
//
// Pieces are placed EXACTLY as given (see js/pieces.js) — this file never
// rotates a piece while searching.
import { PIECES } from "./pieces.js";
import { canPlace, place, clearLines, cloneBoard, isFilled } from "./board.js";

// Approximate scoring model — NOT Block Blast's official formula.
// Deliberately simple so it can be recalibrated in one place. The relative
// ranking between candidate moves stays meaningful even if the absolute
// numbers differ from the real game's scoring.
export const SCORING = {
  // Points for placing a piece, before any line clears.
  placementPoints(piece) {
    return piece.size;
  },
  // Points for clearing k lines (rows + columns) at once.
  clearPoints(k) {
    return (10 * k * (k + 1)) / 2;
  },
  // Multiplier applied to clearPoints based on the current combo streak.
  // The streak increments after every placement that clears at least one
  // line, and resets to 0 after a placement that clears nothing. Each solve
  // starts the streak fresh at 0 (the real game's ongoing combo state is
  // not known to the solver).
  comboMultiplier(comboStreak) {
    return 1 + 0.5 * comboStreak;
  },
};

// Final ranking weights. Score dominates by design (1000x); survivability
// and isolated holes only separate candidates whose score is tied.
const SCORE_WEIGHT = 1000;
const SURVIVABILITY_WEIGHT = 30;
const HOLE_PENALTY = 15;

// Cap on how many distinct leaf placements we keep full detail for before
// scoring. This bounds memory/CPU when many placements share the same
// totalSkor (e.g. an empty board with three DOT pieces has ~1.5M legal
// leaves that all score identically) without ever discarding a leaf whose
// totalSkor is strictly better than what's already kept — so the true best
// SCORE is always found. Among leaves that are exactly tied on score, this
// keeps a bounded representative sample rather than all of them; that only
// affects the survivability/holes tiebreak in pathological all-tied cases.
const CANDIDATE_POOL_SIZE = 150;

function permutations(items) {
  if (items.length <= 1) return [items.slice()];
  const result = [];
  for (let i = 0; i < items.length; i++) {
    const rest = items.slice(0, i).concat(items.slice(i + 1));
    for (const tail of permutations(rest)) {
      result.push([items[i], ...tail]);
    }
  }
  return result;
}

function hasAnyPlacement(board, piece) {
  const maxR = 8 - piece.height;
  const maxC = 8 - piece.width;
  for (let r = 0; r <= maxR; r++) {
    for (let c = 0; c <= maxC; c++) {
      if (canPlace(board, piece, r, c)) return true;
    }
  }
  return false;
}

// Number of pieces (out of the full 37-variant library) that could still be
// placed somewhere on this board. Used as a survivability tiebreak so the
// solver never recommends a move that scores well now but kills the board.
function countSurvivability(board) {
  let count = 0;
  for (const piece of PIECES) {
    if (hasAnyPlacement(board, piece)) count++;
  }
  return count;
}

// Empty cells whose 4 neighbors are each either filled or off the board.
function countIsolatedHoles(board) {
  let holes = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (isFilled(board, r, c)) continue;
      const up = r === 0 || isFilled(board, r - 1, c);
      const down = r === 7 || isFilled(board, r + 1, c);
      const left = c === 0 || isFilled(board, r, c - 1);
      const right = c === 7 || isFilled(board, r, c + 1);
      if (up && down && left && right) holes++;
    }
  }
  return holes;
}

export function computeNilai(totalSkor, survivability, lubangTerisolasi) {
  return SCORE_WEIGHT * totalSkor + SURVIVABILITY_WEIGHT * survivability - HOLE_PENALTY * lubangTerisolasi;
}

function signatureOf(langkah) {
  return langkah
    .map((s) => `${s.pieceId}@${s.r},${s.c}`)
    .sort()
    .join("|");
}

// Bounded top-K pool keyed by totalSkor (cheap to maintain: leaves that
// cannot possibly beat the current worst kept entry are rejected in O(1)).
function createCandidatePool(size) {
  const buffer = [];
  let minVal = Infinity;
  let minIdx = -1;

  function recomputeMin() {
    minVal = Infinity;
    minIdx = 0;
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i].totalSkor < minVal) {
        minVal = buffer[i].totalSkor;
        minIdx = i;
      }
    }
  }

  return {
    consider(steps, totalSkor, board) {
      if (buffer.length < size) {
        buffer.push({ steps: steps.map((s) => ({ ...s })), totalSkor, board: cloneBoard(board) });
        if (buffer.length === size) {
          recomputeMin();
        } else if (totalSkor < minVal) {
          minVal = totalSkor;
          minIdx = buffer.length - 1;
        }
        return;
      }
      if (totalSkor > minVal) {
        buffer[minIdx] = { steps: steps.map((s) => ({ ...s })), totalSkor, board: cloneBoard(board) };
        recomputeMin();
      }
    },
    entries() {
      return buffer;
    },
  };
}

function buildNoSolutionReason(pieces, foundIndices) {
  const missing = pieces.filter((_, i) => !foundIndices.has(i));
  if (missing.length === 0) {
    return "Tidak ditemukan kombinasi urutan penempatan yang legal untuk seluruh piece.";
  }
  const names = missing.map((p) => p.id).join(", ");
  return `Piece berikut tidak muat di papan dalam kondisi apa pun: ${names}.`;
}

// Runs the exhaustive search. `onProgress(fraction)` (optional) is called
// after each top-level piece ordering finishes, with fraction in [0, 1].
export function solveWithProgress(board, pieces, onProgress) {
  if (!pieces || pieces.length === 0) {
    return { status: "NO_SOLUTION", reason: "Tidak ada piece untuk ditempatkan." };
  }

  const slots = pieces.map((piece, index) => ({ piece, index }));
  const orders = permutations(slots);
  const pool = createCandidatePool(CANDIDATE_POOL_SIZE);
  const foundIndices = new Set();

  function dfs(currentBoard, order, depth, steps, comboStreak, scoreSoFar) {
    if (depth === order.length) {
      pool.consider(steps, scoreSoFar, currentBoard);
      return;
    }
    const { piece, index } = order[depth];
    const maxR = 8 - piece.height;
    const maxC = 8 - piece.width;
    for (let r = 0; r <= maxR; r++) {
      for (let c = 0; c <= maxC; c++) {
        if (!canPlace(currentBoard, piece, r, c)) continue;
        foundIndices.add(index);

        const placedBoard = place(currentBoard, piece, r, c);
        const { rows: afterClear, cleared } = clearLines(placedBoard);
        const stepScore =
          SCORING.placementPoints(piece) +
          (cleared > 0 ? SCORING.clearPoints(cleared) * SCORING.comboMultiplier(comboStreak) : 0);
        const nextCombo = cleared > 0 ? comboStreak + 1 : 0;

        steps.push({ pieceId: piece.id, r, c, clearedSetelahnya: cleared });
        dfs(afterClear, order, depth + 1, steps, nextCombo, scoreSoFar + stepScore);
        steps.pop();
      }
    }
  }

  orders.forEach((order, i) => {
    dfs(board, order, 0, [], 0, 0);
    if (onProgress) onProgress((i + 1) / orders.length);
  });

  const pooled = pool.entries();
  if (pooled.length === 0) {
    return { status: "NO_SOLUTION", reason: buildNoSolutionReason(pieces, foundIndices) };
  }

  const evaluated = pooled.map((entry) => {
    const survivability = countSurvivability(entry.board);
    const lubangTerisolasi = countIsolatedHoles(entry.board);
    return {
      langkah: entry.steps,
      totalSkor: entry.totalSkor,
      survivability,
      lubangTerisolasi,
      nilai: computeNilai(entry.totalSkor, survivability, lubangTerisolasi),
    };
  });

  evaluated.sort((a, b) => b.nilai - a.nilai);

  const candidates = [];
  const seenSignatures = new Set();
  for (const candidate of evaluated) {
    const sig = signatureOf(candidate.langkah);
    if (seenSignatures.has(sig)) continue;
    seenSignatures.add(sig);
    candidates.push(candidate);
    if (candidates.length === 5) break;
  }

  return { status: "OK", candidates };
}

export function solve(board, pieces) {
  return solveWithProgress(board, pieces, null);
}
