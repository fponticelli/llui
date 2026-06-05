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
|   Create 1k |  **21.6 ms** |  20.7 ms |  20.9 ms |  20.1 ms |  26.7 ms |  29.1 ms |
|  Replace 1k |  **23.8 ms** |  23.1 ms |  23.7 ms |  21.7 ms |  32.2 ms |  30.8 ms |
| Update 10th |  **11.6 ms** |  11.4 ms |  12.0 ms |  10.8 ms |  16.7 ms |  22.2 ms |
|      Select |   **2.7 ms** |   3.4 ms |   5.0 ms |   2.7 ms |   5.6 ms |   5.4 ms |
|        Swap |  **14.4 ms** |  14.0 ms |  14.0 ms |  12.4 ms | 106.5 ms |  23.9 ms |
|      Remove |  **10.8 ms** |  10.2 ms |  10.3 ms |   9.7 ms |  14.5 ms |  13.7 ms |
|  Create 10k | **227.9 ms** | 216.8 ms | 218.6 ms | 200.0 ms | 420.4 ms | 574.1 ms |
|   Append 1k |  **26.1 ms** |  23.5 ms |  23.5 ms |  23.1 ms |  31.4 ms |  30.1 ms |
|       Clear |  **10.3 ms** |  11.0 ms |  10.7 ms |   8.9 ms |  19.1 ms |  22.2 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |  vs React |    vs Elm |
| ----------: | -------: | --------: | ---------: | --------: | --------: |
|   Create 1k |      -4% |       -3% |        -7% |  **+24%** |  **+35%** |
|  Replace 1k |      -3% |         = |        -9% |  **+35%** |  **+29%** |
| Update 10th |      -2% |   **+3%** |        -7% |  **+44%** |  **+91%** |
|      Select | **+26%** |  **+85%** |          = | **+107%** | **+100%** |
|        Swap |      -3% |       -3% |       -14% | **+640%** |  **+66%** |
|      Remove |      -6% |       -5% |       -10% |  **+34%** |  **+27%** |
|  Create 10k |      -5% |       -4% |       -12% |  **+84%** | **+152%** |
|   Append 1k |     -10% |      -10% |       -11% |  **+20%** |  **+15%** |
|       Clear |  **+7%** |   **+4%** |       -14% |  **+85%** | **+116%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |  React |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: | -----: |
|     Ready | **0.6 MB** | 0.6 MB | 0.7 MB |  0.6 MB | 1.2 MB | 0.7 MB |
|    Run 1k | **2.9 MB** | 2.6 MB | 2.9 MB |  1.8 MB | 4.4 MB | 3.6 MB |
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
