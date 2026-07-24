import { test } from "node:test";
import assert from "node:assert/strict";
import { PIECES, getPieceById } from "../js/pieces.js";
import { createEmptyBoard, canPlace, place, clearLines, fromGrid } from "../js/board.js";
import { solve } from "../js/solver.js";

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBoard(rand, fillProbability) {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(false));
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      grid[r][c] = rand() < fillProbability;
    }
  }
  return fromGrid(grid);
}

function randomPieces(rand, count) {
  const chosen = [];
  for (let i = 0; i < count; i++) {
    chosen.push(PIECES[Math.floor(rand() * PIECES.length)]);
  }
  return chosen;
}

// Replays a candidate's `langkah` sequence against the original board,
// verifying every placement is legal in the exact state the solver saw it.
function replayAndValidate(board, pieces, candidate) {
  let current = board;
  assert.equal(candidate.langkah.length, pieces.length, "must place every given piece exactly once");

  const usedPieceIndices = new Set();
  for (const step of candidate.langkah) {
    const pieceIdx = pieces.findIndex(
      (p, i) => p.id === step.pieceId && !usedPieceIndices.has(i)
    );
    assert.notEqual(pieceIdx, -1, `step references unknown/duplicate piece id ${step.pieceId}`);
    usedPieceIndices.add(pieceIdx);
    const piece = pieces[pieceIdx];

    assert.equal(
      canPlace(current, piece, step.r, step.c),
      true,
      `placement of ${piece.id} at (${step.r},${step.c}) must be legal on the board as it existed at that step`
    );

    const placed = place(current, piece, step.r, step.c);
    const { rows, cleared } = clearLines(placed);
    assert.equal(step.clearedSetelahnya, cleared, "reported cleared count must match actual clearLines result");
    current = rows;
  }
}

test("500 random boards with 3 random pieces: every recommended placement is legal", () => {
  const rand = mulberry32(12345);
  const iterations = 500;
  let solvedCount = 0;
  let noSolutionCount = 0;

  for (let i = 0; i < iterations; i++) {
    const board = randomBoard(rand, 0.45);
    const pieces = randomPieces(rand, 3);
    const result = solve(board, pieces);

    if (result.status === "NO_SOLUTION") {
      noSolutionCount++;
      continue;
    }

    assert.equal(result.status, "OK");
    assert.ok(result.candidates.length >= 1 && result.candidates.length <= 5);
    for (const candidate of result.candidates) {
      replayAndValidate(board, pieces, candidate);
    }
    solvedCount++;
  }

  assert.equal(solvedCount + noSolutionCount, iterations);
  assert.ok(solvedCount > 0, "sanity check: at least some random boards should be solvable");
});

test("solver never rotates a piece: returned cells are identical to the input piece", () => {
  const rand = mulberry32(999);
  for (let i = 0; i < 100; i++) {
    const board = randomBoard(rand, 0.4);
    const pieces = randomPieces(rand, 3);
    const result = solve(board, pieces);
    if (result.status !== "OK") continue;

    for (const candidate of result.candidates) {
      for (const step of candidate.langkah) {
        const original = pieces.find((p) => p.id === step.pieceId);
        const libraryPiece = getPieceById(step.pieceId);
        assert.ok(original, "step must reference one of the input pieces");
        assert.deepEqual(
          libraryPiece.cells,
          original.cells,
          "piece cells must be identical to the library definition (no rotation applied)"
        );
      }
    }
  }
});

test("handles 1 piece and 2 pieces (not always 3)", () => {
  const board = createEmptyBoard();
  const dot = getPieceById("DOT");
  const sq2 = getPieceById("SQ2");

  const result1 = solve(board, [dot]);
  assert.equal(result1.status, "OK");
  assert.equal(result1.candidates[0].langkah.length, 1);

  const result2 = solve(board, [dot, sq2]);
  assert.equal(result2.status, "OK");
  assert.equal(result2.candidates[0].langkah.length, 2);
});

test("NO_SOLUTION when a piece cannot fit anywhere, with an explanation", () => {
  // Fill the entire board except a single cell — nothing bigger than a DOT fits.
  const grid = Array.from({ length: 8 }, () => Array(8).fill(true));
  grid[0][0] = false;
  const board = fromGrid(grid);
  const line3 = getPieceById("LINE3_0");

  const result = solve(board, [line3]);
  assert.equal(result.status, "NO_SOLUTION");
  assert.match(result.reason, /LINE3_0/);
});

// --- Fixture 1: unique optimal move is the one that clears a line -------
test("fixture: prefers the single placement that clears a line over any other", () => {
  const board = createEmptyBoard();
  // Row 0 filled except column 7.
  board[0] = 0b01111111;
  const dot = getPieceById("DOT");

  const result = solve(board, [dot]);
  assert.equal(result.status, "OK");
  const best = result.candidates[0];
  assert.equal(best.totalSkor, 11); // 1 (placement) + 10*1*(1+1)/2 (clear) * 1 (multiplier)
  assert.equal(best.langkah.length, 1);
  assert.equal(best.langkah[0].r, 0);
  assert.equal(best.langkah[0].c, 7);
  assert.equal(best.langkah[0].clearedSetelahnya, 1);
});

// --- Fixture 2: combo across two clearing placements beats any single clear
test("fixture: back-to-back clears score higher via combo multiplier", () => {
  const board = createEmptyBoard();
  board[2] = 0b11110111; // row 2 filled except column 3
  board[5] = 0b11110111; // row 5 filled except column 3
  const dotA = getPieceById("DOT");
  const dotB = getPieceById("DOT");

  const result = solve(board, [dotA, dotB]);
  assert.equal(result.status, "OK");
  const best = result.candidates[0];

  // 1 + 10*1*2/2*1 (first clear, combo 0) = 11
  // 1 + 10*1*2/2*1.5 (second clear, combo 1) = 16
  assert.equal(best.totalSkor, 27);

  const cells = best.langkah.map((s) => `${s.r},${s.c}`).sort();
  assert.deepEqual(cells, ["2,3", "5,3"]);
});

// --- Fixture 3: tiebreak avoids creating an isolated hole -----------------
test("fixture: equal-score placements are tiebroken away from isolated holes", () => {
  const board = createEmptyBoard();
  // A small pocket: (0,0), (0,1), (1,1) empty; boundary cells filled so that
  // filling (0,1) traps both (0,0) and (1,1) as isolated holes, while
  // filling (0,0) or (1,1) leaves the remaining two cells connected (no
  // isolation).
  board[1] |= 1 << 0; // (1,0) filled
  board[0] |= 1 << 2; // (0,2) filled
  board[1] |= 1 << 2; // (1,2) filled
  board[2] |= 1 << 1; // (2,1) filled

  const dot = getPieceById("DOT");
  const result = solve(board, [dot]);
  assert.equal(result.status, "OK");
  const best = result.candidates[0];

  assert.equal(best.totalSkor, 1); // no clears anywhere
  assert.equal(best.lubangTerisolasi, 0);
  const placedAtTrap = best.langkah[0].r === 0 && best.langkah[0].c === 1;
  assert.equal(placedAtTrap, false, "must not choose the placement that creates isolated holes");
});

test("clearLines simultaneity is honored end-to-end through the solver", () => {
  const board = createEmptyBoard();
  // Row 7 fully filled except column 3; column 3 fully filled except row 7.
  for (let r = 0; r < 7; r++) board[r] = 1 << 3;
  board[7] = 0b11110111;
  const dot = getPieceById("DOT");

  const result = solve(board, [dot]);
  assert.equal(result.status, "OK");
  const best = result.candidates[0];
  assert.equal(best.langkah[0].r, 7);
  assert.equal(best.langkah[0].c, 3);
  assert.equal(best.langkah[0].clearedSetelahnya, 2);
});
