import type { Line } from './simplify.ts';

/**
 * OSM way（out geom 形式）の端点 node id 一致によるチェーン結合。
 * build-highway-lines / build-route-lines で共用する。
 * ref/name での論理マージはしない — 表記ゆれ解決が割に合わない。
 */

export interface OsmWay {
  type: string;
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export function lineLengthKm(line: Line): number {
  let km = 0;
  for (let i = 1; i < line.length; i++) km += haversineKm(line[i - 1], line[i]);
  return km;
}

interface Chain {
  coords: Line;
  head: number; // 先頭の node id
  tail: number; // 末尾の node id
}

/** 端点 node id が一致する way をグリーディに連結する */
export function joinWays(ways: OsmWay[]): Line[] {
  // 端点 node id → その端点を持つ未使用 way のリスト
  const byEndpoint = new Map<number, OsmWay[]>();
  const add = (nodeId: number, w: OsmWay) => {
    const list = byEndpoint.get(nodeId);
    if (list) list.push(w);
    else byEndpoint.set(nodeId, [w]);
  };
  for (const w of ways) {
    add(w.nodes[0], w);
    add(w.nodes[w.nodes.length - 1], w);
  }
  const used = new Set<number>();
  const takeAt = (nodeId: number): OsmWay | null => {
    const list = byEndpoint.get(nodeId);
    if (!list) return null;
    while (list.length > 0) {
      const w = list[list.length - 1];
      if (used.has(w.id)) {
        list.pop();
        continue;
      }
      used.add(w.id);
      return w;
    }
    return null;
  };
  const wayCoords = (w: OsmWay): Line => w.geometry.map((g) => [g.lon, g.lat]);

  const chains: Line[] = [];
  for (const start of ways) {
    if (used.has(start.id)) continue;
    used.add(start.id);
    const chain: Chain = {
      coords: wayCoords(start),
      head: start.nodes[0],
      tail: start.nodes[start.nodes.length - 1],
    };
    // 末尾側・先頭側それぞれへ、つながる way が尽きるまで伸ばす
    for (;;) {
      const w = takeAt(chain.tail);
      if (!w) break;
      const coords = wayCoords(w);
      if (w.nodes[0] === chain.tail) {
        chain.coords.push(...coords.slice(1));
        chain.tail = w.nodes[w.nodes.length - 1];
      } else {
        chain.coords.push(...coords.reverse().slice(1));
        chain.tail = w.nodes[0];
      }
    }
    for (;;) {
      const w = takeAt(chain.head);
      if (!w) break;
      const coords = wayCoords(w);
      if (w.nodes[w.nodes.length - 1] === chain.head) {
        chain.coords.unshift(...coords.slice(0, -1));
        chain.head = w.nodes[0];
      } else {
        chain.coords.unshift(...coords.reverse().slice(0, -1));
        chain.head = w.nodes[w.nodes.length - 1];
      }
    }
    chains.push(chain.coords);
  }
  return chains;
}
