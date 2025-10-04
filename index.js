// benchmark-multi-cleaners.js
// Run: node --expose-gc benchmark-multi-cleaners.js   (for best memory accuracy)

const fastCleaner = require('fast-clean');       // fastCleaner.clean(obj, { nullCleaner: true })
const deepClean = require('clean-deep');         // deepClean(obj)
const deepCleaner = require('deep-cleaner');     // deepCleaner.clean(obj)
const _ = require('lodash');

const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────────
const SAMPLES_DIR = path.join(__dirname, 'samples');
const WARMUP_ITERS = 1;
const MEASURE_ITERS = 5;
const USE_GC = typeof global.gc === 'function'; // enable with: node --expose-gc

// ─── Helpers ───────────────────────────────────────────────────────────────────
const fmtMs = (n) => `${n.toFixed(3)} ms`;
const fmtPct = (n) => `${(n >= 0 ? '+' : '')}${n.toFixed(1)}%`;
const opsPerSec = (avgMs) => (1000 / avgMs);
const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};
const hrNow = () => process.hrtime.bigint();
const hrDiffMs = (start, end) => Number(end - start) / 1e6;
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const bytes = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
function printHeader(title) {
  const line = '─'.repeat(Math.max(10, title.length + 4));
  console.log(`\n${line}\n  ${title}\n${line}`);
}
function timeOne(fn) {
  const t1 = hrNow();
  fn();
  const t2 = hrNow();
  return hrDiffMs(t1, t2);
}
function memNow() {
  const { heapUsed, rss } = process.memoryUsage();
  return { heapUsed, rss };
}

/**
 * Benchmarks a function and also records memory:
 * - peakHeap: max heapUsed observed during measured iterations
 * - avgHeapDelta: average (heapUsed_after_iter - heapUsed_before_iter)
 * - peakRSS: max rss observed
 */
function runBench(name, fn, iters = MEASURE_ITERS, warmup = WARMUP_ITERS) {
  // Warmup
  for (let i = 0; i < warmup; i++) timeOne(fn);

  // If GC available, stabilize before measuring
  if (USE_GC) global.gc();

  const samples = new Array(iters);
  const heapDeltas = new Array(iters);
  let peakHeap = memNow().heapUsed;
  let peakRSS = memNow().rss;

  for (let i = 0; i < iters; i++) {
    // pre-sample (after opportunistic GC)
    if (USE_GC) global.gc();
    const pre = memNow();

    samples[i] = timeOne(fn);

    // post-sample
    const post = memNow();

    // track deltas & peaks (without GC to capture transient growth)
    const delta = Math.max(0, post.heapUsed - pre.heapUsed);
    heapDeltas[i] = delta;
    if (post.heapUsed > peakHeap) peakHeap = post.heapUsed;
    if (post.rss > peakRSS) peakRSS = post.rss;

    // every few iters, try to release
    if (USE_GC && (i + 1) % 3 === 0) global.gc();
  }

  // Timing stats
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const sum = samples.reduce((a, b) => a + b, 0);
  const mean = sum / samples.length;
  const med = median(samples);

  // Memory stats
  const avgHeapDelta = heapDeltas.reduce((a, b) => a + b, 0) / heapDeltas.length;

  return {
    name,
    samples,
    min,
    median: med,
    mean,
    max,
    // memory:
    peakHeap,
    avgHeapDelta,
    peakRSS,
  };
}

// ─── Normalize array behavior so all libs clean elements ───────────────────────
const normalizeArray = (fn) => (input) => {
  if (Array.isArray(input)) {
    // Clean each element. Clone isolation happens in the caller before this runs.
    return input.map((x) => fn(x));
  }
  return fn(input);
};

// ─── Define contenders (wrap to normalize APIs & array semantics) ─────────────
const contenders = [
  { name: 'deep-cleaner', run: normalizeArray((obj) => deepCleaner.clean(obj)) },
  { name: 'clean-deep', run: normalizeArray((obj) => deepClean(obj)) },
  { name: 'fast-clean (nullCleaner=true)', run: normalizeArray((obj) => fastCleaner.clean(obj, { nullCleaner: true, cleanInPlace: true })) },
];

// ─── Load samples ──────────────────────────────────────────────────────────────
const files = fs.readdirSync(SAMPLES_DIR).filter(f => !f.startsWith('.'));

printHeader('Environment');
console.log(`Node: ${process.version}`);
console.log(`GC enabled: ${USE_GC ? 'yes' : 'no'} (use --expose-gc to enable)`);
console.log(`Warmup: ${WARMUP_ITERS}, Iterations: ${MEASURE_ITERS}`);
console.log(`Samples dir: ${SAMPLES_DIR}`);

const perFileResults = [];

for (const fileName of files) {
  const filePath = path.join(SAMPLES_DIR, fileName);
  const objToClean = require(filePath);

  printHeader(`Benchmark: ${fileName}`);

  // Randomize order per file to minimize thermal/adjacency bias
  const order = shuffle(contenders);

  // Baseline: clone-only for this input
  const cloneOnly = runBench('clone-only', () => _.cloneDeep(objToClean));
  console.log(`Clone-only mean for ${fileName}: ${fmtMs(cloneOnly.mean)}`);

  const results = order.map(({ name, run }) => {
    if (USE_GC) global.gc();
    return runBench(name, () => run(_.cloneDeep(objToClean)));
  });

  // Print table with timing + memory
  const table = results.map(r => ({
    Cleaner: r.name,
    min: fmtMs(r.min),
    median: fmtMs(r.median),
    mean: fmtMs(r.mean),
    max: fmtMs(r.max),
    'ops/sec': opsPerSec(r.mean).toFixed(1),
    'peak heap': bytes(r.peakHeap),
    'avg heap Δ': bytes(r.avgHeapDelta),
    'peak RSS': bytes(r.peakRSS),
  }));
  console.table(table);

  // Rank & winner line (by mean time)
  const ranked = [...results].sort((a, b) => a.mean - b.mean);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  const speedupPct = ((runnerUp.mean - winner.mean) / runnerUp.mean) * 100;

  console.log(
    `Fastest for ${fileName}: ${winner.name} (${fmtMs(winner.mean)} avg) ` +
    `→ ${fmtPct(speedupPct)} vs next best (${runnerUp.name})`
  );

  perFileResults.push({
    file: fileName,
    rows: results.map(r => ({
      name: r.name,
      mean: r.mean,
      peakHeap: r.peakHeap,
      avgHeapDelta: r.avgHeapDelta,
      peakRSS: r.peakRSS,
    })),
    winner: winner.name,
  });

  // ─── Extra test: large array of 100,000 elements (only for small.json) ──────
  if (fileName === 'small.json') {
    printHeader(`Benchmark: ${fileName} × 100,000 array`);
    const BIG_N = 100_000;

    // Ensure there's actual removable work per element.
    const objToCleanWithNull = { ...objToClean, _tmpShouldGo: null };

    // Build a big array of 100k entries referencing the same base object.
    // (Each measured iteration deep-clones the array, so cleaners operate
    //  on a fully independent structure every time.)
    const bigArray = Array.from({ length: BIG_N }, () => objToCleanWithNull);

    // Baseline: clone-only for the big array
    const cloneOnlyBig = runBench('clone-only (×100k)', () => _.cloneDeep(bigArray));
    console.log(`Clone-only mean for ${fileName} × ${BIG_N}: ${fmtMs(cloneOnlyBig.mean)}`);

    const arrayResults = order.map(({ name, run }) => {
      if (USE_GC) global.gc();
      return runBench(name, () => run(_.cloneDeep(bigArray)));
    });

    // Print timing + memory table for the array test
    const arrayTable = arrayResults.map(r => ({
      Cleaner: r.name,
      min: fmtMs(r.min),
      median: fmtMs(r.median),
      mean: fmtMs(r.mean),
      max: fmtMs(r.max),
      'ops/sec': opsPerSec(r.mean).toFixed(1),
      'peak heap': bytes(r.peakHeap),
      'avg heap Δ': bytes(r.avgHeapDelta),
      'peak RSS': bytes(r.peakRSS),
    }));
    console.table(arrayTable);

    // Rank & winner line (by mean time)
    const rankedArray = [...arrayResults].sort((a, b) => a.mean - b.mean);
    const winnerArray = rankedArray[0];
    const runnerUpArray = rankedArray[1];
    const speedupPctArray = ((runnerUpArray.mean - winnerArray.mean) / runnerUpArray.mean) * 100;

    console.log(
      `Fastest for ${fileName} × ${BIG_N}: ${winnerArray.name} (${fmtMs(winnerArray.mean)} avg) ` +
      `→ ${fmtPct(speedupPctArray)} vs next best (${runnerUpArray.name})`
    );

    // Include in overall aggregation as a separate "file"
    perFileResults.push({
      file: `${fileName} (×${BIG_N})`,
      rows: arrayResults.map(r => ({
        name: r.name,
        mean: r.mean,
        peakHeap: r.peakHeap,
        avgHeapDelta: r.avgHeapDelta,
        peakRSS: r.peakRSS,
      })),
      winner: winnerArray.name,
    });
  }
}

// ─── Overall Summary ───────────────────────────────────────────────────────────
printHeader('Overall Summary');

const cleanerNames = contenders.map(c => c.name);
const agg = Object.fromEntries(
  cleanerNames.map(n => [n, { timeSum: 0, heapPeakMax: 0, heapDeltaSum: 0, rssPeakMax: 0 }])
);
const winCounts = Object.fromEntries(cleanerNames.map(n => [n, 0]));

for (const r of perFileResults) {
  for (const row of r.rows) {
    const a = agg[row.name];
    a.timeSum += row.mean;
    a.heapPeakMax = Math.max(a.heapPeakMax, row.peakHeap);
    a.heapDeltaSum += row.avgHeapDelta;
    a.rssPeakMax = Math.max(a.rssPeakMax, row.peakRSS);
  }
  winCounts[r.winner] += 1;
}

const overallRows = cleanerNames.map(name => {
  const a = agg[name];
  const avgOfMeans = a.timeSum / perFileResults.length;
  const avgHeapDelta = a.heapDeltaSum / perFileResults.length;
  return {
    Cleaner: name,
    'overall mean': fmtMs(avgOfMeans),
    'ops/sec': opsPerSec(avgOfMeans).toFixed(1),
    Wins: winCounts[name],
    'max peak heap': bytes(a.heapPeakMax),
    'avg heap Δ': bytes(avgHeapDelta),
    'max peak RSS': bytes(a.rssPeakMax),
  };
}).sort((x, y) => {
  const ax = Number(x['overall mean'].replace(' ms', ''));
  const ay = Number(y['overall mean'].replace(' ms', ''));
  return ax - ay;
});

console.table(overallRows);

// Winner line
const winnerOverall = overallRows[0];
const runnerOverall = overallRows[1];
const wMs = Number(winnerOverall['overall mean'].replace(' ms', ''));
const rMs = Number(runnerOverall['overall mean'].replace(' ms', ''));
const overallSpeedupPct = ((rMs - wMs) / rMs) * 100;

console.log(
  `Winner (overall across ${perFileResults.length} files): ${winnerOverall.Cleaner} ` +
  `→ ${fmtPct(overallSpeedupPct)} vs next best`
);
