import sharp from 'sharp';

export interface ImageStats {
  /** 中〜高彩度ピクセルの割合（0〜1）。色付き蓋の判定に使う */
  colorFraction: number;
  /** 64bit dHash（16進文字列） */
  dhash: string;
  /** 大きな円の輪郭がどれだけ揃っているか（0〜1）。蓋以外の風景写真の除外に使う */
  circleScore: number;
}

/**
 * マンホール写真の解析。
 * - colorFraction: HSV彩度 > 0.35 かつ明度が極端でないピクセルの割合。
 *   錆・土汚れ（低〜中彩度の茶系）は拾わず、塗装された蓋（高彩度の赤緑青黄）を拾う。
 * - dhash: 9x8 グレースケールの隣接輝度比較による知覚ハッシュ。同デザイン検出用
 */
export async function analyzeImage(buf: Buffer): Promise<ImageStats> {
  const { data, info } = await sharp(buf)
    .resize(64, 64, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let colored = 0;
  const total = info.width * info.height;
  for (let i = 0; i < total; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (sat > 0.35 && max > 50 && max < 250) colored++;
  }

  const gray = await sharp(buf).resize(9, 8, { fit: 'fill' }).grayscale().raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? '1' : '0';
    }
  }
  const dhash = BigInt('0b' + bits).toString(16).padStart(16, '0');

  return { colorFraction: colored / total, dhash, circleScore: await circleScore(buf) };
}

/**
 * Hough 風の円検出。中央付近の候補中心×半径で円周をサンプリングし、
 * 「勾配が強く、向きが半径方向に揃っている」円周点の割合の最大値を返す。
 * 蓋の正面写真は 0.5 前後以上、円形の蓋が写っていない風景写真は 0.2 台以下になる
 */
async function circleScore(buf: Buffer): Promise<number> {
  const SIZE = 96;
  const { data, info } = await sharp(buf)
    .resize(SIZE, SIZE, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  let magSum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const sx =
        -data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1] +
        data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1];
      const sy =
        -data[i - w - 1] - 2 * data[i - w] - data[i - w + 1] +
        data[i + w - 1] + 2 * data[i + w] + data[i + w + 1];
      gx[i] = sx;
      gy[i] = sy;
      const m = Math.hypot(sx, sy);
      mag[i] = m;
      magSum += m;
    }
  }
  const magThr = Math.max(40, (magSum / ((w - 2) * (h - 2))) * 0.8);

  const N = 72;
  const cosT: number[] = [], sinT: number[] = [];
  for (let k = 0; k < N; k++) {
    cosT.push(Math.cos((2 * Math.PI * k) / N));
    sinT.push(Math.sin((2 * Math.PI * k) / N));
  }

  // 斜め撮影で縦につぶれた蓋も拾えるよう、縦横比違いの楕円も試す
  const ASPECTS = [1, 0.85, 0.7, 0.55];
  let best = 0;
  for (let cy = Math.floor(h * 0.3); cy <= Math.ceil(h * 0.7); cy += 3) {
    for (let cx = Math.floor(w * 0.3); cx <= Math.ceil(w * 0.7); cx += 3) {
      const rMax = Math.min(cx, w - 1 - cx);
      for (let r = Math.floor(Math.min(w, h) * 0.28); r <= rMax; r += 2) {
        for (const asp of ASPECTS) {
          const ry = r * asp;
          if (cy - ry < 1 || cy + ry > h - 2) continue;
          let hit = 0;
          for (let k = 0; k < N; k++) {
            const x = Math.round(cx + r * cosT[k]);
            const y = Math.round(cy + ry * sinT[k]);
            const i = y * w + x;
            if (mag[i] < magThr) continue;
            // 楕円の外向き法線: (cos/rx, sin/ry) 方向
            const nx = cosT[k] / r, ny = sinT[k] / ry;
            const nl = Math.hypot(nx, ny);
            const dot = Math.abs(gx[i] * nx + gy[i] * ny) / (nl * (mag[i] || 1));
            if (dot > 0.75) hit++;
          }
          const score = hit / N;
          if (score > best) best = score;
        }
      }
    }
  }
  return best;
}

export function hammingHex(a: string, b: string): number {
  const x = BigInt('0x' + a) ^ BigInt('0x' + b);
  let n = x, c = 0;
  while (n > 0n) {
    c += Number(n & 1n);
    n >>= 1n;
  }
  return c;
}
