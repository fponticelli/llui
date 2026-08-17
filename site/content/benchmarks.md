---
title: Benchmarks
description: js-framework-benchmark results — LLui vs Solid, Svelte, React, vanilla JS
---

Results from [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (krausest). All frameworks measured under identical conditions.

## Timings (ms)

<details>
<summary>Raw data</summary>

|   Operation |         LLui |    Solid |   Svelte |  vanilla |     React |      Elm |
| ----------: | -----------: | -------: | -------: | -------: | --------: | -------: |
|   Create 1k |  **80.7 ms** |  76.8 ms |  77.7 ms |  73.1 ms |   90.7 ms |  97.4 ms |
|  Replace 1k |  **89.8 ms** |  89.3 ms |  92.3 ms |  82.0 ms |  109.9 ms | 104.5 ms |
| Update 10th |  **48.4 ms** |  48.6 ms |  49.5 ms |  44.5 ms |   62.6 ms |  57.7 ms |
|      Select |  **10.3 ms** |  12.7 ms |  18.0 ms |  10.3 ms |   18.5 ms |  15.8 ms |
|        Swap |  **56.0 ms** |  55.5 ms |  57.1 ms |  49.6 ms |  344.6 ms |  58.7 ms |
|      Remove |  **42.9 ms** |  39.6 ms |  40.3 ms |  38.4 ms |   44.0 ms |  44.7 ms |
|  Create 10k | **918.1 ms** | 888.2 ms | 906.4 ms | 832.8 ms | 1223.8 ms | 983.6 ms |
|   Append 1k |  **97.9 ms** |  90.9 ms |  92.6 ms |  88.5 ms |  111.3 ms | 125.2 ms |
|       Clear |  **33.8 ms** |  38.0 ms |  32.7 ms |  27.3 ms |   58.0 ms |  36.4 ms |

### Relative to LLui

|   Operation | vs Solid | vs Svelte | vs vanilla |  vs React |   vs Elm |
| ----------: | -------: | --------: | ---------: | --------: | -------: |
|   Create 1k |      -5% |       -4% |        -9% |  **+12%** | **+21%** |
|  Replace 1k |        = |       +3% |        -9% |  **+22%** | **+16%** |
| Update 10th |        = |       +2% |        -8% |  **+29%** | **+19%** |
|      Select | **+23%** |  **+75%** |          = |  **+80%** | **+53%** |
|        Swap |        = |       +2% |       -11% | **+515%** |  **+5%** |
|      Remove |      -8% |       -6% |       -10% |       +3% |  **+4%** |
|  Create 10k |      -3% |       -1% |        -9% |  **+33%** |  **+7%** |
|   Append 1k |      -7% |       -5% |       -10% |  **+14%** | **+28%** |
|       Clear | **+12%** |       -3% |       -19% |  **+72%** |  **+8%** |

Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

<details>
<summary>Raw data</summary>

| Operation |       LLui |  Solid | Svelte | vanilla |  React |    Elm |
| --------: | ---------: | -----: | -----: | ------: | -----: | -----: |
|     Ready | **0.7 MB** | 0.6 MB | 0.7 MB |  0.6 MB | 1.2 MB | 0.7 MB |
|    Run 1k | **2.4 MB** | 2.7 MB | 2.9 MB |  1.9 MB | 4.4 MB | 3.6 MB |
|     Clear | **1.0 MB** | 0.8 MB | 1.0 MB |  0.7 MB | 2.0 MB | 1.1 MB |

</details>

## Bundle Size (KB)

<details>
<summary>Raw data</summary>

|    Operation |        LLui |   Solid |  Svelte | vanilla |    React |     Elm |
| -----------: | ----------: | ------: | ------: | ------: | -------: | ------: |
| Uncompressed | **23.3 KB** | 11.5 KB | 26.6 KB | 11.3 KB | 190.3 KB | 31.7 KB |
|      Gzipped |  **8.2 KB** |  4.5 KB |  9.7 KB |  2.5 KB |  51.4 KB | 10.4 KB |

</details>

## Methodology

- **Tool:** [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) by Stefan Krause
- **Browser:** Google Chrome for Testing 150.0.7871.46 (headless), CPU throttling 4×
- **Sampling:** 5 passes; CPU 15, memory 1, size 1 iterations per pass; median-of-medians reported
- **Machine:** ci-runner-01 — 8 vCPU on Xeon Gold 6226R, 32 GiB RAM; all Actions runners quiesced
- **LLui commit:** `756a0cac8c59`
- **JFB commit:** `afe7c118dd21`
- **Captured:** 2026-08-17T03:10:44.549Z
- **Data source:** [`benchmarks/baseline.json`](/benchmark-data.json) — standard-suite measurements from the canonical capture

Numbers fluctuate ±5% between runs. Differences <5% should be considered noise.
