// detector.js — screenshot -> 8x8 board detection.
//
// Three-stage pipeline (auto-detect is a best-effort starting point; the
// other two stages are the real safety net and are always shown, never
// hidden behind a toggle):
//   1. autoDetectCrop  — guess the board's 4 corners from the image.
//   2. (manual, in ui.js/app.js) user drags the 4 corner handles.
//   3. classifyGrid + (manual, in ui.js/app.js) user taps to fix cells.

export const DEFAULT_THRESHOLD = 30; // 0-100, matches the UI slider range (see classifyGrid)

export function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal memuat gambar."));
    img.src = URL.createObjectURL(file);
  });
}

export function drawImageToCanvas(img, canvas) {
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  return { width: canvas.width, height: canvas.height };
}

// Bilinear interpolation across the crop quadrilateral: u, v in [0, 1] ->
// normalized {x, y} point (also in [0, 1] of the canvas).
export function bilinear(corners, u, v) {
  const top = {
    x: corners.tl.x + (corners.tr.x - corners.tl.x) * u,
    y: corners.tl.y + (corners.tr.y - corners.tl.y) * u,
  };
  const bottom = {
    x: corners.bl.x + (corners.br.x - corners.bl.x) * u,
    y: corners.bl.y + (corners.br.y - corners.bl.y) * u,
  };
  return {
    x: top.x + (bottom.x - top.x) * v,
    y: top.y + (bottom.y - top.y) * v,
  };
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function centeredSquareFallback(canvas) {
  const size = Math.min(canvas.width, canvas.height) * 0.9;
  const x0 = (canvas.width - size) / 2 / canvas.width;
  const y0 = (canvas.height - size) / 2 / canvas.height;
  const x1 = x0 + size / canvas.width;
  const y1 = y0 + size / canvas.height;
  return {
    tl: { x: x0, y: y0 },
    tr: { x: x1, y: y0 },
    bl: { x: x0, y: y1 },
    br: { x: x1, y: y1 },
  };
}

// Longest contiguous run of indices whose value clears `threshold`.
function findActiveBand(profile, threshold) {
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] >= threshold) {
      if (curStart === -1) curStart = i;
    } else if (curStart !== -1) {
      const len = i - curStart;
      if (len > bestLen) {
        bestLen = len;
        bestStart = curStart;
      }
      curStart = -1;
    }
  }
  if (curStart !== -1 && profile.length - curStart > bestLen) {
    bestLen = profile.length - curStart;
    bestStart = curStart;
  }
  return bestStart === -1 ? null : { start: bestStart, end: bestStart + bestLen };
}

// Box-blur a 1D profile so that thin, sharp spikes (individual grid lines)
// bleed into their neighbors. Without this, a threshold that is low enough
// to include the board's lower-contrast cell interiors also picks up
// isolated noise elsewhere, and a threshold high enough to reject noise
// only catches the grid lines themselves — fragmenting the board region
// into many short bands instead of one long one.
function smoothProfile(profile, radius) {
  const n = profile.length;
  const out = new Float32Array(n);
  let windowSum = 0;
  for (let i = 0; i < Math.min(n, radius); i++) windowSum += profile[i];
  for (let i = 0; i < n; i++) {
    const addIdx = i + radius;
    const remIdx = i - radius - 1;
    if (addIdx < n) windowSum += profile[addIdx];
    if (remIdx >= 0) windowSum -= profile[remIdx];
    const lo = Math.max(0, i - radius);
    const hi = Math.min(n - 1, i + radius);
    out[i] = windowSum / (hi - lo + 1);
  }
  return out;
}

// Local-contrast gradient magnitude map: an 8x8 board reliably shows a
// regular grid of edges (cell borders) whether or not any cells are
// filled, which makes it a more reliable structural signal than raw color
// saturation for finding the board's bounding box (an empty board has
// almost no saturated pixels at all, but its grid lines still stand out
// from the surrounding app chrome).
function computeGradientMap(canvas) {
  const maxDim = 240;
  const scale = Math.min(1, maxDim / Math.max(canvas.width, canvas.height));
  const w = Math.max(3, Math.round(canvas.width * scale));
  const h = Math.max(3, Math.round(canvas.height * scale));

  const off = document.createElement("canvas");
  off.width = w;
  off.height = h;
  const octx = off.getContext("2d", { willReadFrequently: true });
  octx.drawImage(canvas, 0, 0, w, h);
  const { data } = octx.getImageData(0, 0, w, h);

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }

  const mag = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = gray[y * w + x + 1] - gray[y * w + x - 1];
      const gy = gray[(y + 1) * w + x] - gray[(y - 1) * w + x];
      mag[y * w + x] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return { mag, w, h };
}

function sumRows(mag, w, h) {
  const rowSum = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < w; x++) s += mag[y * w + x];
    rowSum[y] = s;
  }
  return rowSum;
}

// Column sum restricted to a row range — lets us condition the horizontal
// detection on the vertical band already found, instead of projecting the
// whole image (see autoDetectCrop).
function sumCols(mag, w, yStart, yEnd) {
  const colSum = new Float32Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = yStart; y < yEnd; y++) s += mag[y * w + x];
    colSum[x] = s;
  }
  return colSum;
}

// Tries progressively lower fractions of the peak activity until a band
// covering a plausible chunk of the image is found, rather than betting
// everything on one hand-tuned ratio (real screenshots vary a lot in
// contrast and theme).
function findBestBand(profile, dimension) {
  const max = Math.max(...profile);
  if (max <= 0) return null;
  for (const fraction of [0.25, 0.15, 0.08, 0.04, 0.02, 0.01]) {
    const band = findActiveBand(profile, max * fraction);
    if (band && (band.end - band.start) / dimension >= 0.3) return band;
  }
  return null;
}

// Row+column band detection at one smoothing radius (see autoDetectCrop).
function detectBandsAtRadius(mag, w, h, radius) {
  const rowBand = findBestBand(smoothProfile(sumRows(mag, w, h), radius), h);
  if (!rowBand) return null;

  // Chrome above/below the board (score header, tray) is often just as
  // wide as the board itself, so it can contaminate a column profile taken
  // over the whole image. Restricting the column sum to the rows we just
  // identified as "the board" avoids that.
  let colBand = findBestBand(smoothProfile(sumCols(mag, w, rowBand.start, rowBand.end), radius), w);
  if (!colBand) {
    colBand = findBestBand(smoothProfile(sumCols(mag, w, 0, h), radius), w);
  }
  return colBand ? { rowBand, colBand } : null;
}

export function autoDetectCrop(canvas) {
  try {
    const { mag, w, h } = computeGradientMap(canvas);

    // No single smoothing radius wins across every screenshot's grid
    // pitch/aspect ratio. Try a few and keep the "squarest" raw result —
    // since the real board is square, a detection whose raw row/col
    // extents (in shared downscaled-pixel units) are already close to
    // equal is a good signal that it actually tracked the board, not a
    // fragment of it or of some other UI chrome.
    let best = null;
    let bestSquareness = Infinity;
    for (const radius of [2, 3, 4, 5]) {
      const bands = detectBandsAtRadius(mag, w, h, radius);
      if (!bands) continue;
      const widthPx = bands.colBand.end - bands.colBand.start;
      const heightPx = bands.rowBand.end - bands.rowBand.start;
      const squareness = Math.max(widthPx, heightPx) / Math.min(widthPx, heightPx);
      if (squareness < bestSquareness) {
        bestSquareness = squareness;
        best = bands;
      }
    }
    if (!best) return centeredSquareFallback(canvas);
    const { rowBand, colBand } = best;

    // w and h (the downscaled canvas dimensions) are generally NOT equal,
    // since screenshots aren't square. `scale` in computeGradientMap is
    // uniform across both axes though, so a pixel in colBand and a pixel
    // in rowBand represent the same real-world distance — squaring must
    // happen here, in shared pixel units, before converting each axis to
    // its own (different) normalized fraction.
    let colStart = colBand.start;
    let colEnd = colBand.end;
    let rowStart = rowBand.start;
    let rowEnd = rowBand.end;
    const widthPx = colEnd - colStart;
    const heightPx = rowEnd - rowStart;
    const sidePx = Math.min(widthPx, heightPx);
    if (widthPx > heightPx) {
      const cx = (colStart + colEnd) / 2;
      colStart = cx - sidePx / 2;
      colEnd = cx + sidePx / 2;
    } else if (heightPx > widthPx) {
      const cy = (rowStart + rowEnd) / 2;
      rowStart = cy - sidePx / 2;
      rowEnd = cy + sidePx / 2;
    }

    let x0 = colStart / w;
    let x1 = colEnd / w;
    let y0 = rowStart / h;
    let y1 = rowEnd / h;

    x0 = clamp01(x0);
    x1 = clamp01(x1);
    y0 = clamp01(y0);
    y1 = clamp01(y1);

    if (x1 - x0 < 0.2 || y1 - y0 < 0.2) return centeredSquareFallback(canvas);

    return {
      tl: { x: x0, y: y0 },
      tr: { x: x1, y: y0 },
      bl: { x: x0, y: y1 },
      br: { x: x1, y: y1 },
    };
  } catch {
    return centeredSquareFallback(canvas);
  }
}

// ---------------------------------------------------------------------
// Cell classification
// ---------------------------------------------------------------------

export function rgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// Median color (per channel — robust to highlights/shadows within the
// patch) of a square patch centered at (cx, cy) in canvas pixel space.
function samplePatchMedianColor(ctx, cx, cy, patchSize, canvasW, canvasH) {
  const half = patchSize / 2;
  const sx = Math.max(0, Math.round(cx - half));
  const sy = Math.max(0, Math.round(cy - half));
  const ex = Math.min(canvasW, Math.round(cx + half));
  const ey = Math.min(canvasH, Math.round(cy + half));
  const width = Math.max(1, ex - sx);
  const height = Math.max(1, ey - sy);

  const { data } = ctx.getImageData(sx, sy, width, height);
  const step = Math.max(1, Math.floor(Math.min(width, height) / 6));
  const rs = [];
  const gs = [];
  const bs = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const idx = (y * width + x) * 4;
      rs.push(data[idx]);
      gs.push(data[idx + 1]);
      bs.push(data[idx + 2]);
    }
  }
  return { r: median(rs), g: median(gs), b: median(bs) };
}

// Classifies all 64 cells as filled/empty. `thresholdPercent` is 0-100
// (the UI slider's range).
//
// A cell is "filled" when saturation * value (not saturation alone)
// clears the threshold. Real screenshots (see test/fixtures) showed empty
// cells are themselves rendered in a saturated dark navy — e.g. HSV
// (h=228, s=0.61, v=0.30) — so filled and empty cells' saturation ranges
// overlap for darker piece colors (purple measured s=0.56, actually LOWER
// than the empty cell's s=0.61). What consistently separates them is
// brightness: empty cells are dark (v~0.3) while every filled color
// sampled was bright (v>=0.5). s*v (empty ~0.18, filled >=0.43 in that
// fixture) cleanly separates the two where s alone does not.
export function classifyGrid(canvas, corners, thresholdPercent) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const threshold = thresholdPercent / 100;

  const avgWidthNorm = ((corners.tr.x - corners.tl.x) + (corners.br.x - corners.bl.x)) / 2;
  const avgHeightNorm = ((corners.bl.y - corners.tl.y) + (corners.br.y - corners.tr.y)) / 2;
  const cellWidthPx = (avgWidthNorm * canvas.width) / 8;
  const cellHeightPx = (avgHeightNorm * canvas.height) / 8;
  const patchSize = Math.max(4, Math.min(Math.abs(cellWidthPx), Math.abs(cellHeightPx)) * 0.5);

  const grid = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (let c = 0; c < 8; c++) {
      const center = bilinear(corners, (c + 0.5) / 8, (r + 0.5) / 8);
      const cx = center.x * canvas.width;
      const cy = center.y * canvas.height;
      const { r: mr, g: mg, b: mb } = samplePatchMedianColor(ctx, cx, cy, patchSize, canvas.width, canvas.height);
      const { s, v } = rgbToHsv(mr, mg, mb);
      row.push(s * v >= threshold);
    }
    grid.push(row);
  }
  return grid;
}

// ---------------------------------------------------------------------
// Calibration persistence
// ---------------------------------------------------------------------

const CALIBRATION_KEY = "blockblast-calibration-v1";

export function loadCalibration() {
  try {
    const raw = localStorage.getItem(CALIBRATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCalibration(corners, threshold) {
  try {
    localStorage.setItem(CALIBRATION_KEY, JSON.stringify({ corners, threshold }));
  } catch {
    // localStorage unavailable (private mode, quota) — calibration just won't persist.
  }
}
