---
title: Benchmarks
description: js-framework-benchmark results — LLui vs Solid, Svelte, React, vanilla JS
---

Results from [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (krausest). All frameworks measured under identical conditions.

## Timings (ms)

<details>
<summary>Raw data</summary>

|   Operation |         LLui |    Solid |   Svelte |  vanilla |      Elm |
| ----------: | -----------: | -------: | -------: | -------: | -------: |
|   Create 1k |  **21.3 ms** |  21.2 ms |  21.4 ms |  20.6 ms |  29.6 ms |
|  Replace 1k |  **24.7 ms** |  23.7 ms |  24.4 ms |  22.1 ms |  30.0 ms |
| Update 10th |  **14.6 ms** |  14.2 ms |  14.3 ms |  12.6 ms |  17.5 ms |
|      Select |   **3.2 ms** |   4.0 ms |   6.1 ms |   3.1 ms |   5.9 ms |
|        Swap |  **16.8 ms** |  16.3 ms |  16.3 ms |  14.2 ms |  18.4 ms |
|      Remove |  **11.9 ms** |  11.1 ms |  11.4 ms |  10.7 ms |  13.5 ms |
|  Create 10k | **229.2 ms** | 220.4 ms | 223.6 ms | 206.7 ms | 259.8 ms |
|   Append 1k |  **26.4 ms** |  24.7 ms |  24.7 ms |  24.1 ms |  30.9 ms |
|       Clear |  **11.5 ms** |  11.8 ms |  11.5 ms |   9.1 ms |  13.2 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |   vs Elm |
| ----------: | -------: | --------: | ---------: | -------: |
|   Create 1k |        = |         = |        -3% | **+39%** |
|  Replace 1k |      -4% |       -1% |       -11% | **+21%** |
| Update 10th |      -3% |       -2% |       -14% | **+20%** |
|      Select | **+25%** |  **+91%** |        -3% | **+84%** |
|        Swap |      -3% |       -3% |       -15% | **+10%** |
|      Remove |      -7% |       -4% |       -10% | **+13%** |
|  Create 10k |      -4% |       -2% |       -10% | **+13%** |
|   Append 1k |      -6% |       -6% |        -9% | **+17%** |
|       Clear |      +3% |         = |       -21% | **+15%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: |
|     Ready | **0.7 MB** | 0.6 MB | 0.7 MB |  0.6 MB | 0.7 MB |
|    Run 1k | **2.4 MB** | 2.7 MB | 2.9 MB |  1.9 MB | 3.7 MB |
|     Clear | **0.9 MB** | 0.8 MB | 1.0 MB |  0.7 MB | 1.0 MB |

</details>

## Bundle Size (KB)

<details>
<summary>Raw data</summary>

|    Operation |        LLui |   Solid |  Svelte | vanilla |     Elm |
| -----------: | ----------: | ------: | ------: | ------: | ------: |
| Uncompressed | **24.9 KB** | 11.5 KB | 34.3 KB | 11.3 KB | 31.7 KB |
|      Gzipped |  **8.2 KB** |  4.5 KB | 12.2 KB |  2.5 KB | 10.4 KB |

</details>

## Methodology

- **Tool:** [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) by Stefan Krause
- **Browser:** Chrome (headful), CPU throttling 4x
- **Iterations:** 15 per benchmark, median reported
- **Machine:** MacBook Pro M5 Max, 128 GB RAM
- **LLui version:** Latest from `opt` branch with all compiler optimizations enabled
- **Data source:** [`benchmarks/jfb-baseline.json`](/benchmark-data.json) — raw JSON

Numbers fluctuate ±5% between runs. Differences <5% should be considered noise.
