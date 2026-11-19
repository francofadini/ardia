const NONE: readonly string[] = [];
const memo = new WeakMap<object, WeakMap<object, readonly string[]>>();

export function changedIds<T>(next: Record<string, T>, prev: Record<string, T>): readonly string[] {
  if (next === prev) return NONE;
  let byPrev = memo.get(next);
  const hit = byPrev?.get(prev);
  if (hit) return hit;
  const ids: string[] = [];
  const keys = Object.keys(next);
  let added = 0;
  for (let i = 0; i < keys.length; i++) {
    const id = keys[i]!;
    const before = prev[id];
    if (next[id] === before) continue;
    ids.push(id);
    if (before === undefined) added++;
  }
  const before = Object.keys(prev);
  if (before.length > keys.length - added) for (const id of before) if (next[id] === undefined) ids.push(id);
  if (!byPrev) memo.set(next, (byPrev = new WeakMap()));
  byPrev.set(prev, ids);
  return ids;
}
