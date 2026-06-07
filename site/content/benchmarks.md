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
|   Create 1k |  **20.9 ms** |  20.4 ms |  20.5 ms |  19.7 ms |  26.7 ms |  29.5 ms |
|  Replace 1k |  **23.4 ms** |  22.5 ms |  23.2 ms |  21.2 ms |  32.2 ms |  30.0 ms |
| Update 10th |  **11.4 ms** |  10.8 ms |  11.1 ms |  10.0 ms |  16.7 ms |  20.7 ms |
|      Select |   **2.5 ms** |   3.1 ms |   4.7 ms |   2.6 ms |   5.6 ms |   5.7 ms |
|        Swap |  **13.7 ms** |  12.9 ms |  13.2 ms |  11.4 ms | 106.5 ms |  22.8 ms |
|      Remove |  **10.3 ms** |   9.7 ms |   9.8 ms |   9.2 ms |  14.5 ms |  12.7 ms |
|  Create 10k | **218.2 ms** | 209.6 ms | 211.4 ms | 195.9 ms | 420.4 ms | 568.1 ms |
|   Append 1k |  **25.4 ms** |  22.6 ms |  22.8 ms |  22.3 ms |  31.4 ms |  30.2 ms |
|       Clear |   **9.9 ms** |  10.9 ms |  10.0 ms |   8.5 ms |  19.1 ms |  21.8 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |  vs React |    vs Elm |
| ----------: | -------: | --------: | ---------: | --------: | --------: |
|   Create 1k |      -2% |       -2% |        -6% |  **+28%** |  **+41%** |
|  Replace 1k |      -4% |         = |        -9% |  **+38%** |  **+28%** |
| Update 10th |      -5% |       -3% |       -12% |  **+46%** |  **+82%** |
|      Select | **+24%** |  **+88%** |    **+4%** | **+124%** | **+128%** |
|        Swap |      -6% |       -4% |       -17% | **+677%** |  **+66%** |
|      Remove |      -6% |       -5% |       -11% |  **+41%** |  **+23%** |
|  Create 10k |      -4% |       -3% |       -10% |  **+93%** | **+160%** |
|   Append 1k |     -11% |      -10% |       -12% |  **+24%** |  **+19%** |
|       Clear | **+10%** |       +1% |       -14% |  **+93%** | **+120%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |  React |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: | -----: |
|     Ready | **0.6 MB** | 0.6 MB | 0.7 MB |  0.6 MB | 1.2 MB | 0.7 MB |
|    Run 1k | **2.4 MB** | 2.6 MB | 2.9 MB |  1.8 MB | 4.4 MB | 3.6 MB |
|     Clear | **0.9 MB** | 0.7 MB | 1.0 MB |  0.6 MB | 2.0 MB | 1.0 MB |

</details>

## Bundle Size (KB)

<details>
<summary>Raw data</summary>

|    Operation |        LLui |   Solid |  Svelte | vanilla |    React |     Elm |
| -----------: | ----------: | ------: | ------: | ------: | -------: | ------: |
| Uncompressed | **24.9 KB** | 11.5 KB | 34.3 KB | 11.3 KB | 190.3 KB | 31.7 KB |
|      Gzipped |  **8.2 KB** |  4.5 KB | 12.2 KB |  2.5 KB |  51.4 KB | 10.4 KB |

</details>

## Methodology

- **Tool:** [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) by Stefan Krause
- **Browser:** Chrome (headful), CPU throttling 4x
- **Iterations:** 15 per benchmark, median reported
- **Machine:** MacBook Pro M5 Max, 128 GB RAM
- **LLui version:** Latest from `opt` branch with all compiler optimizations enabled
- **Data source:** [`benchmarks/jfb-baseline.json`](/benchmark-data.json) — raw JSON

Numbers fluctuate ±5% between runs. Differences <5% should be considered noise.
