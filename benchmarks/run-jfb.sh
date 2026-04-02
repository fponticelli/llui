#!/usr/bin/env bash
set -e

REPO="$(dirname "$0")/js-framework-benchmark-repo"
LLUI_SRC="$(dirname "$0")/js-framework-benchmark"
BASELINE="$(dirname "$0")/jfb-baseline.json"

if [ ! -d "$REPO" ]; then
  echo "ERROR: jfb repo not found at $REPO"
  echo "Clone it: git clone https://github.com/krausest/js-framework-benchmark.git $REPO"
  exit 1
fi

# Rebuild LLui
echo "Building LLui..."
cd "$LLUI_SRC" && pnpm build-prod 2>/dev/null

# Copy to jfb repo
rm -rf "$REPO/frameworks/keyed/llui/dist"
mkdir -p "$REPO/frameworks/keyed/llui/dist"
cp "$LLUI_SRC/dist/main.js" "$REPO/frameworks/keyed/llui/dist/"
cp "$LLUI_SRC/index.html" "$REPO/frameworks/keyed/llui/"

# Start server if not running
if ! curl -s http://localhost:8080/ls > /dev/null 2>&1; then
  echo "Starting jfb server..."
  cd "$REPO" && npm start &
  sleep 3
fi

# Run benchmark (LLui only)
echo "Running benchmark..."
cd "$REPO/webdriver-ts"
node dist/benchmarkRunner.js --framework keyed/llui --headless

echo ""
echo "=== Results ==="
node -e "
const fs = require('fs')
const baseline = JSON.parse(fs.readFileSync('$BASELINE', 'utf8'))
const dir = 'results'

const benchmarks = [
  { id: '01_run1k', label: 'Create 1k' },
  { id: '02_replace1k', label: 'Replace 1k' },
  { id: '03_update10th1k_x16', label: 'Update 10th' },
  { id: '04_select1k', label: 'Select' },
  { id: '05_swap1k', label: 'Swap 1↔998' },
  { id: '06_remove-one-1k', label: 'Remove' },
  { id: '07_create10k', label: 'Create 10k' },
  { id: '08_create1k-after1k_x2', label: 'Append 1k' },
  { id: '09_clear1k_x8', label: 'Clear' },
]

const fws = ['llui', 'vanillajs', 'react', 'solid', 'svelte', 'elm']

// Read fresh LLui results
for (const b of benchmarks) {
  try {
    const data = JSON.parse(fs.readFileSync(dir + '/llui-v0.0.0-keyed_' + b.id + '.json', 'utf8'))
    baseline.llui[b.id] = data.values?.total?.median ?? null
  } catch {}
}

const header = 'Operation'.padEnd(16) + fws.map(n => n.padStart(10)).join('')
console.log(header)
console.log('-'.repeat(header.length))
for (const b of benchmarks) {
  let line = b.label.padEnd(16)
  for (const fw of fws) {
    const v = baseline[fw]?.[b.id]
    line += v != null ? v.toFixed(1).padStart(10) : '       N/A'
  }
  console.log(line)
}

console.log()
console.log('Relative to LLui:')
console.log('-'.repeat(header.length))
for (const b of benchmarks) {
  let line = b.label.padEnd(16)
  const base = baseline.llui?.[b.id]
  for (let i = 0; i < fws.length; i++) {
    const v = baseline[fws[i]]?.[b.id]
    if (v == null || base == null) { line += '       N/A'; continue }
    if (i === 0) { line += '        ——'; continue }
    const pct = ((v - base) / base) * 100
    line += (pct >= 0 ? '+' : '') + pct.toFixed(0) + '%'
    line = line.padEnd(16 + (i + 1) * 10)
  }
  console.log(line)
}
"
