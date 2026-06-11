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
|   Create 1k |  **21.0 ms** |  20.4 ms |  20.5 ms |  20.0 ms |  29.5 ms |
|  Replace 1k |  **23.9 ms** |  22.5 ms |  23.2 ms |  21.3 ms |  30.0 ms |
| Update 10th |  **12.7 ms** |  10.8 ms |  11.1 ms |  11.4 ms |  20.7 ms |
|      Select |   **3.3 ms** |   3.1 ms |   4.7 ms |   3.3 ms |   5.7 ms |
|        Swap |  **16.0 ms** |  12.9 ms |  13.2 ms |  13.7 ms |  22.8 ms |
|      Remove |  **12.2 ms** |   9.7 ms |   9.8 ms |  10.5 ms |  12.7 ms |
|  Create 10k | **229.5 ms** | 209.6 ms | 211.4 ms | 203.8 ms | 568.1 ms |
|   Append 1k |  **26.1 ms** |  22.6 ms |  22.8 ms |  22.6 ms |  30.2 ms |
|       Clear |  **11.3 ms** |  10.9 ms |  10.0 ms |   8.8 ms |  21.8 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |    vs Elm |
| ----------: | -------: | --------: | ---------: | --------: |
|   Create 1k |      -3% |       -2% |        -5% |  **+40%** |
|  Replace 1k |      -6% |       -3% |       -11% |  **+26%** |
| Update 10th |     -15% |      -13% |       -10% |  **+63%** |
|      Select |      -6% |  **+42%** |          = |  **+73%** |
|        Swap |     -19% |      -18% |       -14% |  **+43%** |
|      Remove |     -20% |      -20% |       -14% |   **+4%** |
|  Create 10k |      -9% |       -8% |       -11% | **+148%** |
|   Append 1k |     -13% |      -13% |       -13% |  **+16%** |
|       Clear |      -4% |      -12% |       -22% |  **+93%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: |
|     Ready | **0.6 MB** | 0.6 MB | 0.7 MB |  0.6 MB | 0.7 MB |
|    Run 1k | **2.4 MB** | 2.6 MB | 2.9 MB |  1.9 MB | 3.6 MB |
|     Clear | **0.9 MB** | 0.7 MB | 1.0 MB |  0.6 MB | 1.0 MB |

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
