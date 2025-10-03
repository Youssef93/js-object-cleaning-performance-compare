// benchmark-multi-cleaners.js
// Run: node [--expose-gc] benchmark-multi-cleaners.js

const fastCleaner = require('fast-clean');       // fastCleaner.clean(obj, { nullCleaner: true })
const deepClean = require('clean-deep');         // deepClean(obj)
const deepCleaner = require('deep-cleaner');     // deepCleaner.clean(obj)

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
function runBench(name, fn, iters = MEASURE_ITERS, warmup = WARMUP_ITERS) {
  // Warmup
  for (let i = 0; i < warmup; i++) timeOne(fn);

  // Measure
  const samples = new Array(iters);
  for (let i = 0; i < iters; i++) {
    if (USE_GC && i % 10 === 0) global.gc();
    samples[i] = timeOne(fn);
  }

  // Stats
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const sum = samples.reduce((a, b) => a + b, 0);
  const mean = sum / samples.length;
  const med = median(samples);

  return { name, samples, min, median: med, mean, max };
}

// ─── Define contenders (wrap to normalize APIs) ────────────────────────────────
const contenders = [
  {
    name: 'deep-cleaner',
    run: (obj) => deepCleaner.clean(obj),
  },
  {
    name: 'clean-deep',
    run: (obj) => deepClean(obj),
  },
  {
    name: 'fast-clean (nullCleaner=true)',
    run: (obj) => fastCleaner.clean(obj, { nullCleaner: true }),
  },
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

  const results = order.map(({ name, run }) => {
    if (USE_GC) global.gc();
    return runBench(name, () => run(objToClean));
  });

  // Print table
  const table = results.map(r => ({
    Cleaner: r.name,
    min: fmtMs(r.min),
    median: fmtMs(r.median),
    mean: fmtMs(r.mean),
    max: fmtMs(r.max),
    'ops/sec': opsPerSec(r.mean).toFixed(1),
  }));
  console.table(table);

  // Rank & winner line
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
    rows: results.map(r => ({ name: r.name, mean: r.mean })),
    winner: winner.name,
  });
}

// ─── Overall Summary ───────────────────────────────────────────────────────────
printHeader('Overall Summary');

const cleanerNames = contenders.map(c => c.name);
const overallAgg = Object.fromEntries(cleanerNames.map(n => [n, 0]));
const winCounts = Object.fromEntries(cleanerNames.map(n => [n, 0]));

for (const r of perFileResults) {
  for (const row of r.rows) {
    overallAgg[row.name] += row.mean;
  }
  winCounts[r.winner] += 1;
}

const overallRows = cleanerNames.map(name => {
  const avgOfMeans = overallAgg[name] / perFileResults.length;
  return {
    Cleaner: name,
    'overall mean': fmtMs(avgOfMeans),
    'ops/sec': opsPerSec(avgOfMeans).toFixed(1),
    Wins: winCounts[name],
  };
}).sort((a, b) => {
  // sort by overall mean ascending
  const aMs = Number(a['overall mean'].replace(' ms', ''));
  const bMs = Number(b['overall mean'].replace(' ms', ''));
  return aMs - bMs;
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