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
|   Create 1k |  **23.9 ms** |  23.8 ms |  24.0 ms |  22.9 ms |  26.7 ms |  37.3 ms |
|  Replace 1k |  **25.9 ms** |  26.1 ms |  26.5 ms |  23.9 ms |  32.2 ms |  33.7 ms |
| Update 10th |  **14.6 ms** |  14.8 ms |  15.5 ms |  13.5 ms |  16.7 ms |  27.7 ms |
|      Select |   **3.2 ms** |   4.2 ms |   5.7 ms |   4.5 ms |   5.6 ms |  21.9 ms |
|        Swap |  **11.4 ms** |  17.4 ms |  17.3 ms |  15.0 ms | 106.5 ms |  27.7 ms |
|      Remove |  **11.5 ms** |  12.0 ms |  12.8 ms |  11.4 ms |  14.5 ms |  29.8 ms |
|  Create 10k | **235.8 ms** | 235.8 ms | 237.5 ms | 220.3 ms | 420.4 ms | 606.2 ms |
|   Append 1k |  **28.3 ms** |  27.3 ms |  27.5 ms |  26.7 ms |  31.4 ms |  38.2 ms |
|       Clear |  **12.3 ms** |  12.5 ms |  12.0 ms |   9.7 ms |  19.1 ms |  22.7 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |  vs React |    vs Elm |
| ----------: | -------: | --------: | ---------: | --------: | --------: |
|   Create 1k |        = |         = |        -4% |  **+12%** |  **+56%** |
|  Replace 1k |        = |       +2% |        -8% |  **+24%** |  **+30%** |
| Update 10th |      +1% |   **+6%** |        -8% |  **+14%** |  **+90%** |
|      Select | **+31%** |  **+78%** |   **+41%** |  **+75%** | **+584%** |
|        Swap | **+53%** |  **+52%** |   **+32%** | **+834%** | **+143%** |
|      Remove |  **+4%** |  **+11%** |          = |  **+26%** | **+159%** |
|  Create 10k |        = |         = |        -7% |  **+78%** | **+157%** |
|   Append 1k |      -4% |       -3% |        -6% |  **+11%** |  **+35%** |
|       Clear |      +2% |       -2% |       -21% |  **+55%** |  **+85%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |  React |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: | -----: |
|     Ready | **0.6 MB** | 0.6 MB | 0.7 MB |  0.6 MB | 1.2 MB | 0.7 MB |
|    Run 1k | **3.2 MB** | 2.6 MB | 2.9 MB |  1.8 MB | 4.4 MB | 3.6 MB |
|     Clear | **1.0 MB** | 0.7 MB | 1.0 MB |  0.6 MB | 2.0 MB | 1.0 MB |

</details>

## Bundle Size (KB)

<details>
<summary>Raw data</summary>

|    Operation |        LLui |   Solid |  Svelte | vanilla |    React |     Elm |
| -----------: | ----------: | ------: | ------: | ------: | -------: | ------: |
| Uncompressed | **26.8 KB** | 11.5 KB | 34.3 KB | 11.3 KB | 190.3 KB | 31.7 KB |
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
