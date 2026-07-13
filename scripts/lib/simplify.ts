/** 開いた折れ線（LineString）用のジオメトリ間引き。閉環用は build-areacodes.ts の simplifyRing を参照 */

export type Line = [number, number][];

/** Douglas-Peucker。始点・終点を固定して開いた折れ線を間引く */
export function simplifyLine(line: Line, tol: number): Line {
  if (line.length <= 2) return line;
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    let maxD = -1;
    let maxK = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(line[k], line[i], line[j]);
      if (d > maxD) {
        maxD = d;
        maxK = k;
      }
    }
    if (maxD > tol) {
      keep[maxK] = 1;
      stack.push([i, maxK], [maxK, j]);
    }
  }
  const out: Line = [];
  for (let k = 0; k < line.length; k++) if (keep[k]) out.push(line[k]);
  return out;
}

/** 4桁（約11m）に丸め、連続重複点を除去。オーバーレイ表示専用の精度 */
export function roundLine4(line: Line): Line {
  const out: Line = [];
  for (const [x, y] of line) {
    const p: [number, number] = [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  return out;
}
