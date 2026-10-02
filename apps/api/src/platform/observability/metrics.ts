/**
 * Tiny in-process metrics registry with Prometheus text output. No dependency, no secrets: label
 * values are route *patterns* and enums (never ids, paths with ids, tokens or user content).
 */
const LATENCY_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000];

type Labels = Record<string, string | number>;

const labelKey = (labels: Labels): string =>
  Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/[\\"\n]/g, "_").slice(0, 80)}"`)
    .join(",");

interface Histogram {
  buckets: number[];
  sum: number;
  count: number;
}

export class Metrics {
  private readonly counters = new Map<string, Map<string, number>>();
  private readonly histograms = new Map<string, Map<string, Histogram>>();
  private readonly help = new Map<string, string>();
  /** Cardinality guard: a bug or an attacker must not be able to grow label sets without bound. */
  private static readonly MAX_SERIES_PER_METRIC = 500;

  describe(name: string, help: string): void {
    this.help.set(name, help);
  }

  inc(name: string, labels: Labels = {}, by = 1): void {
    const series = this.counters.get(name) ?? new Map<string, number>();
    this.counters.set(name, series);
    const key = labelKey(labels);
    if (!series.has(key) && series.size >= Metrics.MAX_SERIES_PER_METRIC) return;
    series.set(key, (series.get(key) ?? 0) + by);
  }

  observe(name: string, valueMs: number, labels: Labels = {}): void {
    const series = this.histograms.get(name) ?? new Map<string, Histogram>();
    this.histograms.set(name, series);
    const key = labelKey(labels);
    let h = series.get(key);
    if (!h) {
      if (series.size >= Metrics.MAX_SERIES_PER_METRIC) return;
      h = { buckets: LATENCY_BUCKETS_MS.map(() => 0), sum: 0, count: 0 };
      series.set(key, h);
    }
    LATENCY_BUCKETS_MS.forEach((le, i) => {
      if (valueMs <= le) h!.buckets[i]! += 1;
    });
    h.sum += valueMs;
    h.count += 1;
  }

  /** Test helper. */
  counter(name: string, labels: Labels = {}): number {
    return this.counters.get(name)?.get(labelKey(labels)) ?? 0;
  }

  render(): string {
    const lines: string[] = [];
    for (const [name, series] of this.counters) {
      if (this.help.has(name)) lines.push(`# HELP ${name} ${this.help.get(name)}`);
      lines.push(`# TYPE ${name} counter`);
      for (const [key, value] of series) lines.push(`${name}${key ? `{${key}}` : ""} ${value}`);
    }
    for (const [name, series] of this.histograms) {
      if (this.help.has(name)) lines.push(`# HELP ${name} ${this.help.get(name)}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [key, h] of series) {
        const sep = key ? "," : "";
        LATENCY_BUCKETS_MS.forEach((le, i) => lines.push(`${name}_bucket{${key}${sep}le="${le}"} ${h.buckets[i]}`));
        lines.push(`${name}_bucket{${key}${sep}le="+Inf"} ${h.count}`);
        lines.push(`${name}_sum${key ? `{${key}}` : ""} ${h.sum}`);
        lines.push(`${name}_count${key ? `{${key}}` : ""} ${h.count}`);
      }
    }
    return `${lines.join("\n")}\n`;
  }
}
