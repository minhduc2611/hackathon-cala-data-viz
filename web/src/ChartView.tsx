import { Chart, registerables } from "chart.js";
import { useEffect, useRef } from "react";
import type { ChartData } from "../../shared/types.ts";

Chart.register(...registerables);

export function ChartView({ chart, label, onPick }: { chart: ChartData; label: string; onPick?: (label: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const line = chart.kind === "line";
    // With a selection, the picked bar keeps the full colour and the others fade.
    const color = chart.selected ? chart.labels.map((l) => (l === chart.selected ? "#1f4e79" : "#bccbd9")) : "#1f4e79";
    const instance = new Chart(canvas.current!, {
      type: chart.kind,
      data: {
        labels: chart.labels,
        datasets: [{
          label: chart.y, data: chart.values, backgroundColor: color, borderColor: line ? "#1f4e79" : color,
          pointBackgroundColor: color,
          borderWidth: line ? 2 : 0, borderRadius: 4, maxBarThickness: 28, pointRadius: 4,
        }],
      },
      options: {
        // Click a bar or point to drill into the rows behind it.
        onClick: (_event, elements) => {
          const hit = elements[0];
          if (hit && pick.current) pick.current(chart.labels[hit.index]);
        },
        onHover: (event, elements) => {
          const target = event.native?.target as HTMLElement | undefined;
          if (target) target.style.cursor = elements.length && pick.current ? "pointer" : "default";
        },
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: chart.y }, grid: { color: "#e4ddd2" } },
        },
      },
    });
    return () => instance.destroy();
  }, [chart]);
  return <canvas ref={canvas} height={120} role="img" aria-label={label} />;
}
