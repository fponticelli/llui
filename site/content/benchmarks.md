---
title: Benchmarks
description: js-framework-benchmark results — LLui vs Solid, Svelte, React, vanilla JS
---

Results from [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (krausest). All frameworks measured under identical conditions.

## Timings (ms)

<details>
<summary>Raw data</summary>

|   Operation |         LLui |    Solid |   Svelte |  vanilla |    React |      Elm |
| ----------: | -----------: | -------: | -------: | -------: | -------: | -------: |
|   Create 1k |  **23.5 ms** |  23.5 ms |  23.4 ms |  22.6 ms |  26.7 ms |  37.5 ms |
|  Replace 1k |  **25.3 ms** |  25.6 ms |  26.0 ms |  23.4 ms |  32.2 ms |  31.5 ms |
| Update 10th |  **14.8 ms** |  14.7 ms |  15.1 ms |  13.4 ms |  16.7 ms |  27.5 ms |
|      Select |   **3.3 ms** |   4.4 ms |   6.1 ms |   4.9 ms |   5.6 ms |  22.4 ms |
|        Swap |  **11.3 ms** |  17.2 ms |  17.3 ms |  15.1 ms | 106.5 ms |  27.6 ms |
|      Remove |  **11.6 ms** |  11.9 ms |  12.4 ms |  11.3 ms |  14.5 ms |  29.0 ms |
|  Create 10k | **235.3 ms** | 235.1 ms | 237.3 ms | 219.7 ms | 420.4 ms | 608.6 ms |
|   Append 1k |  **27.9 ms** |  27.0 ms |  27.2 ms |  26.2 ms |  31.4 ms |  38.6 ms |
|       Clear |  **12.5 ms** |  12.3 ms |  11.9 ms |   9.7 ms |  19.1 ms |  22.9 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |  vs React |    vs Elm |
| ----------: | -------: | --------: | ---------: | --------: | --------: |
|   Create 1k |        = |         = |        -4% |  **+14%** |  **+60%** |
|  Replace 1k |      +1% |       +3% |        -8% |  **+27%** |  **+25%** |
| Update 10th |        = |       +2% |        -9% |  **+13%** |  **+86%** |
|      Select | **+33%** |  **+85%** |   **+48%** |  **+70%** | **+579%** |
|        Swap | **+52%** |  **+53%** |   **+34%** | **+842%** | **+144%** |
|      Remove |      +3% |   **+7%** |        -3% |  **+25%** | **+150%** |
|  Create 10k |        = |         = |        -7% |  **+79%** | **+159%** |
|   Append 1k |      -3% |       -3% |        -6% |  **+13%** |  **+38%** |
|       Clear |      -2% |       -5% |       -22% |  **+53%** |  **+83%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |  React |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: | -----: |
|     Ready | **0.6 MB** | 0.5 MB | 0.7 MB |  0.6 MB | 1.2 MB | 0.7 MB |
|    Run 1k | **3.2 MB** | 2.6 MB | 2.9 MB |  1.8 MB | 4.4 MB | 3.6 MB |
|     Clear | **1.0 MB** | 0.7 MB | 1.0 MB |  0.6 MB | 2.0 MB | 1.0 MB |

</details>

## Bundle Size (KB)

<details>
<summary>Raw data</summary>

|    Operation |        LLui |   Solid |  Svelte | vanilla |    React |     Elm |
| -----------: | ----------: | ------: | ------: | ------: | -------: | ------: |
| Uncompressed | **26.7 KB** | 11.5 KB | 34.3 KB | 11.3 KB | 190.3 KB | 31.7 KB |
|      Gzipped |  **7.5 KB** |  4.5 KB | 12.2 KB |  2.5 KB |  51.4 KB | 10.4 KB |

</details>

## Methodology

- **Tool:** [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) by Stefan Krause
- **Browser:** Chrome (headful), CPU throttling 4x
- **Iterations:** 15 per benchmark, median reported
- **Machine:** MacBook Pro M5 Max, 128 GB RAM
- **LLui version:** Latest from `opt` branch with all compiler optimizations enabled
- **Data source:** [`benchmarks/jfb-baseline.json`](/benchmark-data.json) — raw JSON

Numbers fluctuate ±5% between runs. Differences <5% should be considered noise.
