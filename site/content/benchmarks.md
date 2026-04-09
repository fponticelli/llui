---
title: Benchmarks
description: js-framework-benchmark results — LLui vs Solid, Svelte, React, vanilla JS
---

<style>
@keyframes bar-grow {
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}
.bench-chart { max-width: 640px; margin: 0.5rem 0 1.5rem; overflow: visible; }
.bench-bar { transform-origin: left center; animation: bar-grow 0.6s cubic-bezier(0.22, 1, 0.36, 1) both; }
.bench-label { font: 13px/1 system-ui, sans-serif; fill: var(--fg, #24292f); }
.bench-value { font: 12px/1 system-ui, sans-serif; fill: var(--fg-muted, #656d76); }
.bench-llui { font-weight: 600; }
</style>

Results from [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) (krausest). All frameworks measured under identical conditions.

## Timings (ms)

**Create 1k**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="282" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:282px;animation-delay:0.00s" opacity="1"/>
  <text x="360" y="25" class="bench-value bench-llui">23.5 ms</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="282" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:282px;animation-delay:0.08s" opacity="0.75"/>
  <text x="360" y="59" class="bench-value">23.5 ms</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="281" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:281px;animation-delay:0.16s" opacity="0.75"/>
  <text x="359" y="93" class="bench-value">23.4 ms</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="271" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:271px;animation-delay:0.24s" opacity="0.75"/>
  <text x="349" y="127" class="bench-value">22.6 ms</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="320" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:320px;animation-delay:0.32s" opacity="0.75"/>
  <text x="398" y="161" class="bench-value">26.7 ms</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="450" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:450px;animation-delay:0.40s" opacity="0.75"/>
  <text x="528" y="195" class="bench-value">37.5 ms</text>
</svg>

**Replace 1k**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="354" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:354px;animation-delay:0.00s" opacity="1"/>
  <text x="432" y="25" class="bench-value bench-llui">25.3 ms</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="358" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:358px;animation-delay:0.08s" opacity="0.75"/>
  <text x="436" y="59" class="bench-value">25.6 ms</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="363" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:363px;animation-delay:0.16s" opacity="0.75"/>
  <text x="441" y="93" class="bench-value">26.0 ms</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="327" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:327px;animation-delay:0.24s" opacity="0.75"/>
  <text x="405" y="127" class="bench-value">23.4 ms</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="450" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:450px;animation-delay:0.32s" opacity="0.75"/>
  <text x="528" y="161" class="bench-value">32.2 ms</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="440" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:440px;animation-delay:0.40s" opacity="0.75"/>
  <text x="518" y="195" class="bench-value">31.5 ms</text>
</svg>

**Update 10th**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="242" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:242px;animation-delay:0.00s" opacity="1"/>
  <text x="320" y="25" class="bench-value bench-llui">14.8 ms</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="241" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:241px;animation-delay:0.08s" opacity="0.75"/>
  <text x="319" y="59" class="bench-value">14.7 ms</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="247" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:247px;animation-delay:0.16s" opacity="0.75"/>
  <text x="325" y="93" class="bench-value">15.1 ms</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="219" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:219px;animation-delay:0.24s" opacity="0.75"/>
  <text x="297" y="127" class="bench-value">13.4 ms</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="273" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:273px;animation-delay:0.32s" opacity="0.75"/>
  <text x="351" y="161" class="bench-value">16.7 ms</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="450" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:450px;animation-delay:0.40s" opacity="0.75"/>
  <text x="528" y="195" class="bench-value">27.5 ms</text>
</svg>

**Select**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="66" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:66px;animation-delay:0.00s" opacity="1"/>
  <text x="144" y="25" class="bench-value bench-llui">3.3 ms</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="88" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:88px;animation-delay:0.08s" opacity="0.75"/>
  <text x="166" y="59" class="bench-value">4.4 ms</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="123" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:123px;animation-delay:0.16s" opacity="0.75"/>
  <text x="201" y="93" class="bench-value">6.1 ms</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="98" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:98px;animation-delay:0.24s" opacity="0.75"/>
  <text x="176" y="127" class="bench-value">4.9 ms</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="113" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:113px;animation-delay:0.32s" opacity="0.75"/>
  <text x="191" y="161" class="bench-value">5.6 ms</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="450" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:450px;animation-delay:0.40s" opacity="0.75"/>
  <text x="528" y="195" class="bench-value">22.4 ms</text>
</svg>

**Swap**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="48" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:48px;animation-delay:0.00s" opacity="1"/>
  <text x="126" y="25" class="bench-value bench-llui">11.3 ms</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="73" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:73px;animation-delay:0.08s" opacity="0.75"/>
  <text x="151" y="59" class="bench-value">17.2 ms</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="73" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:73px;animation-delay:0.16s" opacity="0.75"/>
  <text x="151" y="93" class="bench-value">17.3 ms</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="64" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:64px;animation-delay:0.24s" opacity="0.75"/>
  <text x="142" y="127" class="bench-value">15.1 ms</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="450" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:450px;animation-delay:0.32s" opacity="0.75"/>
  <text x="528" y="161" class="bench-value">106.5 ms</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="117" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:117px;animation-delay:0.40s" opacity="0.75"/>
  <text x="195" y="195" class="bench-value">27.6 ms</text>
</svg>

**Remove**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="180" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:180px;animation-delay:0.00s" opacity="1"/>
  <text x="258" y="25" class="bench-value bench-llui">11.6 ms</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="185" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:185px;animation-delay:0.08s" opacity="0.75"/>
  <text x="263" y="59" class="bench-value">11.9 ms</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="192" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:192px;animation-delay:0.16s" opacity="0.75"/>
  <text x="270" y="93" class="bench-value">12.4 ms</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="175" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:175px;animation-delay:0.24s" opacity="0.75"/>
  <text x="253" y="127" class="bench-value">11.3 ms</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="225" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:225px;animation-delay:0.32s" opacity="0.75"/>
  <text x="303" y="161" class="bench-value">14.5 ms</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="450" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:450px;animation-delay:0.40s" opacity="0.75"/>
  <text x="528" y="195" class="bench-value">29.0 ms</text>
</svg>

**Create 10k**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="174" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:174px;animation-delay:0.00s" opacity="1"/>
  <text x="252" y="25" class="bench-value bench-llui">235.3 ms</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="174" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:174px;animation-delay:0.08s" opacity="0.75"/>
  <text x="252" y="59" class="bench-value">235.1 ms</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="175" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:175px;animation-delay:0.16s" opacity="0.75"/>
  <text x="253" y="93" class="bench-value">237.3 ms</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="162" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:162px;animation-delay:0.24s" opacity="0.75"/>
  <text x="240" y="127" class="bench-value">219.7 ms</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="311" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:311px;animation-delay:0.32s" opacity="0.75"/>
  <text x="389" y="161" class="bench-value">420.4 ms</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="450" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:450px;animation-delay:0.40s" opacity="0.75"/>
  <text x="528" y="195" class="bench-value">608.6 ms</text>
</svg>

**Append 1k**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="325" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:325px;animation-delay:0.00s" opacity="1"/>
  <text x="403" y="25" class="bench-value bench-llui">27.9 ms</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="315" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:315px;animation-delay:0.08s" opacity="0.75"/>
  <text x="393" y="59" class="bench-value">27.0 ms</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="317" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:317px;animation-delay:0.16s" opacity="0.75"/>
  <text x="395" y="93" class="bench-value">27.2 ms</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="305" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:305px;animation-delay:0.24s" opacity="0.75"/>
  <text x="383" y="127" class="bench-value">26.2 ms</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="366" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:366px;animation-delay:0.32s" opacity="0.75"/>
  <text x="444" y="161" class="bench-value">31.4 ms</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="450" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:450px;animation-delay:0.40s" opacity="0.75"/>
  <text x="528" y="195" class="bench-value">38.6 ms</text>
</svg>

**Clear**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="246" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:246px;animation-delay:0.00s" opacity="1"/>
  <text x="324" y="25" class="bench-value bench-llui">12.5 ms</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="242" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:242px;animation-delay:0.08s" opacity="0.75"/>
  <text x="320" y="59" class="bench-value">12.3 ms</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="234" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:234px;animation-delay:0.16s" opacity="0.75"/>
  <text x="312" y="93" class="bench-value">11.9 ms</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="191" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:191px;animation-delay:0.24s" opacity="0.75"/>
  <text x="269" y="127" class="bench-value">9.7 ms</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="375" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:375px;animation-delay:0.32s" opacity="0.75"/>
  <text x="453" y="161" class="bench-value">19.1 ms</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="450" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:450px;animation-delay:0.40s" opacity="0.75"/>
  <text x="528" y="195" class="bench-value">22.9 ms</text>
</svg>



<details>
<summary>Raw data</summary>

| Operation | LLui | Solid | Svelte | vanilla | React | Elm |
|---:|---:|---:|---:|---:|---:|---:|
| Create 1k | **23.5 ms** | 23.5 ms | 23.4 ms | 22.6 ms | 26.7 ms | 37.5 ms |
| Replace 1k | **25.3 ms** | 25.6 ms | 26.0 ms | 23.4 ms | 32.2 ms | 31.5 ms |
| Update 10th | **14.8 ms** | 14.7 ms | 15.1 ms | 13.4 ms | 16.7 ms | 27.5 ms |
| Select | **3.3 ms** | 4.4 ms | 6.1 ms | 4.9 ms | 5.6 ms | 22.4 ms |
| Swap | **11.3 ms** | 17.2 ms | 17.3 ms | 15.1 ms | 106.5 ms | 27.6 ms |
| Remove | **11.6 ms** | 11.9 ms | 12.4 ms | 11.3 ms | 14.5 ms | 29.0 ms |
| Create 10k | **235.3 ms** | 235.1 ms | 237.3 ms | 219.7 ms | 420.4 ms | 608.6 ms |
| Append 1k | **27.9 ms** | 27.0 ms | 27.2 ms | 26.2 ms | 31.4 ms | 38.6 ms |
| Clear | **12.5 ms** | 12.3 ms | 11.9 ms | 9.7 ms | 19.1 ms | 22.9 ms |


### Relative to LLui

| Operation | vs Solid | vs Svelte | vs vanilla | vs React | vs Elm |
|---:|---:|---:|---:|---:|---:|
| Create 1k | = | = | -4% | **+14%** | **+60%** |
| Replace 1k | +1% | +3% | -8% | **+27%** | **+25%** |
| Update 10th | = | +2% | -9% | **+13%** | **+86%** |
| Select | **+33%** | **+85%** | **+48%** | **+70%** | **+579%** |
| Swap | **+52%** | **+53%** | **+34%** | **+842%** | **+144%** |
| Remove | +3% | **+7%** | -3% | **+25%** | **+150%** |
| Create 10k | = | = | -7% | **+79%** | **+159%** |
| Append 1k | -3% | -3% | -6% | **+13%** | **+38%** |
| Clear | -2% | -5% | -22% | **+53%** | **+83%** |


Positive = peer is slower than LLui. **Bold** = LLui wins by >3%.

</details>

## Memory (MB)

**Ready**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="222" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:222px;animation-delay:0.00s" opacity="1"/>
  <text x="300" y="25" class="bench-value bench-llui">0.6 MB</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="188" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:188px;animation-delay:0.08s" opacity="0.75"/>
  <text x="266" y="59" class="bench-value">0.5 MB</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="253" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:253px;animation-delay:0.16s" opacity="0.75"/>
  <text x="331" y="93" class="bench-value">0.7 MB</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="210" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:210px;animation-delay:0.24s" opacity="0.75"/>
  <text x="288" y="127" class="bench-value">0.6 MB</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="450" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:450px;animation-delay:0.32s" opacity="0.75"/>
  <text x="528" y="161" class="bench-value">1.2 MB</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="253" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:253px;animation-delay:0.40s" opacity="0.75"/>
  <text x="331" y="195" class="bench-value">0.7 MB</text>
</svg>

**Run 1k**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="325" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:325px;animation-delay:0.00s" opacity="1"/>
  <text x="403" y="25" class="bench-value bench-llui">3.2 MB</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="270" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:270px;animation-delay:0.08s" opacity="0.75"/>
  <text x="348" y="59" class="bench-value">2.6 MB</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="295" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:295px;animation-delay:0.16s" opacity="0.75"/>
  <text x="373" y="93" class="bench-value">2.9 MB</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="187" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:187px;animation-delay:0.24s" opacity="0.75"/>
  <text x="265" y="127" class="bench-value">1.8 MB</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="450" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:450px;animation-delay:0.32s" opacity="0.75"/>
  <text x="528" y="161" class="bench-value">4.4 MB</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="372" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:372px;animation-delay:0.40s" opacity="0.75"/>
  <text x="450" y="195" class="bench-value">3.6 MB</text>
</svg>

**Clear**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="230" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:230px;animation-delay:0.00s" opacity="1"/>
  <text x="308" y="25" class="bench-value bench-llui">1.0 MB</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="167" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:167px;animation-delay:0.08s" opacity="0.75"/>
  <text x="245" y="59" class="bench-value">0.7 MB</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="228" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:228px;animation-delay:0.16s" opacity="0.75"/>
  <text x="306" y="93" class="bench-value">1.0 MB</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="141" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:141px;animation-delay:0.24s" opacity="0.75"/>
  <text x="219" y="127" class="bench-value">0.6 MB</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="450" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:450px;animation-delay:0.32s" opacity="0.75"/>
  <text x="528" y="161" class="bench-value">2.0 MB</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="235" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:235px;animation-delay:0.40s" opacity="0.75"/>
  <text x="313" y="195" class="bench-value">1.0 MB</text>
</svg>



<details>
<summary>Raw data</summary>

| Operation | LLui | Solid | Svelte | vanilla | React | Elm |
|---:|---:|---:|---:|---:|---:|---:|
| Ready | **0.6 MB** | 0.5 MB | 0.7 MB | 0.6 MB | 1.2 MB | 0.7 MB |
| Run 1k | **3.2 MB** | 2.6 MB | 2.9 MB | 1.8 MB | 4.4 MB | 3.6 MB |
| Clear | **1.0 MB** | 0.7 MB | 1.0 MB | 0.6 MB | 2.0 MB | 1.0 MB |


</details>

## Bundle Size (KB)

**Uncompressed**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="63" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:63px;animation-delay:0.00s" opacity="1"/>
  <text x="141" y="25" class="bench-value bench-llui">26.7 KB</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="27" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:27px;animation-delay:0.08s" opacity="0.75"/>
  <text x="105" y="59" class="bench-value">11.5 KB</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="81" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:81px;animation-delay:0.16s" opacity="0.75"/>
  <text x="159" y="93" class="bench-value">34.3 KB</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="27" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:27px;animation-delay:0.24s" opacity="0.75"/>
  <text x="105" y="127" class="bench-value">11.3 KB</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="450" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:450px;animation-delay:0.32s" opacity="0.75"/>
  <text x="528" y="161" class="bench-value">190.3 KB</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="75" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:75px;animation-delay:0.40s" opacity="0.75"/>
  <text x="153" y="195" class="bench-value">31.7 KB</text>
</svg>

**Gzipped**

<svg class="bench-chart" viewBox="0 0 600 210" width="100%" preserveAspectRatio="xMinYMid meet">
  <text x="62" y="25" text-anchor="end" class="bench-label bench-llui">LLui</text>
  <rect x="70" y="6" width="66" height="28" rx="4" fill="#6366f1" class="bench-bar" style="--bar-w:66px;animation-delay:0.00s" opacity="1"/>
  <text x="144" y="25" class="bench-value bench-llui">7.5 KB</text>
  <text x="62" y="59" text-anchor="end" class="bench-label">Solid</text>
  <rect x="70" y="40" width="39" height="28" rx="4" fill="#2563eb" class="bench-bar" style="--bar-w:39px;animation-delay:0.08s" opacity="0.75"/>
  <text x="117" y="59" class="bench-value">4.5 KB</text>
  <text x="62" y="93" text-anchor="end" class="bench-label">Svelte</text>
  <rect x="70" y="74" width="107" height="28" rx="4" fill="#f97316" class="bench-bar" style="--bar-w:107px;animation-delay:0.16s" opacity="0.75"/>
  <text x="185" y="93" class="bench-value">12.2 KB</text>
  <text x="62" y="127" text-anchor="end" class="bench-label">vanilla</text>
  <rect x="70" y="108" width="22" height="28" rx="4" fill="#737373" class="bench-bar" style="--bar-w:22px;animation-delay:0.24s" opacity="0.75"/>
  <text x="100" y="127" class="bench-value">2.5 KB</text>
  <text x="62" y="161" text-anchor="end" class="bench-label">React</text>
  <rect x="70" y="142" width="450" height="28" rx="4" fill="#06b6d4" class="bench-bar" style="--bar-w:450px;animation-delay:0.32s" opacity="0.75"/>
  <text x="528" y="161" class="bench-value">51.4 KB</text>
  <text x="62" y="195" text-anchor="end" class="bench-label">Elm</text>
  <rect x="70" y="176" width="91" height="28" rx="4" fill="#60a5fa" class="bench-bar" style="--bar-w:91px;animation-delay:0.40s" opacity="0.75"/>
  <text x="169" y="195" class="bench-value">10.4 KB</text>
</svg>



<details>
<summary>Raw data</summary>

| Operation | LLui | Solid | Svelte | vanilla | React | Elm |
|---:|---:|---:|---:|---:|---:|---:|
| Uncompressed | **26.7 KB** | 11.5 KB | 34.3 KB | 11.3 KB | 190.3 KB | 31.7 KB |
| Gzipped | **7.5 KB** | 4.5 KB | 12.2 KB | 2.5 KB | 51.4 KB | 10.4 KB |


</details>

## Methodology

- **Tool:** [js-framework-benchmark](https://github.com/krausest/js-framework-benchmark) by Stefan Krause
- **Browser:** Chrome (headful), CPU throttling 4x
- **Iterations:** 15 per benchmark, median reported
- **Machine:** MacBook Pro M5 Max, 128 GB RAM
- **LLui version:** Latest from `opt` branch with all compiler optimizations enabled
- **Data source:** [`benchmarks/jfb-baseline.json`](/benchmark-data.json) — raw JSON

Numbers fluctuate ±5% between runs. Differences <5% should be considered noise.
