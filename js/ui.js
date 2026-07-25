// ui.js — DOM rendering and presentation helpers. No app state lives here;
// every function takes the data it needs to render and, where relevant, a
// callback for user interaction. js/app.js owns state and wiring.

const VIEW_ORDER = ["upload", "crop", "correct", "pieces", "results"];

export function qs(id) {
  return document.getElementById(id);
}

export function showView(name) {
  for (const view of document.querySelectorAll(".view")) {
    view.classList.toggle("hidden", view.dataset.view !== name);
  }
  qs("no-solution-state").classList.add("hidden");

  const activeIdx = VIEW_ORDER.indexOf(name);
  for (const dot of document.querySelectorAll(".step-dot")) {
    const idx = VIEW_ORDER.indexOf(dot.dataset.step);
    dot.classList.toggle("is-active", idx === activeIdx);
    dot.classList.toggle("is-done", idx < activeIdx);
  }

  qs("btn-reset").hidden = name === "upload";
}

export function showNoSolution(message) {
  for (const view of document.querySelectorAll(".view")) view.classList.add("hidden");
  qs("no-solution-message").textContent = message;
  qs("no-solution-state").classList.remove("hidden");
}

let toastTimer = null;
export function showToast(message, type = "info") {
  const container = qs("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " toast--error" : ""}`;
  toast.textContent = message;
  container.innerHTML = "";
  container.appendChild(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 3200);
}

export function setCalculateLoading(isLoading) {
  const btn = qs("btn-calculate");
  btn.disabled = isLoading || btn.dataset.forceDisabled === "true";
  btn.querySelector(".button__label").textContent = isLoading ? "Menghitung..." : "Hitung";
  btn.querySelector(".spinner").hidden = !isLoading;
}

// ---------------------------------------------------------------------
// Board grids
// ---------------------------------------------------------------------

// Interactive 8x8 grid for manual cell correction. `grid` is a mutable
// boolean[8][8] that this function toggles in place.
//
// Supports drag-to-paint: pointerdown on a cell decides the paint value
// (the opposite of that cell's current state), then every other cell the
// pointer moves over during the same stroke is set to that same value —
// like a drawing/fill tool, instead of requiring one tap per cell. A plain
// tap still works exactly as before (paints just the one cell).
export function renderCorrectGrid(container, grid, onToggle) {
  container.innerHTML = "";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "board-cell";
      if (grid[r][c]) btn.classList.add("is-filled");
      btn.dataset.row = String(r);
      btn.dataset.col = String(c);
      btn.setAttribute("role", "gridcell");
      btn.setAttribute("aria-label", cellLabel(r, c, grid[r][c]));
      container.appendChild(btn);
    }
  }

  function setCell(btn, value) {
    const r = Number(btn.dataset.row);
    const c = Number(btn.dataset.col);
    if (grid[r][c] === value) return;
    grid[r][c] = value;
    btn.classList.toggle("is-filled", value);
    btn.setAttribute("aria-label", cellLabel(r, c, value));
    btn.classList.add("is-tapped");
    setTimeout(() => btn.classList.remove("is-tapped"), 150);
    if (onToggle) onToggle(r, c, value);
  }

  function cellFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    return el instanceof HTMLElement && el.classList.contains("board-cell") && container.contains(el) ? el : null;
  }

  let painting = false;
  let paintValue = true;
  let touchedThisStroke = null;

  container.addEventListener("pointerdown", (event) => {
    const btn = event.target.closest(".board-cell");
    if (!btn) return;
    event.preventDefault();
    painting = true;
    touchedThisStroke = new Set([btn]);
    paintValue = !grid[Number(btn.dataset.row)][Number(btn.dataset.col)];
    setCell(btn, paintValue);
    try {
      // Capture so pointermove keeps firing on `container` even if the
      // finger strays slightly outside the grid mid-stroke. Best-effort:
      // if the platform won't grant capture, the tap above already
      // registered, and dragging still works as long as the pointer stays
      // over the grid.
      container.setPointerCapture(event.pointerId);
    } catch {
      // no-op
    }
  });

  container.addEventListener("pointermove", (event) => {
    if (!painting) return;
    const btn = cellFromPoint(event.clientX, event.clientY);
    if (!btn || touchedThisStroke.has(btn)) return;
    touchedThisStroke.add(btn);
    setCell(btn, paintValue);
  });

  function endStroke() {
    painting = false;
    touchedThisStroke = null;
  }
  container.addEventListener("pointerup", endStroke);
  container.addEventListener("pointercancel", endStroke);
}

function cellLabel(r, c, filled) {
  return `Baris ${r + 1} kolom ${c + 1}, ${filled ? "terisi" : "kosong"}`;
}

// Re-applies classification results onto an already-rendered correct-grid
// without rebuilding it (keeps DOM identity stable while dragging a slider).
export function updateCorrectGridValues(container, grid) {
  const cells = container.children;
  let i = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const btn = cells[i++];
      btn.classList.toggle("is-filled", grid[r][c]);
      btn.setAttribute("aria-label", cellLabel(r, c, grid[r][c]));
    }
  }
}

// Static (non-interactive) mini 8x8 preview used in results.
export function renderMiniGrid(container, { existingGrid, newCells, clearCells }) {
  container.innerHTML = "";
  container.classList.add("mini-grid");
  const newSet = newCells || new Set();
  const clearSet = clearCells || new Set();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const cell = document.createElement("div");
      cell.className = "mini-cell";
      const key = `${r},${c}`;
      if (newSet.has(key)) cell.classList.add("is-new");
      else if (existingGrid[r][c]) cell.classList.add("is-existing");
      if (clearSet.has(key)) cell.classList.add("will-clear");
      container.appendChild(cell);
    }
  }
}

// ---------------------------------------------------------------------
// Piece gallery
// ---------------------------------------------------------------------

function renderPieceShape(piece) {
  const grid = document.createElement("div");
  grid.className = "piece-tile__grid";
  grid.style.gridTemplateColumns = `repeat(${piece.width}, 8px)`;
  grid.style.gridTemplateRows = `repeat(${piece.height}, 8px)`;
  const filledSet = new Set(piece.cells.map(([r, c]) => `${r},${c}`));
  for (let r = 0; r < piece.height; r++) {
    for (let c = 0; c < piece.width; c++) {
      const cell = document.createElement("div");
      cell.className = "piece-tile__cell";
      if (filledSet.has(`${r},${c}`)) cell.classList.add("is-filled");
      grid.appendChild(cell);
    }
  }
  return grid;
}

// `selectedCounts` is a Map<pieceId, count> — a piece can appear in more
// than one tray slot (the real game's tray can hand out duplicate shapes),
// so selection is a count per piece, not a single selected/unselected flag.
export function renderPieceGallery(container, pieces, selectedCounts, onSelect) {
  container.innerHTML = "";
  pieces.forEach((piece, index) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "piece-tile";
    tile.style.setProperty("--stagger-index", String(index));
    tile.setAttribute("role", "option");
    tile.dataset.pieceId = piece.id;

    const count = selectedCounts.get(piece.id) || 0;
    const isSelected = count > 0;
    tile.classList.toggle("is-selected", isSelected);
    tile.setAttribute("aria-selected", String(isSelected));
    tile.setAttribute("aria-label", `Piece ${piece.id}${isSelected ? `, dipilih ${count}x` : ""}`);

    tile.appendChild(renderPieceShape(piece));

    if (count > 0) {
      const badge = document.createElement("span");
      badge.className = "piece-tile__badge";
      badge.textContent = String(count);
      tile.appendChild(badge);
    }

    tile.addEventListener("click", () => onSelect(piece));
    container.appendChild(tile);
  });
}

// Renders the 3 tray slots. Tapping a filled slot removes just that
// occurrence (by index), independent of which gallery tile it came from.
export function renderTraySlots(container, selectedPieces, onRemoveAt) {
  container.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const piece = selectedPieces[i];

    if (!piece) {
      const slot = document.createElement("div");
      slot.className = "tray-slot tray-slot--empty";
      slot.setAttribute("role", "listitem");
      slot.textContent = `Slot ${i + 1}`;
      container.appendChild(slot);
      continue;
    }

    const slot = document.createElement("button");
    slot.type = "button";
    slot.className = "tray-slot tray-slot--filled";
    slot.setAttribute("role", "listitem");
    slot.setAttribute("aria-label", `Slot ${i + 1}: piece ${piece.id}. Ketuk untuk hapus.`);
    slot.appendChild(renderPieceShape(piece));

    const removeIcon = document.createElement("span");
    removeIcon.className = "tray-slot__remove";
    removeIcon.setAttribute("aria-hidden", "true");
    removeIcon.innerHTML =
      '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
    slot.appendChild(removeIcon);

    slot.addEventListener("click", () => onRemoveAt(i));
    container.appendChild(slot);
  }
}

export function updateSelectionSummary(el, selectedPieces) {
  el.textContent = selectedPieces.length === 0 ? "Belum ada piece dipilih" : `${selectedPieces.length}/3 slot terisi`;
}

// ---------------------------------------------------------------------
// Crop overlay
// ---------------------------------------------------------------------

const CORNER_KEYS = ["tl", "tr", "bl", "br"];
const ACCENT = "#5e6ad2";

export function positionCropHandles(handleEls, corners, stageEl) {
  const rect = stageEl.getBoundingClientRect();
  for (const key of CORNER_KEYS) {
    const pt = corners[key];
    handleEls[key].style.left = `${pt.x * rect.width}px`;
    handleEls[key].style.top = `${pt.y * rect.height}px`;
  }
}

export function renderCropOverlay(svgEl, corners, bilinear) {
  svgEl.setAttribute("viewBox", "0 0 100 100");
  const parts = [];
  const poly = CORNER_KEYS_POLY(corners).map((p) => `${p.x * 100},${p.y * 100}`).join(" ");
  parts.push(
    `<polygon points="${poly}" fill="none" stroke="${ACCENT}" stroke-width="0.5" vector-effect="non-scaling-stroke" />`
  );
  for (let i = 1; i < 8; i++) {
    const t = i / 8;
    const a = bilinear(corners, t, 0);
    const b = bilinear(corners, t, 1);
    parts.push(gridLine(a, b));
    const c = bilinear(corners, 0, t);
    const d = bilinear(corners, 1, t);
    parts.push(gridLine(c, d));
  }
  svgEl.innerHTML = parts.join("");
}

function gridLine(a, b) {
  return `<line x1="${a.x * 100}" y1="${a.y * 100}" x2="${b.x * 100}" y2="${b.y * 100}" stroke="rgba(255,255,255,0.35)" stroke-width="0.25" vector-effect="non-scaling-stroke" />`;
}

function CORNER_KEYS_POLY(corners) {
  return [corners.tl, corners.tr, corners.br, corners.bl];
}

// ---------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------

export function renderResultSteps(container, stepVMs) {
  container.innerHTML = "";
  stepVMs.forEach((vm, i) => {
    const li = document.createElement("li");
    li.className = "result-step";
    li.style.setProperty("--stagger-index", String(i));

    const num = document.createElement("div");
    num.className = "result-step__number";
    num.textContent = String(i + 1);

    const gridWrap = document.createElement("div");
    gridWrap.className = "result-step__grid-wrap";
    const gridEl = document.createElement("div");
    renderMiniGrid(gridEl, { existingGrid: vm.existingGrid, newCells: vm.newCells, clearCells: vm.clearCells });
    gridWrap.appendChild(gridEl);

    const info = document.createElement("div");
    info.className = "result-step__info";
    const title = document.createElement("div");
    title.className = "result-step__title";
    title.textContent = `Piece ${vm.pieceId} → baris ${vm.r + 1}, kolom ${vm.c + 1}`;
    const detail = document.createElement("div");
    detail.className = "result-step__detail tabular";
    detail.textContent = vm.cleared > 0 ? `Clear ${vm.cleared} baris/kolom` : "Tidak ada clear";
    info.append(title, detail);

    li.append(num, gridWrap, info);
    container.appendChild(li);
  });
}

export function renderResultSummary({ totalSkor, survivability, lubangTerisolasi }) {
  qs("result-total-score").querySelector(".result-score__value").textContent = String(totalSkor);
  qs("result-meta").innerHTML = `
    <span>Survivability: <span class="tabular">${survivability}</span></span>
    <span>Lubang terisolasi: <span class="tabular">${lubangTerisolasi}</span></span>
  `;
}

export function renderAltList(container, candidates, activeIndex, onSelect) {
  container.innerHTML = "";
  candidates.forEach((candidate, i) => {
    if (i === activeIndex) return;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "alt-card";
    card.innerHTML = `
      <span class="alt-card__rank">${i + 1}</span>
      <span>${candidate.langkah.map((s) => s.pieceId).join(" → ")}</span>
      <span class="alt-card__score tabular">${candidate.totalSkor}</span>
    `;
    card.addEventListener("click", () => onSelect(i));
    container.appendChild(card);
  });
}
