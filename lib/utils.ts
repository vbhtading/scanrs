export function formatINR(n: number): string {
  if (n == null || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: n >= 1000 ? 0 : 2,
  }).format(n);
}

export function formatNumber(n: number): string {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1e7) return (n / 1e7).toFixed(1) + "Cr";
  if (n >= 1e5) return (n / 1e5).toFixed(1) + "L";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return n.toLocaleString("en-IN");
}

export function formatPercent(n: number): string {
  if (n == null || isNaN(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(1)}%`;
}

export function formatMarketCap(crores: number): string {
  if (crores == null || isNaN(crores)) return "—";
  if (crores >= 100000) return (crores / 100000).toFixed(1) + "L Cr";
  if (crores >= 10000) return (crores / 1000).toFixed(0) + "K Cr";
  return Math.round(crores).toLocaleString("en-IN") + " Cr";
}

export async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R | null>
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;

  const runners = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const current = index++;
      const result = await worker(items[current]);
      if (result !== null) {
        results.push(result);
      }
    }
  });

  await Promise.all(runners);
  return results;
}
