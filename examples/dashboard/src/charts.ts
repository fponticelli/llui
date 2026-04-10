import { svg, g, rect, line, path, circle, svgText } from '@llui/dom'

interface BarDatum {
  label: string
  value: number
}

/**
 * Horizontal bar chart — pure SVG, animated via CSS classes.
 */
export function barChart(
  data: BarDatum[],
  opts: { width?: number; barHeight?: number; color?: string } = {},
): SVGElement {
  const w = opts.width ?? 500
  const barH = opts.barHeight ?? 24
  const gap = 8
  const labelW = 40
  const valueW = 70
  const barAreaW = w - labelW - valueW
  const max = Math.max(...data.map((d) => d.value))
  const h = data.length * (barH + gap) + gap
  const color = opts.color ?? '#6366f1'

  return svg({ viewBox: `0 0 ${w} ${h}`, width: '100%', class: 'chart bar-chart' }, [
    ...data.flatMap((d, i) => {
      const y = gap + i * (barH + gap)
      const barW = Math.max(2, Math.round((d.value / max) * barAreaW))
      return [
        svgText(
          {
            x: String(labelW - 6),
            y: String(y + barH / 2 + 4),
            'text-anchor': 'end',
            class: 'chart-label',
          },
          [d.label],
        ),
        rect({
          x: String(labelW),
          y: String(y),
          width: String(barW),
          height: String(barH),
          rx: '4',
          fill: color,
          class: 'chart-bar',
          style: `animation-delay:${(i * 0.05).toFixed(2)}s`,
        }),
        svgText(
          { x: String(labelW + barW + 8), y: String(y + barH / 2 + 4), class: 'chart-value' },
          [`$${(d.value / 1000).toFixed(1)}k`],
        ),
      ]
    }),
  ])
}

/**
 * Line chart — SVG polyline with dots.
 */
export function lineChart(
  data: number[],
  opts: { width?: number; height?: number; color?: string } = {},
): SVGElement {
  const w = opts.width ?? 500
  const h = opts.height ?? 200
  const color = opts.color ?? '#22c55e'
  const padX = 10
  const padY = 20
  const plotW = w - padX * 2
  const plotH = h - padY * 2
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1

  const points = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * plotW
    const y = padY + plotH - ((v - min) / range) * plotH
    return { x, y, v }
  })

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ')

  // Gradient fill area
  const areaD = `${pathD} L${points[points.length - 1].x.toFixed(1)},${h - padY} L${padX},${h - padY} Z`

  return svg({ viewBox: `0 0 ${w} ${h}`, width: '100%', class: 'chart line-chart' }, [
    // Grid lines
    ...Array.from({ length: 5 }, (_, i) => {
      const y = padY + (i / 4) * plotH
      return line({
        x1: String(padX),
        y1: String(y),
        x2: String(w - padX),
        y2: String(y),
        stroke: '#334155',
        'stroke-width': '1',
      })
    }),
    // Area fill
    path({
      d: areaD,
      fill: color,
      opacity: '0.1',
      class: 'chart-area',
    }),
    // Line
    path({
      d: pathD,
      fill: 'none',
      stroke: color,
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      class: 'chart-line',
    }),
    // Dots at start and end
    circle({
      cx: String(points[0].x),
      cy: String(points[0].y),
      r: '4',
      fill: color,
    }),
    circle({
      cx: String(points[points.length - 1].x),
      cy: String(points[points.length - 1].y),
      r: '4',
      fill: color,
    }),
    // Labels
    svgText({ x: String(padX), y: String(h - 4), class: 'chart-label' }, ['Day 1']),
    svgText({ x: String(w - padX), y: String(h - 4), 'text-anchor': 'end', class: 'chart-label' }, [
      `Day ${data.length}`,
    ]),
  ])
}
