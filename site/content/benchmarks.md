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
|   Create 1k |  **21.6 ms** |  21.5 ms |  21.7 ms |  20.9 ms |  26.7 ms |  36.8 ms |
|  Replace 1k |  **22.9 ms** |  23.2 ms |  23.5 ms |  21.7 ms |  32.2 ms |  36.0 ms |
| Update 10th |  **10.8 ms** |  10.7 ms |  11.3 ms |  18.9 ms |  16.7 ms |  22.9 ms |
|      Select |   **3.0 ms** |   3.6 ms |   4.7 ms |   9.0 ms |   5.6 ms |  16.3 ms |
|        Swap |   **8.1 ms** |  13.2 ms |  13.2 ms |  13.7 ms | 106.5 ms |  24.2 ms |
|      Remove |  **10.3 ms** |  12.2 ms |  13.8 ms |   9.6 ms |  14.5 ms |  29.5 ms |
|  Create 10k | **218.9 ms** | 216.7 ms | 216.8 ms | 202.8 ms | 420.4 ms | 587.6 ms |
|   Append 1k |  **24.2 ms** |  23.9 ms |  24.0 ms |  23.5 ms |  31.4 ms |  32.8 ms |
|       Clear |  **10.4 ms** |  11.4 ms |  10.4 ms |   8.9 ms |  19.1 ms |  16.4 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |   vs React |    vs Elm |
| ----------: | -------: | --------: | ---------: | ---------: | --------: |
|   Create 1k |        = |         = |        -3% |   **+23%** |  **+70%** |
|  Replace 1k |      +1% |       +3% |        -5% |   **+41%** |  **+57%** |
| Update 10th |      -1% |   **+4%** |   **+74%** |   **+54%** | **+111%** |
|      Select | **+18%** |  **+54%** |  **+195%** |   **+84%** | **+434%** |
|        Swap | **+62%** |  **+62%** |   **+68%** | **+1207%** | **+197%** |
|      Remove | **+18%** |  **+34%** |        -7% |   **+41%** | **+186%** |
|  Create 10k |        = |         = |        -7% |   **+92%** | **+168%** |
|   Append 1k |      -1% |         = |        -3% |   **+30%** |  **+36%** |
|       Clear |  **+9%** |         = |       -15% |   **+83%** |  **+57%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |  React |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: | -----: |
|     Ready | **0.6 MB** | 0.5 MB | 0.7 MB |  0.5 MB | 1.2 MB | 0.7 MB |
|    Run 1k | **3.2 MB** | 2.6 MB | 2.9 MB |  1.8 MB | 4.4 MB | 3.6 MB |
|     Clear | **1.0 MB** | 0.7 MB | 1.0 MB |  0.6 MB | 2.0 MB | 1.0 MB |

</details>

## Bundle Size (KB)

<details>
<summary>Raw data</summary>

|    Operation |        LLui |   Solid |  Svelte | vanilla |    React |     Elm |
| -----------: | ----------: | ------: | ------: | ------: | -------: | ------: |
| Uncompressed | **24.5 KB** | 11.5 KB | 34.3 KB | 11.3 KB | 190.3 KB | 31.7 KB |
|      Gzipped |  **8.1 KB** |  4.5 KB | 12.2 KB |  2.5 KB |  51.4 KB | 10.4 KB |

</details>

## Methodology

- **Tool:** [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) by Stefan Krause
- **Browser:** Chrome (headful), CPU throttling 4x
- **Iterations:** 15 per benchmark, median reported
- **Machine:** MacBook Pro M5 Max, 128 GB RAM
- **LLui version:** Latest from `opt` branch with all compiler optimizations enabled
- **Data source:** [`benchmarks/jfb-baseline.json`](/benchmark-data.json) — raw JSON

Numbers fluctuate ±5% between runs. Differences <5% should be considered noise.
