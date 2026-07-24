// board.js — 8x8 bitboard representation and operations.
//
// Board = Uint8Array(8), one element per row; bit `c` of rows[r] means
// column c is filled in row r. A 2D array is deliberately NOT used: the
// solver evaluates millions of candidate states, and bitwise ops on a
// flat 8-element typed array are far cheaper than 2D array access.

export const BOARD_SIZE = 8;

export function createEmptyBoard() {
  return new Uint8Array(BOARD_SIZE);
}

export function cloneBoard(rows) {
  return Uint8Array.from(rows);
}

export function isFilled(rows, r, c) {
  return (rows[r] & (1 << c)) !== 0;
}

// Convert a plain 2D boolean/0-1 grid (row-major, rows[r][c]) into a bitboard.
export function fromGrid(grid) {
  const rows = createEmptyBoard();
  for (let r = 0; r < BOARD_SIZE; r++) {
    let bits = 0;
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (grid[r][c]) bits |= 1 << c;
    }
    rows[r] = bits;
  }
  return rows;
}

// Convert a bitboard into a plain 2D boolean grid, for rendering.
export function toGrid(rows) {
  const grid = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    const row = [];
    for (let c = 0; c < BOARD_SIZE; c++) {
      row.push(isFilled(rows, r, c));
    }
    grid.push(row);
  }
  return grid;
}

// Can `piece` be placed with its (0,0) cell offset at board position (r, c)?
export function canPlace(rows, piece, r, c) {
  for (const [dr, dc] of piece.cells) {
    const rr = r + dr;
    const cc = c + dc;
    if (rr < 0 || rr >= BOARD_SIZE || cc < 0 || cc >= BOARD_SIZE) return false;
    if (isFilled(rows, rr, cc)) return false;
  }
  return true;
}

// Return a NEW board with `piece` placed at (r, c). Does not mutate `rows`.
// Caller must ensure canPlace(rows, piece, r, c) is true.
export function place(rows, piece, r, c) {
  const newRows = cloneBoard(rows);
  for (const [dr, dc] of piece.cells) {
    newRows[r + dr] |= 1 << (c + dc);
  }
  return newRows;
}

// Clear all full rows and full columns SIMULTANEOUSLY: both are computed
// from the original (pre-clear) board, then removed together. Clearing
// rows first and recomputing columns afterward would under-count columns
// that only became "not full" because a row was already zeroed out.
export function clearLines(rows) {
  const fullRows = [];
  for (let r = 0; r < BOARD_SIZE; r++) {
    if (rows[r] === 0xff) fullRows.push(r);
  }

  const fullCols = [];
  for (let c = 0; c < BOARD_SIZE; c++) {
    const bit = 1 << c;
    let full = true;
    for (let r = 0; r < BOARD_SIZE; r++) {
      if (!(rows[r] & bit)) {
        full = false;
        break;
      }
    }
    if (full) fullCols.push(c);
  }

  const newRows = cloneBoard(rows);
  for (const r of fullRows) newRows[r] = 0;

  let colMask = 0;
  for (const c of fullCols) colMask |= 1 << c;
  if (colMask) {
    const clearMask = ~colMask & 0xff;
    for (let r = 0; r < BOARD_SIZE; r++) newRows[r] &= clearMask;
  }

  return { rows: newRows, cleared: fullRows.length + fullCols.length };
}

export function countFilled(rows) {
  let count = 0;
  for (let r = 0; r < BOARD_SIZE; r++) {
    let bits = rows[r];
    while (bits) {
      count += bits & 1;
      bits >>= 1;
    }
  }
  return count;
}
