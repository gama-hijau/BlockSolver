// pieces.js — Piece library for Block Blast Solver.
//
// DATA-DRIVEN DESIGN: everything the app knows about pieces flows from
// BASE_SHAPES below. Adding a new entry to BASE_SHAPES automatically:
//   - generates its rotation variants (deduped) into the exported PIECES array
//   - makes it appear in the UI piece gallery (js/ui.js iterates PIECES)
//   - makes it available to the solver (js/solver.js iterates PIECES)
// No other file needs to change to add/remove a base shape.
//
// CRITICAL RULE: Block Blast has no in-game rotation. Each deduped rotation
// variant below becomes its OWN independent piece entry in PIECES. The
// solver must place pieces exactly as given — it must NEVER rotate a piece
// while searching for placements.

const BASE_SHAPES = {
  DOT: ["X"],
  LINE2: ["XX"],
  LINE3: ["XXX"],
  LINE4: ["XXXX"],
  LINE5: ["XXXXX"],
  SQ2: ["XX", "XX"],
  SQ3: ["XXX", "XXX", "XXX"],
  RECT23: ["XX", "XX", "XX"],
  CORNER3: ["X.", "XX"],
  CORNER5: ["X..", "X..", "XXX"],
  L4: ["X.", "X.", "XX"],
  J4: [".X", ".X", "XX"],
  T4: ["XXX", ".X."],
  S4: [".XX", "XX."],
  Z4: ["XX.", ".XX"],
};

// Parse an array-of-strings shape into a list of [row, col] cells.
function parseShape(rowStrings) {
  const cells = [];
  for (let r = 0; r < rowStrings.length; r++) {
    const row = rowStrings[r];
    for (let c = 0; c < row.length; c++) {
      if (row[c] === "X") cells.push([r, c]);
    }
  }
  return cells;
}

// Shift cells so the bounding box starts at (0,0).
function normalize(cells) {
  let minR = Infinity;
  let minC = Infinity;
  for (const [r, c] of cells) {
    if (r < minR) minR = r;
    if (c < minC) minC = c;
  }
  return cells.map(([r, c]) => [r - minR, c - minC]);
}

// Rotate cells 90 degrees clockwise: (r,c) in a shape of height H -> (c, H-1-r).
function rotate90(cells) {
  let maxR = 0;
  for (const [r] of cells) {
    if (r > maxR) maxR = r;
  }
  return cells.map(([r, c]) => [c, maxR - r]);
}

// Canonical string key for dedupe: sorted cell list as "r,c;r,c;...".
function canonicalKey(cells) {
  const sorted = [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return sorted.map(([r, c]) => `${r},${c}`).join(";");
}

function sortCells(cells) {
  return [...cells].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

function buildPieces() {
  const pieces = [];
  for (const [baseId, rowStrings] of Object.entries(BASE_SHAPES)) {
    let cells = normalize(parseShape(rowStrings));
    const seen = new Set();
    const variants = [];
    for (let rotation = 0; rotation < 4; rotation++) {
      const key = canonicalKey(cells);
      if (!seen.has(key)) {
        seen.add(key);
        variants.push(sortCells(cells));
      }
      cells = normalize(rotate90(cells));
    }

    variants.forEach((variantCells, index) => {
      const width = Math.max(...variantCells.map(([, c]) => c)) + 1;
      const height = Math.max(...variantCells.map(([r]) => r)) + 1;
      pieces.push({
        id: variants.length === 1 ? baseId : `${baseId}_${index}`,
        baseId,
        cells: variantCells,
        width,
        height,
        size: variantCells.length,
      });
    });
  }
  return pieces;
}

// All unique piece variants, generated once at module load.
export const PIECES = buildPieces();

export function getPieceById(id) {
  return PIECES.find((p) => p.id === id);
}
