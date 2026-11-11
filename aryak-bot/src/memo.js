// Memoise a pure function of one string (names are matched again and again in the reports). The cache is cleared when it grows past [max].
export function memoString(fn, max = 20000) {
  const cache = new Map();
  return (arg) => {
    const k = typeof arg === 'string' ? arg : String(arg ?? '');
    if (cache.has(k)) return cache.get(k);
    const made = fn(arg);
    if (cache.size >= max) cache.clear();
    cache.set(k, made);
    return made;
  };
}
