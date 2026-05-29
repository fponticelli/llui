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
|   Create 1k |  **21.2 ms** |  21.1 ms |  21.4 ms |  20.4 ms |  26.7 ms |  35.8 ms |
|  Replace 1k |  **22.4 ms** |  22.6 ms |  22.9 ms |  21.4 ms |  32.2 ms |  37.1 ms |
| Update 10th |  **10.7 ms** |  10.4 ms |  11.3 ms |  10.0 ms |  16.7 ms |  22.8 ms |
|      Select |   **2.8 ms** |   4.3 ms |   4.7 ms |   7.8 ms |   5.6 ms |  17.7 ms |
|        Swap |   **7.8 ms** |  12.8 ms |  12.8 ms |  12.1 ms | 106.5 ms |  23.7 ms |
|      Remove |  **10.4 ms** |  12.7 ms |  13.8 ms |   9.3 ms |  14.5 ms |  30.0 ms |
|  Create 10k | **218.2 ms** | 213.9 ms | 216.2 ms | 201.6 ms | 420.4 ms | 583.8 ms |
|   Append 1k |  **23.8 ms** |  23.1 ms |  23.2 ms |  23.0 ms |  31.4 ms |  30.5 ms |
|       Clear |  **10.3 ms** |  10.4 ms |  10.0 ms |   8.3 ms |  19.1 ms |  17.9 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |   vs React |    vs Elm |
| ----------: | -------: | --------: | ---------: | ---------: | --------: |
|   Create 1k |        = |         = |        -4% |   **+26%** |  **+69%** |
|  Replace 1k |        = |       +2% |        -4% |   **+44%** |  **+66%** |
| Update 10th |      -3% |   **+6%** |        -7% |   **+56%** | **+113%** |
|      Select | **+54%** |  **+68%** |  **+179%** |  **+100%** | **+532%** |
|        Swap | **+65%** |  **+64%** |   **+55%** | **+1265%** | **+204%** |
|      Remove | **+22%** |  **+33%** |       -11% |   **+39%** | **+188%** |
|  Create 10k |      -2% |         = |        -8% |   **+93%** | **+168%** |
|   Append 1k |      -3% |       -3% |        -3% |   **+32%** |  **+28%** |
|       Clear |      +1% |       -3% |       -19% |   **+85%** |  **+74%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |  React |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: | -----: |
|     Ready | **0.6 MB** | 0.6 MB | 0.7 MB |  0.5 MB | 1.2 MB | 0.7 MB |
|    Run 1k | **3.2 MB** | 2.6 MB | 2.9 MB |  1.8 MB | 4.4 MB | 3.6 MB |
|     Clear | **1.1 MB** | 0.7 MB | 1.0 MB |  0.6 MB | 2.0 MB | 1.0 MB |

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
