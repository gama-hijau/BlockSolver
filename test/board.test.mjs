import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyBoard,
  canPlace,
  place,
  clearLines,
  fromGrid,
  toGrid,
  isFilled,
} from "../js/board.js";

const dot = { id: "DOT", cells: [[0, 0]], width: 1, height: 1, size: 1 };
const line3 = { id: "LINE3_0", cells: [[0, 0], [0, 1], [0, 2]], width: 3, height: 1, size: 3 };

test("createEmptyBoard is all empty", () => {
  const rows = createEmptyBoard();
  assert.equal(rows.length, 8);
  for (let r = 0; r < 8; r++) assert.equal(rows[r], 0);
});

test("canPlace true on empty board within bounds", () => {
  const rows = createEmptyBoard();
  assert.equal(canPlace(rows, dot, 0, 0), true);
  assert.equal(canPlace(rows, line3, 0, 5), true);
});

test("canPlace false when piece goes out of bounds", () => {
  const rows = createEmptyBoard();
  assert.equal(canPlace(rows, line3, 0, 6), false);
  assert.equal(canPlace(rows, dot, 8, 0), false);
  assert.equal(canPlace(rows, dot, 0, -1), false);
});

test("canPlace false when overlapping a filled cell", () => {
  let rows = createEmptyBoard();
  rows = place(rows, dot, 3, 3);
  assert.equal(canPlace(rows, dot, 3, 3), false);
  assert.equal(canPlace(rows, line3, 3, 2), false); // covers (3,2)(3,3)(3,4)
});

test("place returns a new board and does not mutate the input", () => {
  const original = createEmptyBoard();
  const placed = place(original, dot, 2, 2);
  assert.equal(original[2], 0, "original board must not be mutated");
  assert.equal(isFilled(placed, 2, 2), true);
  assert.notEqual(placed, original);
});

test("clearLines: no full lines clears nothing", () => {
  const rows = createEmptyBoard();
  const result = clearLines(rows);
  assert.equal(result.cleared, 0);
  for (let r = 0; r < 8; r++) assert.equal(result.rows[r], 0);
});

test("clearLines: a full row is cleared", () => {
  const rows = createEmptyBoard();
  rows[4] = 0xff;
  const result = clearLines(rows);
  assert.equal(result.cleared, 1);
  assert.equal(result.rows[4], 0);
});

test("clearLines: a full column is cleared", () => {
  const rows = createEmptyBoard();
  for (let r = 0; r < 8; r++) rows[r] = 1 << 2; // column 2 filled in every row
  const result = clearLines(rows);
  assert.equal(result.cleared, 1);
  for (let r = 0; r < 8; r++) assert.equal(isFilled(result.rows, r, 2), false);
});

test("clearLines: simultaneous row + column full both clear (cleared === 2)", () => {
  const rows = createEmptyBoard();
  // Row 7 fully filled.
  rows[7] = 0xff;
  // Column 3 fully filled across every row (row 7 already has it via 0xff).
  for (let r = 0; r < 7; r++) rows[r] = 1 << 3;

  const result = clearLines(rows);
  assert.equal(result.cleared, 2, "one row + one column = 2 lines cleared");
  for (let r = 0; r < 8; r++) assert.equal(result.rows[r], 0, "board must be fully empty after clear");
});

test("clearLines: row and column evaluated on pre-clear state, not recomputed mid-clear", () => {
  // Construct a board where row 0 is full AND every column is also full
  // except one cell in row 0 that is only covered by the row-clear itself.
  // If rows/cols were evaluated sequentially (clear rows, then recompute
  // cols), results would differ from evaluating both against the original.
  const rows = createEmptyBoard();
  for (let r = 0; r < 8; r++) rows[r] = 0xff; // fully filled board
  const result = clearLines(rows);
  // All 8 rows and all 8 columns are full simultaneously on a full board.
  assert.equal(result.cleared, 16);
  for (let r = 0; r < 8; r++) assert.equal(result.rows[r], 0);
});

test("fromGrid / toGrid round-trip", () => {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(false));
  grid[0][0] = true;
  grid[5][6] = true;
  const rows = fromGrid(grid);
  assert.equal(isFilled(rows, 0, 0), true);
  assert.equal(isFilled(rows, 5, 6), true);
  const roundTrip = toGrid(rows);
  assert.deepEqual(roundTrip, grid);
});
