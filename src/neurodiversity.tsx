import React, { useEffect, useMemo, useRef, useState } from "react";
import Papa, { type ParseResult } from "papaparse";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Search, Circle } from "lucide-react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Tooltip as ReTooltip, ResponsiveContainer } from "recharts";

const TRAITS = [
  "Hyperrealism",
  "Sensory Sensitivity",
  "Cognitive Empathy",
  "Systemizing",
  "Attention",
  "Flexibility",
  "Motivation",
  "Visual vs Verbal Thinking",
] as const;

const TRAIT_LABELS: Record<string, string> = {
  "Hyperrealism": "Hyperrealism",
  "Sensory Sensitivity": "Sensory Sensitivity",
  "Cognitive Empathy": "Empathy",
  "Systemizing": "Systemizing",
  "Attention": "Attention",
  "Flexibility": "Flexibility",
  "Motivation": "Motivation",
  "Visual vs Verbal Thinking": "Visual Thinking",
};

// --- Cluster ellipse palette (pastels) ---
const CLUSTER_PASTELS = [
  '#FADA7A', '#FFC7A7', '#FFCFD2', '#F1C0E8', '#CFBAF0',
  '#90DBF4', '#A3C4F3', '#8EECF5', '#98F5E1', '#B9FBC0'
];

const TRAIT_DEFS: Record<string, string> = {
  Hyperrealism: "Attention to fine perceptual detail; preference for precise, literal representations.",
  "Sensory Sensitivity": "Heightened responsiveness to sensory input (sound, light, texture, etc.).",
  "Cognitive Empathy": "Ability to understand and model others’ thoughts and feelings (perspective-taking).",
  Systemizing: "Drive to analyze, build, and understand rule-based systems.",
  Attention: "Sustained focus, distractibility, and attentional switching.",
  Flexibility: "Cognitive shifting, adaptability to change, tolerance to uncertainty.",
  Motivation: "Task initiation, persistence, reward sensitivity.",
  "Visual vs Verbal Thinking": "Preference along a visual imagery ↔ verbal/linguistic processing axis.",
};

// Viridis colormap (0..1) sampled + linear interpolation
function viridis(t: number) {
  const stops = [
    [0.0,   '#31083E'],
    [0.111, '#3D0A89'],
    [0.222, '#532496'],
    [0.333, '#6A3FA3'],
    [0.444, '#815AB0'],
    [0.555, '#9775BE'],
    [0.666, '#AD90CB'],
    [0.777, '#C3ABD8'],
    [0.888, '#D8C5E4'],
    [1.0,   '#ECE0F0'],
  ] as const;
  t = Math.min(1, Math.max(0, t));
  let i = 0;
  while (i < stops.length - 1 && t > (stops[i + 1][0] as number)) i++;
  const [t0, c0] = stops[i] as [number, string];
  const [t1, c1] = stops[Math.min(i + 1, stops.length - 1)] as [number, string];
  const u = (t - t0) / ((t1 - t0) || 1);
  const h2r = (h: string) => parseInt(h, 16);
  const r0 = h2r(c0.slice(1,3)), g0 = h2r(c0.slice(3,5)), b0 = h2r(c0.slice(5,7));
  const r1 = h2r(c1.slice(1,3)), g1 = h2r(c1.slice(3,5)), b1 = h2r(c1.slice(5,7));
  const r = Math.round(r0 + (r1 - r0) * u);
  const g = Math.round(g0 + (g1 - g0) * u);
  const b = Math.round(b0 + (b1 - b0) * u);
  return `rgb(${r},${g},${b})`;
}

function traitColor(val: number | null | undefined, vmin = 1, vmax = 9) {
  if (val == null || Number.isNaN(val)) return '#bbbbbb';
  const t = (val - vmin) / (vmax - vmin);
  return viridis(t);
}

// --- Ellipse helpers (match Python logic) ---
function eig2x2(a: number, b: number, _c: number, d: number) {
  const tr = a + d;
  const det = a * d - b * b;
  const tmp = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const l1 = tr / 2 + tmp;
  const l2 = tr / 2 - tmp;
  let v1x = b, v1y = l1 - a;
  if (Math.abs(v1x) + Math.abs(v1y) < 1e-12) { v1x = l1 - d; v1y = b; }
  const n1 = Math.hypot(v1x, v1y) || 1; v1x /= n1; v1y /= n1;
  const v2x = -v1y, v2y = v1x;
  return { vals: [l1, l2], vecs: [[v1x, v2x], [v1y, v2y]] };
}

function covEllipse(points: { x: number; y: number }[], k = 1) {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of points) { const dx = p.x - mx, dy = p.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= n; syy /= n; sxy /= n;
  sxx += 1e-9; syy += 1e-9;
  const { vals, vecs } = eig2x2(sxx, sxy, sxy, syy);
  const width = 1.5 * k * Math.sqrt(Math.max(vals[0], 0));
  const height = 2 * k * Math.sqrt(Math.max(vals[1], 0));
  const angle = Math.atan2(vecs[1][0], vecs[0][0]);
  return { cx: mx, cy: my, width, height, angle };
}

// --- CSV helpers ---
async function fetchText(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

// replace your function with this
function parseCsv(text: string) {
  return new Promise<any[]>((resolve) => {
    Papa.parse(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (res: ParseResult<any>) => resolve(res.data as any[]),
    });
  });
}

export default function NeurodiversityMapMockup() {
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);

  const [trait, setTrait] = useState<string>(TRAITS[0]);
  const [showEdges, setShowEdges] = useState(true);
  const [edgeScale, setEdgeScale] = useState(1.0);
  const [pointSize, setPointSize] = useState(5);
  const [showEllipses, setShowEllipses] = useState(true);
  const [selectedId, setSelectedId] = useState<string>("");

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Always load directly from GitHub (no uploads, no URL params)
  useEffect(() => {
    let cancelled = false;

    async function loadDirect() {
      try {
        const [nodesTxt, edgesTxt] = await Promise.all([
          fetchText("https://raw.githubusercontent.com/laiadc/ND_test/main/neuroprofiles_with_clusters.csv"),
          fetchText("https://raw.githubusercontent.com/laiadc/ND_test/main/edges.csv"),
        ]);
        if (cancelled) return;

        const [nrows, erows] = await Promise.all([
          parseCsv(nodesTxt),
          parseCsv(edgesTxt),
        ]);

        // Normalize node records
        const nNorm = (nrows as any[]).filter(Boolean).map((r) => {
          const id = String(r.id ?? r.ID ?? r.user_id ?? r.UserID ?? "").trim();
          const x = Number(r.x_KPCA ?? r.kpca_x ?? r.KPCA_X ?? r.X ?? r.x ?? r.KPCA1);
          const y = Number(r.y_KPCA ?? r.kpca_y ?? r.KPCA_Y ?? r.Y ?? r.y ?? r.KPCA2);
          let clusterRaw: any = (r.cluster ?? r.Cluster ?? r.clusters ?? r.Clusters ?? r.community ?? r.Community ?? r.label ?? r.Label ?? r.comm_id ?? r.comm ?? null);
          if (typeof clusterRaw === 'string') {
            const t = clusterRaw.trim();
            if (!t || t.toLowerCase() === 'nan' || t.toLowerCase() === 'none' || t.toLowerCase() === 'null') clusterRaw = null;
          }
          return { ...r, id, x_KPCA: x, y_KPCA: y, cluster: clusterRaw };
        });

        // Normalize edges
        const eNorm = (erows as any[]).filter(Boolean).map((r) => {
          const s = (r.source_id ?? r.source ?? r.from ?? r.i ?? r.u ?? r.SOURCE ?? r.Source ?? r.From);
          const t = (r.target_id ?? r.target ?? r.to ?? r.j ?? r.v ?? r.TARGET ?? r.Target ?? r.To);
          const w = (r.weight ?? r.w ?? r.value ?? r.sim ?? r.similarity ?? r.Weight ?? r.W);
          const source_id = String(s ?? "").trim();
          const target_id = String(t ?? "").trim();
          const weight = Number(w ?? 1);
          return { source_id, target_id, weight };
        }).filter((e) => e.source_id && e.target_id);

        setNodes(nNorm);
        setEdges(eNorm);
      } catch (e: any) {
        if (cancelled) return;
      }
    }

    loadDirect();
    return () => { cancelled = true; };
  }, []);

  const extent = useMemo(() => {
    if (!nodes.length) return { xmin: -1, xmax: 1, ymin: -1, ymax: 1 };
    const xs = nodes.map((d) => Number(d.x_KPCA)).filter((v) => Number.isFinite(v));
    const ys = nodes.map((d) => Number(d.y_KPCA)).filter((v) => Number.isFinite(v));
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    const ymin = Math.min(...ys), ymax = Math.max(...ys);
    const padX = (xmax - xmin || 1) * 0.08;
    const padY = (ymax - ymin || 1) * 0.08;
    return { xmin: xmin - padX, xmax: xmax + padX, ymin: ymin - padY, ymax: ymax + padY };
  }, [nodes]);

  // Cluster → ellipse params
  const ellipses = useMemo(() => {
    if (!showEllipses) return [] as any[];
    const byCluster: Record<string, { x: number; y: number }[]> = {};
    for (const n of nodes) {
      const c = String((n as any).cluster ?? "nan");
      if (c === "nan") continue;
      if (!byCluster[c]) byCluster[c] = [];
      const x = Number((n as any).x_KPCA), y = Number((n as any).y_KPCA);
      if (Number.isFinite(x) && Number.isFinite(y)) byCluster[c].push({ x, y });
    }
    const out: any[] = [];
    Object.entries(byCluster).forEach(([cid, pts]) => {
      if (pts.length > 2) {
        const e = covEllipse(pts, 2.5);
        out.push({ cid, ...e });
      }
    });
    return out;
  }, [nodes, showEllipses]);

  const clusterColorById = useMemo(() => {
    const ids = Array.from(new Set(ellipses.map((e: any) => String(e.cid)))).sort();
    const m = new Map<string, string>();
    ids.forEach((cid, i) => m.set(cid, CLUSTER_PASTELS[i % CLUSTER_PASTELS.length]));
    return m;
  }, [ellipses]);

  const nodeById = useMemo(() => {
    const m = new Map<string, any>();
    for (const n of nodes) m.set(String(n.id), n);
    return m;
  }, [nodes]);

  const userOptions = useMemo(() => {
    const opts = nodes.map((n: any) => {
      const id = String(n.id);
      const label = String(n.name ?? n.display_name ?? n.username ?? n.id);
      return { id, label };
    });
    const seen = new Set<string>();
    const uniq: { id: string; label: string }[] = [];
    for (const o of opts) { if (!seen.has(o.id)) { seen.add(o.id); uniq.push(o); } }
    return uniq.sort((a,b) => a.label.localeCompare(b.label));
  }, [nodes]);

  const edgeSegments = useMemo(() => {
    const segs: { x1: number; y1: number; x2: number; y2: number; w: number }[] = [];
    let matched = 0;
    for (const e of edges) {
      const a = nodeById.get(String(e.source_id));
      const b = nodeById.get(String(e.target_id));
      if (!a || !b) continue;
      const x1 = Number(a.x_KPCA), y1 = Number(a.y_KPCA);
      const x2 = Number(b.x_KPCA), y2 = Number(b.y_KPCA);
      if ([x1, y1, x2, y2].every(Number.isFinite)) {
        segs.push({ x1, y1, x2, y2, w: Number(e.weight) || 0 });
        matched += 1;
      }
    }
    return segs;
  }, [edges, nodeById]);

  // Render canvas (HiDPI-aware)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 900;
    const cssH = canvas.clientHeight || 650;
    if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const W = cssW;
    const H = cssH;

    const sx = (x: number) => {
      const u = (x - extent.xmin) / (extent.xmax - extent.xmin || 1);
      return u * (W - 20) + 10;
    };
    const sy = (y: number) => {
      const v = 1 - (y - extent.ymin) / (extent.ymax - extent.ymin || 1);
      return v * (H - 20) + 10;
    };

    ctx.clearRect(0, 0, W, H);

    // Grid
    ctx.save();
    ctx.strokeStyle = "#e5e7eb";
    for (let gx = 0; gx <= 4; gx++) {
      const x = 10 + (gx * (W - 20)) / 4;
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, H - 10);
      ctx.stroke();
    }
    for (let gy = 0; gy <= 4; gy++) {
      const y = 10 + (gy * (H - 20)) / 4;
      ctx.beginPath();
      ctx.moveTo(10, y);
      ctx.lineTo(W - 10, y);
      ctx.stroke();
    }
    ctx.restore();

    // Ellipses
    if (showEllipses) {
      ctx.save();
      ellipses.forEach((e) => {
        const cx = sx(e.cx), cy = sy(e.cy);
        const rx = (e.width / 2) * ((W - 20) / (extent.xmax - extent.xmin || 1));
        const ry = (e.height / 2) * ((H - 20) / (extent.ymax - extent.ymin || 1));
        const color = clusterColorById.get(String(e.cid)) || '#ccc';
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-e.angle);
        ctx.beginPath();
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.25;
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.35;
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.restore();
      });
      ctx.restore();
    }

    // Edges
    if (showEdges) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.strokeStyle = "#6b7280";
      ctx.lineCap = "round";
      edgeSegments.forEach((s) => {
        const lw = Math.max(0.6, s.w * edgeScale);
        ctx.lineWidth = lw;
        ctx.beginPath();
        ctx.moveTo(sx(s.x1), sy(s.y1));
        ctx.lineTo(sx(s.x2), sy(s.y2));
        ctx.stroke();
      });
      ctx.restore();
    }

    // Nodes
    ctx.save();
    for (const n of nodes) {
      const x = Number(n.x_KPCA), y = Number(n.y_KPCA);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const r = pointSize;
      const c = traitColor(Number(n[trait]));
      ctx.beginPath();
      ctx.arc(sx(x), sy(y), r, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    }
    ctx.restore();

    // Highlight selected
    const toHighlight = selectedId;
    if (toHighlight) {
      const n = nodeById.get(String(toHighlight));
      if (n) {
        const x = Number(n.x_KPCA), y = Number(n.y_KPCA);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          ctx.save();
          ctx.strokeStyle = "#111827";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(sx(x), sy(y), pointSize + 4, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }
  }, [nodes, edges, trait, showEdges, edgeScale, extent, pointSize, selectedId, nodeById, ellipses, showEllipses, clusterColorById]);

  // Click → pick nearest point
  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    const canvas = canvasRef.current!;
    const W = canvas.clientWidth || 900;
    const H = canvas.clientHeight || 650;

    const sx = (x: number) => {
      const u = (x - extent.xmin) / (extent.xmax - extent.xmin || 1);
      return u * (W - 20) + 10;
    };
    const sy = (y: number) => {
      const v = 1 - (y - extent.ymin) / (extent.ymax - extent.ymin || 1);
      return v * (H - 20) + 10;
    };

    let bestId = "";
    let bestD = Infinity;
    for (const n of nodes) {
      const x = Number(n.x_KPCA), y = Number(n.y_KPCA);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      const dx = sx(x) - cx;
      const dy = sy(y) - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD) {
        bestD = d2;
        bestId = String(n.id);
      }
    }
    if (bestId) setSelectedId(bestId);
  }

  const selectedNode = selectedId ? nodeById.get(String(selectedId)) : null;

  const radarData = useMemo(() => {
    if (!selectedNode)
      return TRAITS.map((t) => ({ trait: TRAIT_LABELS[t] || t, value: 0 }));
    return TRAITS.map((t) => ({
      trait: TRAIT_LABELS[t] || t,
      value: Number(selectedNode[t]) || 0,
    }));
  }, [selectedNode]);

  return (
    <div className="w-full min-h-screen p-4 md:p-6 lg:p-8 bg-white">
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* Left panel: appearance + lightweight data status */}
        <div className="xl:col-span-3 space-y-4">         
          {/* Bottom: only Trait definitions (metrics removed) */}
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl">Trait definitions</CardTitle>
            </CardHeader>
            <CardContent>
              {/* fixed height + scrollable + small text */}
              <div className="h-[207px] overflow-y-auto pr-2 text-xs space-y-2">
                <ul className="space-y-1">
                  {TRAITS.map((t) => (
                    <li key={t}>
                      <span className="font-semibold">{t}:</span>{" "}
                      <span className="font-normal">{TRAIT_DEFS[t]}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl flex items-center gap-2"><Circle className="h-5 w-5"/> Appearance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Edges */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Label>Edges</Label></div>
                <Switch checked={showEdges} onCheckedChange={setShowEdges} />
              </div>

              {/* Edge thickness */}
              <div className="space-y-1">
                <Label>Edge thickness × {edgeScale.toFixed(1)}</Label>
                <Slider value={[edgeScale]} min={0.2} max={8} step={0.2} onValueChange={(v) => setEdgeScale(v[0])} />
              </div>

              {/* Point size */}
              <div className="space-y-1">
                <Label>Point size: {pointSize}px</Label>
                <Slider value={[pointSize]} min={2} max={10} step={1} onValueChange={(v) => setPointSize(v[0])} />
              </div>

              {/* Cluster ellipses */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Label>Cluster ellipses</Label></div>
                <Switch checked={showEllipses} onCheckedChange={setShowEllipses} />
              </div>

              {/* Color by trait */}
              <div className="space-y-2">
                <Label>Color by trait</Label>
                <Select value={trait} onValueChange={(v) => setTrait(v)}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select trait" />
                  </SelectTrigger>
                  <SelectContent>
                    {TRAITS.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>


        </div>

        {/* Center: Map canvas */}
        <div className="xl:col-span-6 space-y-5">
          <Card className="shadow-sm">
            <CardHeader className="pb-0">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">Neurodiversity Map</CardTitle>
                <div className="text-xs text-gray-500">Color: {trait}</div>
              </div>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="relative">
                <canvas
                  ref={canvasRef}
                  className="w-full aspect-[900/600] rounded-2xl shadow border border-gray-200"
                  onClick={handleCanvasClick}
                />
                <div className="absolute left-3 top-2 text-xs text-gray-600">KPCA-1</div>
                <div className="absolute right-3 bottom-2 text-xs text-gray-600">KPCA-2</div>
              </div>
              <div className="mt-3 flex justify-end">
                <Button size="sm" onClick={() => setSelectedId('User 1')}>Focus your profile</Button>
              </div>
              {/* Legend */}
              <div className="mt-2">
                <Label className="text-sm">Legend</Label>
                <div className="mt-2">
                  <div className="h-2 w-full rounded" style={{background: 'linear-gradient(90deg,#31083E, #3D0A89, #532496, #6A3FA3, #815AB0, #9775BE, #AD90CB, #C3ABD8, #D8C5E4, #ECE0F0)'}} />
                  <div className="flex justify-between text-xs text-gray-600 mt-1">
                    {[1,3,5,7,9].map((t) => (<span key={t}>{t}</span>))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right: Profile */}
        <div className="xl:col-span-3 space-y-8">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-xl flex items-center gap-2"><Search className="h-9 w-5"/> Profile</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-16">
                <Label className="text-sm">Select user</Label>
                <Select value={selectedId || "__none__"} onValueChange={(v) => setSelectedId(v === "__none__" ? "" : v)}>
                  <SelectTrigger className="w-full mt-1">
                    <SelectValue placeholder="Pick a user…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">(None)</SelectItem>
                    {userOptions.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="text-sm text-gray-600 mb-2">
                {selectedNode ? (
                  <>
                    <span className="font-small">Selected:</span> {String(selectedNode.id)}{" "}
                    {selectedNode.cluster != null && selectedNode.cluster !== "" ? (
                      <span className="ml-1 text-xs text-gray-500">(cluster {String(selectedNode.cluster)})</span>
                    ) : null}
                  </>
                ) : "Click a point or pick a user"}
              </div>

              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="80%">
                    <PolarGrid />
                    <PolarAngleAxis dataKey="trait" tick={{ fontSize: 8 }} />
                    <PolarRadiusAxis domain={[0, 9]} tick={{ fontSize: 8 }} />
                    <Radar name="Profile" dataKey="value" fillOpacity={0.45} stroke="#111827" fill="#d182f1ff" />
                    <ReTooltip formatter={(v: any) => String(v)} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>

              {selectedNode && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm mt-3">
                  {TRAITS.map((t) => (
                    <div key={t} className="flex items-center justify-between">
                      <span>{t}</span>
                      <span className="font-mono">{Number(selectedNode[t]) || 0}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        

      </div>
    </div>
  );
}
