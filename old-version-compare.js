// benchmark-cleaners.js
// Run: node benchmark-cleaners.js

const cleanerV14 = require('fast-clean-1.4.0');
const cleanerV152 = require('fast-clean-1.5.2');

const fs = require('fs');
const path = require('path');
const files = fs.readdirSync('./samples');

// ---- Config ----
const WARMUP_ITERS = 5;
const MEASURE_ITERS = 50;

// ---- Tiny helpers ----
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

// Accurate timer using hrtime for iterations; perf_hooks for coarse stamps
function timeOne(fn) {
  const t1 = hrNow();
  fn();
  const t2 = hrNow();
  return hrDiffMs(t1, t2);
}

function runBench(label, fn, iters = MEASURE_ITERS, warmup = WARMUP_ITERS) {
  // Warmup
  for (let i = 0; i < warmup; i++) timeOne(fn);

  // Measure
  const samples = new Array(iters);
  for (let i = 0; i < iters; i++) {
    samples[i] = timeOne(fn);
  }

  // Stats
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const sum = samples.reduce((a, b) => a + b, 0);
  const mean = sum / samples.length;
  const med = median(samples);

  return { label, samples, min, median: med, mean, max };
}

// Pretty header
function printHeader(title) {
  const line = '─'.repeat(Math.max(10, title.length + 4));
  console.log(`\n${line}\n  ${title}\n${line}`);
}

const perFileResults = [];

for (const fileName of files) {
  const filePath = path.join(__dirname, 'samples', fileName);
  const objToClean = require(filePath);

  printHeader(`Benchmark: ${fileName}`);

  const v14 = runBench('v1.4.0', () => cleanerV14.clean(objToClean));
  const v152 = runBench('v1.5.2', () => cleanerV152.clean(objToClean));

  const faster = v14.mean < v152.mean ? v14 : v152;
  const slower = v14.mean < v152.mean ? v152 : v14;
  const speedupPct = ((slower.mean - faster.mean) / slower.mean) * 100;

  // Per-file table
  const table = [
    {
      Version: 'v1.4.0',
      'min': fmtMs(v14.min),
      'median': fmtMs(v14.median),
      'mean': fmtMs(v14.mean),
      'max': fmtMs(v14.max),
      'ops/sec': opsPerSec(v14.mean).toFixed(1),
    },
    {
      Version: 'v1.5.2',
      'min': fmtMs(v152.min),
      'median': fmtMs(v152.median),
      'mean': fmtMs(v152.mean),
      'max': fmtMs(v152.max),
      'ops/sec': opsPerSec(v152.mean).toFixed(1),
    },
  ];

  console.table(table);

  // Verdict for this file
  console.log(
    `Fastest for ${fileName}: ${faster.label} (${fmtMs(faster.mean)} avg) ` +
    `→ ${fmtPct(speedupPct)} vs ${slower.label}`
  );

  perFileResults.push({
    file: fileName,
    v14Mean: v14.mean,
    v152Mean: v152.mean,
    winner: faster.label,
    speedupPct,
  });
}

// ---- Overall summary ----
printHeader('Overall Summary');

const overall = perFileResults.reduce(
  (acc, r) => {
    acc.v14Sum += r.v14Mean;
    acc.v152Sum += r.v152Mean;
    if (r.winner === 'v1.4.0') acc.v14Wins++;
    if (r.winner === 'v1.5.2') acc.v152Wins++;
    acc.rows.push({
      File: r.file,
      Winner: r.winner,
      'v1.4.0 mean': fmtMs(r.v14Mean),
      'v1.5.2 mean': fmtMs(r.v152Mean),
      'Speedup (winner)': fmtPct(r.speedupPct),
    });
    return acc;
  },
  { v14Sum: 0, v152Sum: 0, v14Wins: 0, v152Wins: 0, rows: [] }
);

console.table(overall.rows);

const v14OverallMean = overall.v14Sum / perFileResults.length;
const v152OverallMean = overall.v152Sum / perFileResults.length;
const overallFaster =
  v14OverallMean < v152OverallMean ? 'v1.4.0' : 'v1.5.2';
const overallSpeedupPct =
  ((Math.max(v14OverallMean, v152OverallMean) - Math.min(v14OverallMean, v152OverallMean)) /
    Math.max(v14OverallMean, v152OverallMean)) * 100;

console.log(
  `Winner (overall mean across ${perFileResults.length} files): ${overallFaster} ` +
  `→ ${fmtPct(overallSpeedupPct)}`
);