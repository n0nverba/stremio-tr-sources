export class MemoryCache<T> {
  private readonly entries = new Map<
    string,
    {
      value: T;
      expires: number;
    }
  >();
  hits = 0;
  misses = 0;
  constructor(
    private readonly maxEntries = 500,
    private readonly now = Date.now,
  ) {}
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expires <= this.now()) {
      this.entries.delete(key);
      this.misses++;
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.hits++;
    return structuredClone(entry.value);
  }
  set(key: string, value: T, ttlMs: number) {
    this.entries.delete(key);
    for (const [existing, item] of this.entries)
      if (item.expires <= this.now()) this.entries.delete(existing);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    if (ttlMs > 0)
      this.entries.set(key, {
        value: structuredClone(value),
        expires: this.now() + ttlMs,
      });
  }
  clear() {
    this.entries.clear();
  }
  stats() {
    return {
      size: this.entries.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
    };
  }
}
