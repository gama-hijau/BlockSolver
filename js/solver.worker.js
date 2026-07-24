// solver.worker.js — runs the exhaustive solver off the main thread so the
// UI never freezes while searching.
import { solveWithProgress } from "./solver.js";

self.onmessage = (event) => {
  const { board, pieces } = event.data;
  const boardRows = Uint8Array.from(board);

  const result = solveWithProgress(boardRows, pieces, (fraction) => {
    self.postMessage({ type: "progress", fraction });
  });

  self.postMessage({ type: "result", result });
};
