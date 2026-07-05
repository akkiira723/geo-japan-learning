import sharp from 'sharp';

export interface ImageStats {
  /** 中〜高彩度ピクセルの割合（0〜1）。色付き蓋の判定に使う */
  colorFraction: number;
  /** 64bit dHash（16進文字列） */
  dhash: string;
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

  return { colorFraction: colored / total, dhash };
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
