// app.js — application controller: owns state, wires DOM events, talks to
// the solver worker. Rendering itself lives in js/ui.js; board math lives
// in js/board.js; image/crop math lives in js/detector.js.
import { PIECES } from "./pieces.js";
import { fromGrid, toGrid, place, clearLines } from "./board.js";
import * as ui from "./ui.js";
import * as detector from "./detector.js";

const state = {
  grid: emptyGrid(),
  board: null,
  cropCorners: null,
  cropCanvas: null,
  threshold: detector.DEFAULT_THRESHOLD,
  selectedPieces: [],
  solverResult: null,
  activeCandidateIndex: 0,
  worker: null,
};

let activeView = "upload";

const handles = {
  tl: ui.qs("handle-tl"),
  tr: ui.qs("handle-tr"),
  bl: ui.qs("handle-bl"),
  br: ui.qs("handle-br"),
};

function emptyGrid() {
  return Array.from({ length: 8 }, () => Array(8).fill(false));
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function setView(name) {
  activeView = name;
  ui.showView(name);
}

init();

function init() {
  setView("upload");
  wireUpload();
  wireCrop();
  wireCorrect();
  wirePieces();
  wireResults();
  wireReset();
  window.addEventListener("resize", () => {
    if (activeView === "crop" && state.cropCorners) {
      ui.positionCropHandles(handles, state.cropCorners, ui.qs("crop-stage"));
      ui.renderCropOverlay(ui.qs("crop-overlay-svg"), state.cropCorners, detector.bilinear);
    }
  });
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline support just won't be available this session; the app
      // still works fully online.
    });
  });
}

// ---------------------------------------------------------------------
// 1. Upload
// ---------------------------------------------------------------------

function wireUpload() {
  ui.qs("input-file").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;

    try {
      const img = await detector.loadImageFromFile(file);
      const canvas = ui.qs("crop-canvas");
      detector.drawImageToCanvas(img, canvas);
      state.cropCanvas = canvas;

      const saved = detector.loadCalibration();
      state.cropCorners = (saved && saved.corners) || detector.autoDetectCrop(canvas);
      state.threshold = (saved && saved.threshold) ?? detector.DEFAULT_THRESHOLD;
      ui.qs("input-threshold").value = String(state.threshold);

      enterCropView();
    } catch (err) {
      ui.showToast("Gagal memuat gambar. Coba screenshot lain.", "error");
    }
  });

  ui.qs("btn-manual-start").addEventListener("click", () => {
    state.grid = emptyGrid();
    state.cropCanvas = null;
    state.cropCorners = null;
    ui.qs("threshold-field").hidden = true;
    enterCorrectView();
  });
}

function enterCropView() {
  setView("crop");
  // getBoundingClientRect() below forces a synchronous layout, so the
  // stage's post-unhide size is already correct here — no need to wait for
  // a paint frame (and depending on rAF actually firing is fragile: it can
  // be throttled in backgrounded/inactive tabs).
  ui.positionCropHandles(handles, state.cropCorners, ui.qs("crop-stage"));
  ui.renderCropOverlay(ui.qs("crop-overlay-svg"), state.cropCorners, detector.bilinear);
}

// ---------------------------------------------------------------------
// 2. Crop correction
// ---------------------------------------------------------------------

function wireCrop() {
  const stage = ui.qs("crop-stage");

  for (const key of Object.keys(handles)) {
    const el = handles[key];
    el.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      el.setPointerCapture(event.pointerId);

      const onMove = (moveEvent) => {
        const rect = stage.getBoundingClientRect();
        const x = clamp01((moveEvent.clientX - rect.left) / rect.width);
        const y = clamp01((moveEvent.clientY - rect.top) / rect.height);
        state.cropCorners[key] = { x, y };
        ui.positionCropHandles(handles, state.cropCorners, stage);
        ui.renderCropOverlay(ui.qs("crop-overlay-svg"), state.cropCorners, detector.bilinear);
      };
      const onUp = () => {
        el.removeEventListener("pointermove", onMove);
        el.removeEventListener("pointerup", onUp);
      };
      el.addEventListener("pointermove", onMove);
      el.addEventListener("pointerup", onUp);
    });
  }

  ui.qs("btn-crop-back").addEventListener("click", () => setView("upload"));

  ui.qs("btn-crop-confirm").addEventListener("click", () => {
    detector.saveCalibration(state.cropCorners, state.threshold);
    state.grid = runClassification();
    ui.qs("threshold-field").hidden = false;
    enterCorrectView();
  });
}

// Classification runs on real pixel data (unlike the rest of the app's
// pure math), so it can throw on odd inputs — fall back to an empty grid
// and let the mandatory manual correction step take over.
function runClassification() {
  try {
    return detector.classifyGrid(state.cropCanvas, state.cropCorners, state.threshold);
  } catch {
    ui.showToast("Deteksi otomatis gagal, silakan koreksi manual.", "error");
    return emptyGrid();
  }
}

// ---------------------------------------------------------------------
// 3. Cell correction
// ---------------------------------------------------------------------

function enterCorrectView() {
  setView("correct");
  ui.renderCorrectGrid(ui.qs("correct-grid"), state.grid);
}

function wireCorrect() {
  ui.qs("input-threshold").addEventListener("input", (event) => {
    state.threshold = Number(event.target.value);
    if (state.cropCanvas && state.cropCorners) {
      state.grid = runClassification();
      ui.updateCorrectGridValues(ui.qs("correct-grid"), state.grid);
    }
  });

  ui.qs("btn-correct-back").addEventListener("click", () => {
    setView(state.cropCanvas ? "crop" : "upload");
  });

  ui.qs("btn-correct-confirm").addEventListener("click", () => {
    state.board = fromGrid(state.grid);
    setView("pieces");
    updatePiecesUI();
  });
}

// ---------------------------------------------------------------------
// 4. Piece picker
// ---------------------------------------------------------------------

function wirePieces() {
  ui.qs("btn-calculate").addEventListener("click", runSolve);
}

function togglePiece(piece) {
  const idx = state.selectedPieces.findIndex((p) => p.id === piece.id);
  if (idx !== -1) {
    state.selectedPieces.splice(idx, 1);
  } else if (state.selectedPieces.length >= 3) {
    ui.showToast("Maksimal 3 piece dari tray.", "error");
    return;
  } else {
    state.selectedPieces.push(piece);
  }
  updatePiecesUI();
}

function updatePiecesUI() {
  ui.renderPieceGallery(
    ui.qs("piece-gallery"),
    PIECES,
    state.selectedPieces.map((p) => p.id),
    togglePiece
  );
  ui.updateSelectionSummary(ui.qs("selection-summary"), state.selectedPieces);
  ui.qs("btn-calculate").disabled = state.selectedPieces.length === 0;
}

function runSolve() {
  ui.setCalculateLoading(true);

  if (!state.worker) {
    state.worker = new Worker(new URL("./solver.worker.js", import.meta.url), { type: "module" });
    state.worker.addEventListener("error", () => {
      ui.setCalculateLoading(false);
      ui.showToast("Terjadi kesalahan saat menghitung. Coba lagi.", "error");
    });
  }

  const onMessage = (event) => {
    if (event.data.type === "progress") return;
    if (event.data.type === "result") {
      state.worker.removeEventListener("message", onMessage);
      ui.setCalculateLoading(false);
      onSolverResult(event.data.result);
    }
  };
  state.worker.addEventListener("message", onMessage);
  state.worker.postMessage({
    board: Array.from(state.board),
    pieces: state.selectedPieces,
  });
}

// ---------------------------------------------------------------------
// 5. Results
// ---------------------------------------------------------------------

function onSolverResult(result) {
  state.solverResult = result;
  state.activeCandidateIndex = 0;

  if (result.status === "NO_SOLUTION") {
    ui.showNoSolution(result.reason);
    return;
  }

  setView("results");
  renderActiveCandidate();
}

function renderActiveCandidate() {
  const { candidates } = state.solverResult;
  const candidate = candidates[state.activeCandidateIndex];

  const stepVMs = buildStepViewModels(state.board, state.selectedPieces, candidate.langkah);
  ui.renderResultSteps(ui.qs("result-steps"), stepVMs);
  ui.renderResultSummary(candidate);
  ui.renderAltList(ui.qs("alt-list"), candidates, state.activeCandidateIndex, selectCandidate);

  ui.qs("alt-list").classList.add("hidden");
  const altCount = candidates.length - 1;
  ui.qs("btn-show-alt").hidden = altCount <= 0;
  ui.qs("btn-show-alt").textContent = `Lihat ${altCount} Alternatif Lainnya`;
}

function selectCandidate(index) {
  state.activeCandidateIndex = index;
  renderActiveCandidate();
}

// Replays a candidate's placements against the confirmed board so each step
// can be rendered as its own before/after mini-grid.
function buildStepViewModels(board, pieces, langkah) {
  let current = board;
  const used = new Set();

  return langkah.map((step) => {
    const pieceIdx = pieces.findIndex((p, i) => p.id === step.pieceId && !used.has(i));
    used.add(pieceIdx);
    const piece = pieces[pieceIdx];

    const existingGrid = toGrid(current);
    const newCells = new Set(piece.cells.map(([dr, dc]) => `${step.r + dr},${step.c + dc}`));

    const placedBoard = place(current, piece, step.r, step.c);
    const { rows: afterClear } = clearLines(placedBoard);

    // Any cell filled right after placement but empty after clearing was
    // part of a row/column that just cleared.
    const clearCells = new Set();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const wasFilled = (placedBoard[r] & (1 << c)) !== 0;
        const stillFilled = (afterClear[r] & (1 << c)) !== 0;
        if (wasFilled && !stillFilled) clearCells.add(`${r},${c}`);
      }
    }

    current = afterClear;
    return {
      pieceId: step.pieceId,
      r: step.r,
      c: step.c,
      cleared: step.clearedSetelahnya,
      existingGrid,
      newCells,
      clearCells,
    };
  });
}

function wireResults() {
  ui.qs("btn-show-alt").addEventListener("click", () => {
    ui.qs("alt-list").classList.toggle("hidden");
  });
  ui.qs("btn-results-restart").addEventListener("click", resetAll);
  ui.qs("btn-no-solution-back").addEventListener("click", () => setView("pieces"));
}

// ---------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------

function wireReset() {
  ui.qs("btn-reset").addEventListener("click", resetAll);
}

function resetAll() {
  state.grid = emptyGrid();
  state.board = null;
  state.cropCorners = null;
  state.cropCanvas = null;
  state.selectedPieces = [];
  state.solverResult = null;
  state.activeCandidateIndex = 0;
  setView("upload");
}
