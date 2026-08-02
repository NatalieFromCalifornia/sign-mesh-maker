export interface QuantizedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Every Nth pixel is enough to find clusters and keeps large images fast. */
const SAMPLE_STRIDE = 2;
const DEFAULT_ITERATIONS = 12;

/**
 * k-means colour quantization, as requirements §9.1 specifies.
 *
 * imagetracer's own palette selection is not usable here. Its deterministic
 * sampler walks a fixed grid and misses colours that cover real area but few
 * sample points — on a poster with large black regions it returned no black at
 * all, so every black pixel snapped to the nearest surviving entry and the
 * artwork lost a whole colour. Its RGB-cube mode instead spends slots on pure
 * blue, green, cyan and magenta that appear nowhere in the image, and its
 * random mode is, unavoidably, random.
 *
 * Seeding is farthest-point rather than random: start from the mean, then
 * repeatedly take the sampled colour furthest from everything chosen so far.
 * That is deterministic — the same image always yields the same palette, so
 * nudging the colour count refines the result instead of reshuffling it — and
 * it deliberately reaches for extremes, which is exactly how a large black
 * region gets a centroid of its own.
 */
/**
 * Clusters covering less of the image than this are discarded and their pixels
 * reassigned.
 *
 * Antialiased edges are a thin band of in-between colors — a black shape on
 * cream produces greys that belong to neither. k-means will happily spend
 * clusters on them, and the tracer then draws each as a thin outline, which is
 * the grubby fringe that appears along every edge. They cover very little area,
 * so area is what distinguishes them from real colors.
 */
const MIN_CLUSTER_SHARE = 0.012;

export function quantize(
  data: ImageData,
  count: number,
  iterations: number = DEFAULT_ITERATIONS,
  minShare: number = MIN_CLUSTER_SHARE,
): QuantizedColor[] {
  const pixels = data.data;
  const samples: number[] = [];

  for (let i = 0; i < pixels.length; i += 4 * SAMPLE_STRIDE) {
    // Fully transparent pixels have no colour to cluster (§9.1).
    if (pixels[i + 3] < 128) continue;
    samples.push(pixels[i], pixels[i + 1], pixels[i + 2]);
  }

  const sampleCount = samples.length / 3;
  if (sampleCount === 0) return [{ r: 0, g: 0, b: 0, a: 255 }];

  const k = Math.max(1, Math.min(count, sampleCount));
  const centroids = seedCentroids(samples, sampleCount, k);

  const sums = new Float64Array(k * 3);
  const counts = new Uint32Array(k);

  for (let pass = 0; pass < iterations; pass++) {
    sums.fill(0);
    counts.fill(0);

    for (let s = 0; s < sampleCount; s++) {
      const nearest = nearestCentroid(samples, s * 3, centroids, k);
      sums[nearest * 3] += samples[s * 3];
      sums[nearest * 3 + 1] += samples[s * 3 + 1];
      sums[nearest * 3 + 2] += samples[s * 3 + 2];
      counts[nearest]++;
    }

    let moved = 0;
    for (let c = 0; c < k; c++) {
      // An empty cluster keeps its position rather than jumping somewhere
      // arbitrary, which would break determinism between runs.
      if (counts[c] === 0) continue;
      const r = sums[c * 3] / counts[c];
      const g = sums[c * 3 + 1] / counts[c];
      const b = sums[c * 3 + 2] / counts[c];
      moved += Math.abs(r - centroids[c * 3]) + Math.abs(g - centroids[c * 3 + 1]) +
        Math.abs(b - centroids[c * 3 + 2]);
      centroids[c * 3] = r;
      centroids[c * 3 + 1] = g;
      centroids[c * 3 + 2] = b;
    }

    // Converged; further passes cannot change the result.
    if (moved < 1) break;
  }

  // Drop the edge-fringe clusters, keeping at least two so there is still
  // something to separate.
  const ranked = [...Array(k).keys()]
    .filter((c) => counts[c] > 0)
    .sort((a, b) => counts[b] - counts[a]);

  const kept = ranked.filter(
    (c, rank) => rank < 2 || counts[c] / sampleCount >= minShare,
  );

  if (kept.length < ranked.length) {
    // Let the survivors re-absorb the reassigned pixels, so a colour that
    // swallowed a fringe settles on its true centre rather than being pulled
    // toward the edge tones.
    const survivors = new Float64Array(kept.length * 3);
    kept.forEach((c, i) => {
      survivors[i * 3] = centroids[c * 3];
      survivors[i * 3 + 1] = centroids[c * 3 + 1];
      survivors[i * 3 + 2] = centroids[c * 3 + 2];
    });
    return refine(samples, sampleCount, survivors, kept.length, iterations);
  }

  return finalize(centroids, counts, kept);
}

/**
 * Distance below which two centroids are the same colour to the eye.
 *
 * With spare clusters, k-means will happily split one flat colour into two
 * imperceptibly different ones. Each becomes its own printed layer — a second
 * filament change for a difference nobody can see — while a genuinely distinct
 * colour goes unrepresented.
 */
const DUPLICATE_CENTROID_DISTANCE = 10;

/**
 * Rounds surviving centroids to a palette, folding away perceptual duplicates.
 *
 * Candidates are compared only against colours already kept, largest cluster
 * first, so merges never chain: two colours each close to a mid-tone but far
 * from each other stay separate.
 */
function finalize(
  centroids: ArrayLike<number>,
  counts: ArrayLike<number>,
  order: number[],
): QuantizedColor[] {
  const byPopulation = [...order].sort((a, b) => counts[b] - counts[a]);
  const palette: QuantizedColor[] = [];

  for (const c of byPopulation) {
    const candidate = {
      r: Math.round(centroids[c * 3]),
      g: Math.round(centroids[c * 3 + 1]),
      b: Math.round(centroids[c * 3 + 2]),
      a: 255,
    };

    const duplicate = palette.some((kept) => {
      const dr = kept.r - candidate.r;
      const dg = kept.g - candidate.g;
      const db = kept.b - candidate.b;
      return Math.sqrt(dr * dr + dg * dg + db * db) < DUPLICATE_CENTROID_DISTANCE;
    });

    if (!duplicate) palette.push(candidate);
  }

  return palette.length > 0 ? palette : [{ r: 0, g: 0, b: 0, a: 255 }];
}

/** Lloyd's algorithm over a fixed set of centroids. */
function refine(
  samples: number[],
  sampleCount: number,
  centroids: Float64Array,
  k: number,
  iterations: number,
): QuantizedColor[] {
  const sums = new Float64Array(k * 3);
  const counts = new Uint32Array(k);

  for (let pass = 0; pass < iterations; pass++) {
    sums.fill(0);
    counts.fill(0);

    for (let s = 0; s < sampleCount; s++) {
      const nearest = nearestCentroid(samples, s * 3, centroids, k);
      sums[nearest * 3] += samples[s * 3];
      sums[nearest * 3 + 1] += samples[s * 3 + 1];
      sums[nearest * 3 + 2] += samples[s * 3 + 2];
      counts[nearest]++;
    }

    let moved = 0;
    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) continue;
      const r = sums[c * 3] / counts[c];
      const g = sums[c * 3 + 1] / counts[c];
      const b = sums[c * 3 + 2] / counts[c];
      moved += Math.abs(r - centroids[c * 3]) + Math.abs(g - centroids[c * 3 + 1]) +
        Math.abs(b - centroids[c * 3 + 2]);
      centroids[c * 3] = r;
      centroids[c * 3 + 1] = g;
      centroids[c * 3 + 2] = b;
    }
    if (moved < 1) break;
  }

  const populated = [...Array(k).keys()].filter((c) => counts[c] > 0);
  return finalize(centroids, counts, populated);
}

function seedCentroids(samples: number[], sampleCount: number, k: number): Float64Array {
  const centroids = new Float64Array(k * 3);

  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (let s = 0; s < sampleCount; s++) {
    mr += samples[s * 3];
    mg += samples[s * 3 + 1];
    mb += samples[s * 3 + 2];
  }
  centroids[0] = mr / sampleCount;
  centroids[1] = mg / sampleCount;
  centroids[2] = mb / sampleCount;

  // Track each sample's distance to the nearest chosen centroid so seeding stays
  // O(k · n) rather than O(k² · n).
  const nearest = new Float64Array(sampleCount);
  for (let s = 0; s < sampleCount; s++) {
    nearest[s] = squaredDistance(samples, s * 3, centroids, 0);
  }

  for (let c = 1; c < k; c++) {
    let farthest = 0;
    let best = -1;
    for (let s = 0; s < sampleCount; s++) {
      if (nearest[s] > best) {
        best = nearest[s];
        farthest = s;
      }
    }

    centroids[c * 3] = samples[farthest * 3];
    centroids[c * 3 + 1] = samples[farthest * 3 + 1];
    centroids[c * 3 + 2] = samples[farthest * 3 + 2];

    for (let s = 0; s < sampleCount; s++) {
      const d = squaredDistance(samples, s * 3, centroids, c * 3);
      if (d < nearest[s]) nearest[s] = d;
    }
  }

  return centroids;
}

function squaredDistance(
  a: ArrayLike<number>,
  ai: number,
  b: ArrayLike<number>,
  bi: number,
): number {
  const dr = a[ai] - b[bi];
  const dg = a[ai + 1] - b[bi + 1];
  const db = a[ai + 2] - b[bi + 2];
  return dr * dr + dg * dg + db * db;
}

function nearestCentroid(
  samples: ArrayLike<number>,
  si: number,
  centroids: ArrayLike<number>,
  k: number,
): number {
  let best = Infinity;
  let index = 0;
  for (let c = 0; c < k; c++) {
    const d = squaredDistance(samples, si, centroids, c * 3);
    if (d < best) {
      best = d;
      index = c;
    }
  }
  return index;
}
