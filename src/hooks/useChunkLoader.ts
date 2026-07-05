const cache = new Map<string, Promise<unknown>>();

/** public/data/ 配下の JSON チャンクを fetch し、メモリキャッシュする */
export function loadChunk<T>(path: string): Promise<T> {
  const url = `${import.meta.env.BASE_URL}data/${path}`;
  let p = cache.get(url);
  if (!p) {
    p = fetch(url).then((res) => {
      if (!res.ok) throw new Error(`データ取得失敗: ${path} (${res.status})`);
      return res.json();
    });
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p as Promise<T>;
}
