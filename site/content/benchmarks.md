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
|   Create 1k |  **21.1 ms** |  20.5 ms |  20.8 ms |  20.0 ms |  26.7 ms |  29.9 ms |
|  Replace 1k |  **23.0 ms** |  22.6 ms |  23.1 ms |  21.2 ms |  32.2 ms |  25.8 ms |
| Update 10th |  **11.1 ms** |  10.7 ms |  11.1 ms |   9.8 ms |  16.7 ms |  21.5 ms |
|      Select |   **2.5 ms** |   3.2 ms |   4.5 ms |   2.5 ms |   5.6 ms |   5.2 ms |
|        Swap |  **13.7 ms** |  12.9 ms |  13.2 ms |  11.3 ms | 106.5 ms |  23.1 ms |
|      Remove |  **10.4 ms** |   9.7 ms |   9.9 ms |   9.2 ms |  14.5 ms |  12.9 ms |
|  Create 10k | **216.0 ms** | 210.2 ms | 211.3 ms | 197.0 ms | 420.4 ms | 566.2 ms |
|   Append 1k |  **25.3 ms** |  22.9 ms |  23.0 ms |  22.5 ms |  31.4 ms |  30.3 ms |
|       Clear |  **10.0 ms** |  10.6 ms |  10.0 ms |   8.4 ms |  19.1 ms |  21.7 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |  vs React |    vs Elm |
| ----------: | -------: | --------: | ---------: | --------: | --------: |
|   Create 1k |      -3% |       -1% |        -5% |  **+27%** |  **+42%** |
|  Replace 1k |      -2% |         = |        -8% |  **+40%** |  **+12%** |
| Update 10th |      -4% |         = |       -12% |  **+50%** |  **+94%** |
|      Select | **+28%** |  **+80%** |          = | **+124%** | **+108%** |
|        Swap |      -6% |       -4% |       -18% | **+677%** |  **+69%** |
|      Remove |      -7% |       -5% |       -12% |  **+39%** |  **+24%** |
|  Create 10k |      -3% |       -2% |        -9% |  **+95%** | **+162%** |
|   Append 1k |      -9% |       -9% |       -11% |  **+24%** |  **+20%** |
|       Clear |  **+6%** |         = |       -16% |  **+91%** | **+117%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |  React |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: | -----: |
|     Ready | **0.6 MB** | 0.6 MB | 0.7 MB |  0.5 MB | 1.2 MB | 0.7 MB |
|    Run 1k | **2.6 MB** | 2.6 MB | 2.9 MB |  1.8 MB | 4.4 MB | 3.6 MB |
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
