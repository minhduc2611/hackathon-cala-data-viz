import { Chart, registerables } from "chart.js";
import { useEffect, useRef } from "react";
import type { ChartData } from "../../shared/types.ts";

Chart.register(...registerables);

export function ChartView({ chart, label }: { chart: ChartData; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const line = chart.kind === "line";
    const instance = new Chart(canvas.current!, {
      type: chart.kind,
      data: {
        labels: chart.labels,
        datasets: [{
          label: chart.y, data: chart.values, backgroundColor: "#1f4e79", borderColor: "#1f4e79",
          borderWidth: line ? 2 : 0, borderRadius: 4, maxBarThickness: 28, pointRadius: 4,
        }],
      },
      options: {
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
