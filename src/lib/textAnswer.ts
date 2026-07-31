/**
 * テキスト入力回答の判定・ヒント生成。
 * 正解は公式表記（「みやき町」などひらがな交じりを含む）との完全一致主義で、
 * 表記ゆれの吸収（NFKC・異体字など）は行わない。
 */

/** 回答入力の正規化。空白（全角含む）の除去のみ行う */
export function normalizeAnswer(s: string): string {
  return s.replace(/\s+/g, '');
}

/** 政令市の区への編入答え（例: さいたま市岩槻区）を「市まで」と「区」に分ける */
const CITY_WARD = /^(.+市)(.+区)$/;

/**
 * 入力が正解の市町村名と一致するか。
 * 「◯◯市△△区」形式の正解は、市名まで（「◯◯市」）の入力も正解として扱う。
 */
export function matchesAnswer(input: string, answer: string): boolean {
  const norm = normalizeAnswer(input);
  if (norm.length === 0) return false;
  const normAnswer = normalizeAnswer(answer);
  if (norm === normAnswer) return true;
  const ward = normAnswer.match(CITY_WARD);
  return ward !== null && norm === ward[1];
}

/** 末尾種別ごとの読み候補。町=まち/ちょう・村=むら/そん は自治体ごとに異なる */
const SUFFIX_READINGS: Record<string, string[]> = {
  市: ['し'],
  町: ['まち', 'ちょう'],
  村: ['むら', 'そん'],
  区: ['く'],
};

/**
 * ふりがなヒント: 末尾の 市/町/村/区 の読みだけ開示し、残りを ○ でマスクする。
 * 例: (北広島市, きたひろしまし) → ○○○○○○し、(東和町, とうわちょう) → ○○○ちょう
 */
export function maskKana(name: string, kana: string): string {
  const candidates = SUFFIX_READINGS[name[name.length - 1]] ?? [];
  for (const suffix of candidates) {
    if (kana.length > suffix.length && kana.endsWith(suffix)) {
      return '○'.repeat(kana.length - suffix.length) + suffix;
    }
  }
  return '○'.repeat(kana.length);
}

/**
 * 文字数ヒント: 名前の構造（文字数と末尾の 市/町/村/区）だけを残してマスクする。
 * 例: 北広島市 → 〇〇〇市、さいたま市岩槻区 → 〇〇〇〇市〇〇区
 */
export function maskName(name: string): string {
  const ward = name.match(CITY_WARD);
  if (ward) {
    return '〇'.repeat(ward[1].length - 1) + '市' + '〇'.repeat(ward[2].length - 1) + '区';
  }
  const last = name[name.length - 1];
  if (name.length > 1 && (last === '市' || last === '町' || last === '村' || last === '区')) {
    return '〇'.repeat(name.length - 1) + last;
  }
  return '〇'.repeat(name.length);
}
