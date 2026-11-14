import { Chart, registerables } from "chart.js";
import { useEffect, useRef } from "react";
import type { ChartData } from "../../shared/types.ts";

Chart.register(...registerables);

interface Props {
  chart: ChartData;
  label: string;
  onPick?: (label: string, add: boolean) => void; // add = Shift or Cmd/Ctrl held: toggle within the selection
}

export function ChartView({ chart, label, onPick }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  useEffect(() => {
    const line = chart.kind === "line";
    // With a selection, the picked bar keeps the full colour and the others fade.
    const selected = new Set(chart.selected ?? []);
    const color = selected.size ? chart.labels.map((l) => (selected.has(l) ? "#1f4e79" : "#bccbd9")) : "#1f4e79";
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
        // Click a bar to select it; Shift- or Cmd/Ctrl-click adds or removes bars.
        onClick: (event, elements) => {
          const hit = elements[0];
          const native = event.native as MouseEvent | null;
          const add = Boolean(native && (native.shiftKey || native.metaKey || native.ctrlKey));
          if (hit && pick.current) pick.current(chart.labels[hit.index], add);
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
