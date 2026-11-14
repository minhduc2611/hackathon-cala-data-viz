import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY,
  type Simulation, type SimulationLinkDatum, type SimulationNodeDatum,
} from "d3-force";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { GraphData } from "../../shared/types.ts";
import { Table } from "./Table.tsx";

type Node = GraphData["nodes"][number] & SimulationNodeDatum;
type Edge = GraphData["edges"][number];
type Link = SimulationLinkDatum<Node>;

const W = 900;
const H = 560;
const PAD = 34;
const COLOR = { source: "#5aa9ff", target: "#ffad5c" } as const;
const radius = (n: { degree: number }) => 5 + 3 * Math.sqrt(n.degree);
const columnsOf = (rows: Record<string, string>[]) => [...new Set(rows.flatMap((r) => Object.keys(r)))];

/** Curved edge from s to t: a quadratic bend, so overlapping straight lines separate. */
function curve(s: Node, t: Node): string {
  const x1 = s.x ?? 0, y1 = s.y ?? 0, x2 = t.x ?? 0, y2 = t.y ?? 0;
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const bend = 0.12;
  return `M${x1},${y1} Q${mx - (y2 - y1) * bend},${my + (x2 - x1) * bend} ${x2},${y2}`;
}

/**
 * Interactive network of a graph cell. The layout settles with a short animation (skipped under
 * prefers-reduced-motion). Drag nodes, drag the background to pan, zoom with the buttons or a pinch.
 * Click a node to light up its neighbours, click an edge to see the rows behind it.
 */
export function GraphView({ graph }: { graph: GraphData }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const svg = useRef<SVGSVGElement>(null);
  const sim = useRef<Simulation<Node, Link> | null>(null);
  const [, redraw] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [edgeSel, setEdgeSel] = useState<number | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const drag = useRef<{ kind: "node" | "pan"; id?: string; startX: number; startY: number; moved: boolean; view?: typeof view } | null>(null);

  const nodes = useMemo(() => graph.nodes.map((n) => ({ ...n }) as Node), [graph]);
  const at = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

  useEffect(() => {
    const links: Link[] = graph.edges.map((e) => ({ source: e.source, target: e.target }));
    const big = nodes.length > 80;
    const s = forceSimulation(nodes)
      .force("link", forceLink<Node, Link>(links).id((d) => d.id).distance(big ? 34 : 62).strength(0.7))
      .force("charge", forceManyBody().strength(big ? -60 : -170).distanceMax(340))
      .force("collide", forceCollide<Node>().radius((n) => radius(n) + 20))
      .force("center", forceCenter(W / 2, H / 2))
      // Cala networks are mostly separate small clusters; without this pull they drift to the edges.
      .force("x", forceX(W / 2).strength(0.035))
      .force("y", forceY(H / 2).strength(0.06));
    const clamp = () => {
      for (const n of nodes) {
        n.x = Math.max(PAD, Math.min(W - PAD, n.x ?? W / 2));
        n.y = Math.max(PAD, Math.min(H - PAD, n.y ?? H / 2));
      }
    };
    sim.current = s;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      s.stop();
      for (let i = 0; i < 300; i++) s.tick();
      clamp();
      redraw((t) => t + 1);
    } else {
      s.on("tick", () => { clamp(); redraw((t) => t + 1); });
    }
    return () => { s.stop(); };
  }, [graph, nodes]);

  // Screen point -> graph coordinates, through the current pan/zoom.
  const toGraph = (clientX: number, clientY: number) => {
    const ctm = svg.current!.getScreenCTM()!;
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: (p.x - view.x) / view.k, y: (p.y - view.y) / view.k };
  };
  const zoom = (factor: number) =>
    setView((v) => {
      const k = Math.max(0.4, Math.min(4, v.k * factor));
      // Keep the centre of the canvas fixed.
      return { k, x: W / 2 - ((W / 2 - v.x) / v.k) * k, y: H / 2 - ((H / 2 - v.y) / v.k) * k };
    });

  const onPointerDown = (e: React.PointerEvent, id?: string) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    drag.current = { kind: id ? "node" : "pan", id, startX: e.clientX, startY: e.clientY, moved: false, view };
    if (id) {
      const n = at.get(id)!;
      n.fx = n.x;
      n.fy = n.y;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.kind === "node" && d.id) {
      const n = at.get(d.id)!;
      const p = toGraph(e.clientX, e.clientY);
      n.fx = p.x;
      n.fy = p.y;
      sim.current?.alphaTarget(0.25).restart();
    } else if (d.view) {
      const scale = W / svg.current!.getBoundingClientRect().width;
      setView({ ...d.view, x: d.view.x + (e.clientX - d.startX) * scale, y: d.view.y + (e.clientY - d.startY) * scale });
    }
  };
  const onPointerUp = (id?: string) => {
    const d = drag.current;
    drag.current = null;
    if (d?.kind === "node" && d.id) {
      const n = at.get(d.id)!;
      if (d.moved) {
        n.fx = null; // let it settle back into the layout
        n.fy = null;
        sim.current?.alphaTarget(0);
      } else {
        n.fx = null;
        n.fy = null;
        setEdgeSel(null);
        setFocus(focus === id ? null : (id ?? null));
      }
    } else if (d && !d.moved) {
      setFocus(null);
      setEdgeSel(null);
    }
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return; // plain scrolling scrolls the page; pinch / ctrl+wheel zooms
    e.preventDefault();
    zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  };

  const active = focus ?? hover;
  const near = useMemo(() => {
    const set = new Set<string>();
    if (!active) return set;
    set.add(active);
    for (const e of graph.edges) {
      if (e.source === active) set.add(e.target);
      if (e.target === active) set.add(e.source);
    }
    return set;
  }, [active, graph]);
  const selectedEdge: Edge | undefined = edgeSel === null ? undefined : graph.edges[edgeSel];
  const edgeOn = (e: Edge, i: number) => i === edgeSel || (!!active && (e.source === active || e.target === active));
  const dim = (id: string) => (active || selectedEdge) && !near.has(id) && !(selectedEdge && (selectedEdge.source === id || selectedEdge.target === id));
  const showLabel = (n: Node) => nodes.length <= 40 || n.degree >= 2 || near.has(n.id) || selectedEdge?.source === n.id || selectedEdge?.target === n.id;
  const focused = focus ? at.get(focus) : undefined;
  const neighbours = focused
    ? graph.edges
      .filter((e) => e.source === focused.id || e.target === focused.id)
      .map((e) => ({ name: at.get(e.source === focused.id ? e.target : e.source)!.name, weight: e.weight }))
    : [];
  const edgeRows = graph.edges.map((e) => ({ [graph.source]: at.get(e.source)!.name, [graph.target]: at.get(e.target)!.name, rows: String(e.weight) }));

  return (
    <div className="graph">
      <div className="graph-bar">
        <p className="graph-legend">
          <span><i style={{ background: COLOR.source }} /> {graph.source}</span>
          <span><i style={{ background: COLOR.target }} /> {graph.target}</span>
          <span className="muted">{graph.nodes.length} nodes · {graph.edges.length} edges</span>
        </p>
        <span className="graph-zoom">
          <button type="button" className="quiet" onClick={() => zoom(1.25)} aria-label="Zoom in">+</button>
          <button type="button" className="quiet" onClick={() => zoom(0.8)} aria-label="Zoom out">−</button>
          <button type="button" className="quiet" onClick={() => setView({ x: 0, y: 0, k: 1 })}>Reset view</button>
        </span>
      </div>
      <svg
        ref={svg}
        className="graph-stage"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Network of ${graph.source} and ${graph.target}. Drag to pan, click a node or an edge for details.`}
        onPointerDown={(e) => onPointerDown(e)}
        onPointerMove={onPointerMove}
        onPointerUp={() => onPointerUp()}
        onWheel={onWheel}
      >
        <defs>
          <radialGradient id={`${uid}bg`} cx="50%" cy="45%" r="75%">
            <stop offset="0%" stopColor="#1d3148" />
            <stop offset="100%" stopColor="#0b1520" />
          </radialGradient>
          <pattern id={`${uid}dots`} width="26" height="26" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="#ffffff" opacity="0.05" />
          </pattern>
          <filter id={`${uid}glow`} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          {(["source", "target"] as const).map((side) => (
            <radialGradient key={side} id={`${uid}${side}`} cx="35%" cy="35%" r="70%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
              <stop offset="35%" stopColor={COLOR[side]} />
              <stop offset="100%" stopColor={COLOR[side]} stopOpacity="0.75" />
            </radialGradient>
          ))}
        </defs>
        <rect width={W} height={H} fill={`url(#${uid}bg)`} />
        <rect width={W} height={H} fill={`url(#${uid}dots)`} />
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {graph.edges.map((e, i) => {
            const s = at.get(e.source)!;
            const t = at.get(e.target)!;
            const on = edgeOn(e, i);
            const faded = (active || selectedEdge) && !on;
            return (
              <g key={i}>
                <path d={curve(s, t)} fill="none" stroke={on ? "#ffffff" : "#8fb3d9"}
                  strokeOpacity={on ? 0.95 : faded ? 0.06 : 0.3} strokeWidth={Math.min(1.2 + e.weight * 0.8, 5) * (i === edgeSel ? 1.8 : 1)}
                  filter={i === edgeSel ? `url(#${uid}glow)` : undefined} />
                {/* Wide invisible stroke: an easy click target for a thin line. */}
                <path d={curve(s, t)} fill="none" stroke="transparent" strokeWidth={14} className="graph-edge-hit"
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => { ev.stopPropagation(); setFocus(null); setEdgeSel(edgeSel === i ? null : i); }}>
                  <title>{`${s.name} → ${t.name}${e.weight > 1 ? ` (${e.weight} rows)` : ""}. Click for details.`}</title>
                </path>
              </g>
            );
          })}
          {nodes.map((n) => {
            const r = radius(n);
            const hub = n.degree >= 2;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x ?? 0},${n.y ?? 0})`}
                opacity={dim(n.id) ? 0.18 : 1}
                className="graph-node"
                tabIndex={0}
                role="button"
                aria-label={`${n.name}, ${n.degree} connection${n.degree === 1 ? "" : "s"}`}
                aria-pressed={focus === n.id}
                onPointerDown={(e) => onPointerDown(e, n.id)}
                onPointerUp={(e) => { e.stopPropagation(); onPointerUp(n.id); }}
                onPointerEnter={() => setHover(n.id)}
                onPointerLeave={() => setHover(null)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setEdgeSel(null); setFocus(focus === n.id ? null : n.id); }
                }}
              >
                <title>{`${n.name} (${n.side === "source" ? graph.source : graph.target}): ${n.degree} connection${n.degree === 1 ? "" : "s"}`}</title>
                {hub && <circle r={r + 6} fill="none" stroke={COLOR[n.side]} strokeOpacity={0.35} strokeWidth={1.5} />}
                <circle r={r} fill={`url(#${uid}${n.side})`} filter={hub || near.has(n.id) ? `url(#${uid}glow)` : undefined} />
                {focus === n.id && <circle r={r + 10} fill="none" stroke="#ffffff" strokeWidth={1.5} strokeDasharray="3 3" />}
                {showLabel(n) && (
                  <text x={r + 6} y={4} className={`graph-label${hub ? " hub" : ""}`}>{n.name}</text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <p className="muted graph-help">
        Click a node to light up its connections, click a line for the rows behind it. Drag nodes or the background; pinch or use + / − to zoom.
      </p>

      {selectedEdge && (
        <div className="graph-detail" role="region" aria-label="Edge detail">
          <div className="graph-detail-head">
            <span>
              <span className="pill" style={{ borderColor: COLOR.source }}>{at.get(selectedEdge.source)!.name}</span>
              <span aria-hidden="true"> ⟶ </span>
              <span className="pill" style={{ borderColor: COLOR.target }}>{at.get(selectedEdge.target)!.name}</span>
            </span>
            <button type="button" className="link" onClick={() => setEdgeSel(null)}>Close</button>
          </div>
          <p className="muted">
            {selectedEdge.weight} row{selectedEdge.weight === 1 ? "" : "s"} link these two
            {selectedEdge.weight > selectedEdge.rows.length ? ` (first ${selectedEdge.rows.length} shown)` : ""}. Every column from the data:
          </p>
          <Table rows={selectedEdge.rows} columns={columnsOf(selectedEdge.rows)} total={selectedEdge.rows.length} />
        </div>
      )}
      {focused && !selectedEdge && (
        <div className="graph-detail" role="status">
          <div className="graph-detail-head">
            <span>
              <span className="pill" style={{ borderColor: COLOR[focused.side] }}>{focused.name}</span>{" "}
              connects to {neighbours.length}
            </span>
            <button type="button" className="link" onClick={() => setFocus(null)}>Close</button>
          </div>
          <p>{neighbours.map((x) => (x.weight > 1 ? `${x.name} (${x.weight})` : x.name)).join(" · ")}</p>
        </div>
      )}
      <details>
        <summary>Edges as a table</summary>
        <Table rows={edgeRows} columns={[graph.source, graph.target, "rows"]} total={edgeRows.length} />
      </details>
    </div>
  );
}
