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
|   Create 1k |  **22.0 ms** |  21.9 ms |  22.1 ms |  21.2 ms |  26.7 ms |  37.1 ms |
|  Replace 1k |  **23.2 ms** |  23.5 ms |  24.2 ms |  22.1 ms |  32.2 ms |  36.8 ms |
| Update 10th |  **12.1 ms** |  11.8 ms |  12.0 ms |  11.8 ms |  16.7 ms |  23.8 ms |
|      Select |   **3.1 ms** |   3.6 ms |   4.8 ms |   8.5 ms |   5.6 ms |  15.2 ms |
|        Swap |   **8.6 ms** |  14.2 ms |  14.1 ms |  13.0 ms | 106.5 ms |  24.4 ms |
|      Remove |  **10.3 ms** |  11.8 ms |  13.6 ms |  10.1 ms |  14.5 ms |  30.1 ms |
|  Create 10k | **217.4 ms** | 214.7 ms | 216.2 ms | 201.6 ms | 420.4 ms | 583.0 ms |
|   Append 1k |  **24.7 ms** |  24.5 ms |  24.6 ms |  24.0 ms |  31.4 ms |  32.7 ms |
|       Clear |  **11.2 ms** |  11.8 ms |  11.0 ms |   8.9 ms |  19.1 ms |  15.1 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |   vs React |    vs Elm |
| ----------: | -------: | --------: | ---------: | ---------: | --------: |
|   Create 1k |        = |         = |        -4% |   **+21%** |  **+69%** |
|  Replace 1k |      +1% |   **+4%** |        -5% |   **+39%** |  **+59%** |
| Update 10th |      -2% |         = |        -2% |   **+38%** |  **+97%** |
|      Select | **+16%** |  **+55%** |  **+174%** |   **+81%** | **+390%** |
|        Swap | **+65%** |  **+64%** |   **+51%** | **+1138%** | **+184%** |
|      Remove | **+15%** |  **+32%** |        -2% |   **+41%** | **+192%** |
|  Create 10k |      -1% |         = |        -7% |   **+93%** | **+168%** |
|   Append 1k |        = |         = |        -3% |   **+27%** |  **+32%** |
|       Clear |  **+5%** |       -2% |       -21% |   **+71%** |  **+35%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |  React |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: | -----: |
|     Ready | **0.6 MB** | 0.6 MB | 0.7 MB |  0.6 MB | 1.2 MB | 0.7 MB |
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
