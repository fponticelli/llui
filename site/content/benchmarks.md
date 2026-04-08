---
title: Benchmarks
description: js-framework-benchmark results — LLui vs Solid, Svelte, React, vanilla JS
---

Results from [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (krausest). All frameworks measured under identical conditions.

## Timings (ms, median of 15 iterations)

| Operation | LLui | Solid | Svelte | vanilla | React | Elm |
|---:|---:|---:|---:|---:|---:|---:|
| Create 1k | **23.4 ms** | 23.5 ms | 23.4 ms | 22.8 ms | 26.7 ms | 38.1 ms |
| Replace 1k | **24.9 ms** | 25.6 ms | 25.8 ms | 23.7 ms | 32.2 ms | 35.9 ms |
| Update 10th | **13.2 ms** | 13.3 ms | 14.3 ms | 13.0 ms | 16.7 ms | 27.1 ms |
| Select | **3.0 ms** | 3.9 ms | 5.6 ms | 6.1 ms | 5.6 ms | 23.3 ms |
| Swap | **9.6 ms** | 16.1 ms | 15.7 ms | 14.2 ms | 106.5 ms | 27.4 ms |
| Remove | **11.2 ms** | 11.5 ms | 12.8 ms | 13.2 ms | 14.5 ms | 29.6 ms |
| Create 10k | **232.3 ms** | 232.1 ms | 233.9 ms | 218.4 ms | 420.4 ms | 597.5 ms |
| Append 1k | **27.7 ms** | 26.8 ms | 27.0 ms | 25.9 ms | 31.4 ms | 37.7 ms |
| Clear | **12.0 ms** | 11.6 ms | 11.2 ms | 9.3 ms | 19.1 ms | 23.2 ms |


## LLui vs Peers

| Operation | vs Solid | vs Svelte | vs vanilla | vs React | vs Elm |
|---:|---:|---:|---:|---:|---:|
| Create 1k | = | = | -3% | **+14%** | **+63%** |
| Replace 1k | +3% | **+4%** | -5% | **+29%** | **+44%** |
| Update 10th | = | **+8%** | -2% | **+27%** | **+105%** |
| Select | **+30%** | **+87%** | **+103%** | **+87%** | **+677%** |
| Swap | **+68%** | **+64%** | **+48%** | **+1009%** | **+185%** |
| Remove | +3% | **+14%** | **+18%** | **+29%** | **+164%** |
| Create 10k | = | = | -6% | **+81%** | **+157%** |
| Append 1k | -3% | -3% | -6% | **+13%** | **+36%** |
| Clear | -3% | -7% | -22% | **+59%** | **+93%** |


Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

## Visual Comparison

**Create 1k**

```
LLui     ████████████████████████████████████████ 23.4 ms
Solid    ████████████████████████████████████████ 23.5 ms
Svelte   ████████████████████████████████████████ 23.4 ms
vanilla  ███████████████████████████████████████ 22.8 ms
```

**Replace 1k**

```
LLui     ███████████████████████████████████████ 24.9 ms
Solid    ████████████████████████████████████████ 25.6 ms
Svelte   ████████████████████████████████████████ 25.8 ms
vanilla  █████████████████████████████████████ 23.7 ms
```

**Update 10th**

```
LLui     █████████████████████████████████████ 13.2 ms
Solid    █████████████████████████████████████ 13.3 ms
Svelte   ████████████████████████████████████████ 14.3 ms
vanilla  ████████████████████████████████████ 13.0 ms
```

**Select**

```
LLui     ████████████████████ 3.0 ms
Solid    ██████████████████████████ 3.9 ms
Svelte   █████████████████████████████████████ 5.6 ms
vanilla  ████████████████████████████████████████ 6.1 ms
```

**Swap**

```
LLui     ████████████████████████ 9.6 ms
Solid    ████████████████████████████████████████ 16.1 ms
Svelte   ███████████████████████████████████████ 15.7 ms
vanilla  ███████████████████████████████████ 14.2 ms
```

**Remove**

```
LLui     ██████████████████████████████████ 11.2 ms
Solid    ███████████████████████████████████ 11.5 ms
Svelte   ███████████████████████████████████████ 12.8 ms
vanilla  ████████████████████████████████████████ 13.2 ms
```

**Create 10k**

```
LLui     ████████████████████████████████████████ 232.3 ms
Solid    ████████████████████████████████████████ 232.1 ms
Svelte   ████████████████████████████████████████ 233.9 ms
vanilla  █████████████████████████████████████ 218.4 ms
```

**Append 1k**

```
LLui     ████████████████████████████████████████ 27.7 ms
Solid    ███████████████████████████████████████ 26.8 ms
Svelte   ███████████████████████████████████████ 27.0 ms
vanilla  █████████████████████████████████████ 25.9 ms
```

**Clear**

```
LLui     ████████████████████████████████████████ 12.0 ms
Solid    ███████████████████████████████████████ 11.6 ms
Svelte   █████████████████████████████████████ 11.2 ms
vanilla  ███████████████████████████████ 9.3 ms
```



## Memory (MB)

| Operation | LLui | Solid | Svelte | vanilla | React | Elm |
|---:|---:|---:|---:|---:|---:|---:|
| Ready | **0.5 MB** | 0.5 MB | 0.7 MB | 0.5 MB | 1.2 MB | 0.7 MB |
| Run 1k | **3.2 MB** | 2.6 MB | 2.9 MB | 1.8 MB | 4.4 MB | 3.6 MB |
| Clear | **1.0 MB** | 0.7 MB | 1.0 MB | 0.6 MB | 2.0 MB | 1.0 MB |


## Bundle Size (KB)

| Operation | LLui | Solid | Svelte | vanilla | React | Elm |
|---:|---:|---:|---:|---:|---:|---:|
| Uncompressed | **26.4 KB** | 11.5 KB | 34.3 KB | 11.3 KB | 190.3 KB | 31.7 KB |
| Gzipped | **7.4 KB** | 4.5 KB | 12.2 KB | 2.5 KB | 51.4 KB | 10.4 KB |


## Methodology

- **Tool:** [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) by Stefan Krause
- **Browser:** Chrome (headful), CPU throttling 4x
- **Iterations:** 15 per benchmark, median reported
- **Machine:** Same machine, same session for all frameworks
- **LLui version:** Latest from `opt` branch with all compiler optimizations enabled
- **Data source:** [`benchmarks/jfb-baseline.json`](/benchmark-data.json) — raw JSON

Numbers fluctuate ±5% between runs. Differences <5% should be considered noise.
