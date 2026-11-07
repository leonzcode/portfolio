/* Freeride's rock field, worked out in a module worker (2026-11-07): how steep the snow is at each texel of the snow
   shader's rock map (materials.js), from Freeride's snow without its rock faces, with the land's own say in how rocky
   each place is (frland.js rockNy). Sent the windows ({ N, r, x0, z0 } each), it posts back each one's texels as it
   finishes it: { i, data }. The same sums as materials.js bakeRockField, which the page falls back on. */
import { Land } from './frland.js?v=19';

onmessage = e => {
  const land = new Land();
  e.data.levels.forEach((L, i) => {
    const { N, r, x0, z0 } = L, M = N + 2, hs = new Float32Array(M * M), data = new Uint8Array(N * N);
    // the heights at the texels' middles and one ring round them
    for (let j = 0; j < M; j++) { const z = z0 + (j - 0.5) * r; for (let k = 0; k < M; k++) hs[j * M + k] = land.snowAt(x0 + (k - 0.5) * r, z); }
    // the normal's y from the slope across two texels either way, then the land's own say
    for (let j = 0; j < N; j++) for (let k = 0; k < N; k++) {
      const q = (j + 1) * M + k + 1, gx = (hs[q + 1] - hs[q - 1]) / (2 * r), gz = (hs[q + M] - hs[q - M]) / (2 * r);
      const ny = land.rockNy(x0 + (k + 0.5) * r, z0 + (j + 0.5) * r, 1 / Math.sqrt(1 + gx * gx + gz * gz));
      data[j * N + k] = Math.round(255 * Math.max(0, Math.min(1, ny)));
    }
    postMessage({ i, data }, [data.buffer]);
  });
};
