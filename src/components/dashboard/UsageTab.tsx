import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getAiUsageStats } from "@/lib/agent.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Activity, Brain, Coins, Clock, TrendingUp, TrendingDown, Minus,
  Zap, AlertTriangle, RefreshCw, BarChart3, Cpu,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type Row = {
  model: string;
  operation: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
  latency_ms: number;
  success: boolean;
  created_at: string;
};

const RANGES = [
  { value: 1, label: "24h" },
  { value: 7, label: "7 j" },
  { value: 30, label: "30 j" },
  { value: 90, label: "90 j" },
];

const PIE_COLORS = ["#a78bfa", "#22d3ee", "#34d399", "#fbbf24", "#fb7185", "#60a5fa", "#f472b6"];

function fmtUsd(n: number) {
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(6)}`;
}
function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
function deltaIcon(delta: number) {
  if (delta > 0.01) return <TrendingUp className="w-3.5 h-3.5 text-rose-400" />;
  if (delta < -0.01) return <TrendingDown className="w-3.5 h-3.5 text-emerald-400" />;
  return <Minus className="w-3.5 h-3.5 text-muted-foreground" />;
}
function deltaText(curr: number, prev: number) {
  if (prev === 0) return curr === 0 ? "0%" : "—";
  const pct = ((curr - prev) / prev) * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(1)}%`;
}

export function UsageTab() {
  const fetchStats = useServerFn(getAiUsageStats);
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const res: any = await fetchStats({ data: { days } });
      setRows(res.rows as Row[]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(() => load(true), 15_000);
    return () => clearInterval(id);
  }, [days]);

  const stats = useMemo(() => {
    const totalCost = rows.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);
    const totalTokens = rows.reduce((s, r) => s + (r.total_tokens ?? 0), 0);
    const totalPrompt = rows.reduce((s, r) => s + (r.prompt_tokens ?? 0), 0);
    const totalCompletion = rows.reduce((s, r) => s + (r.completion_tokens ?? 0), 0);
    const calls = rows.length;
    const errors = rows.filter((r) => !r.success).length;
    const avgLatency = calls ? Math.round(rows.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / calls) : 0;
    const avgCost = calls ? totalCost / calls : 0;
    const successRate = calls ? ((calls - errors) / calls) * 100 : 100;
    return { totalCost, totalTokens, totalPrompt, totalCompletion, calls, errors, avgLatency, avgCost, successRate };
  }, [rows]);

  // Compare with previous window of same length (call separate fetch)
  const [prevStats, setPrevStats] = useState({ totalCost: 0, totalTokens: 0, calls: 0, avgLatency: 0 });
  useEffect(() => {
    (async () => {
      try {
        const res: any = await fetchStats({ data: { days: days * 2 } });
        const cutoff = Date.now() - days * 86400_000;
        const prev = (res.rows as Row[]).filter((r) => new Date(r.created_at).getTime() < cutoff);
        const totalCost = prev.reduce((s, r) => s + Number(r.estimated_cost_usd ?? 0), 0);
        const totalTokens = prev.reduce((s, r) => s + (r.total_tokens ?? 0), 0);
        const avgLatency = prev.length ? Math.round(prev.reduce((s, r) => s + (r.latency_ms ?? 0), 0) / prev.length) : 0;
        setPrevStats({ totalCost, totalTokens, calls: prev.length, avgLatency });
      } catch { /* noop */ }
    })();
  }, [days, rows.length]);

  // Time series — bucket by day (or hour if 24h)
  const series = useMemo(() => {
    const bucketHours = days <= 1 ? 1 : 24;
    const bucketMs = bucketHours * 3600_000;
    const start = Date.now() - days * 86400_000;
    const buckets = new Map<number, { t: number; cost: number; tokens: number; calls: number; errors: number }>();
    const nBuckets = Math.ceil((days * 86400_000) / bucketMs);
    for (let i = 0; i <= nBuckets; i++) {
      const t = Math.floor((start + i * bucketMs) / bucketMs) * bucketMs;
      buckets.set(t, { t, cost: 0, tokens: 0, calls: 0, errors: 0 });
    }
    for (const r of rows) {
      const t = Math.floor(new Date(r.created_at).getTime() / bucketMs) * bucketMs;
      const b = buckets.get(t) ?? { t, cost: 0, tokens: 0, calls: 0, errors: 0 };
      b.cost += Number(r.estimated_cost_usd ?? 0);
      b.tokens += r.total_tokens ?? 0;
      b.calls += 1;
      if (!r.success) b.errors += 1;
      buckets.set(t, b);
    }
    return Array.from(buckets.values())
      .sort((a, b) => a.t - b.t)
      .map((b) => ({
        ...b,
        label:
          days <= 1
            ? new Date(b.t).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
            : new Date(b.t).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }),
      }));
  }, [rows, days]);

  const byModel = useMemo(() => {
    const m = new Map<string, { model: string; calls: number; tokens: number; cost: number; latency: number }>();
    for (const r of rows) {
      const k = r.model;
      const prev = m.get(k) ?? { model: k, calls: 0, tokens: 0, cost: 0, latency: 0 };
      prev.calls += 1;
      prev.tokens += r.total_tokens ?? 0;
      prev.cost += Number(r.estimated_cost_usd ?? 0);
      prev.latency += r.latency_ms ?? 0;
      m.set(k, prev);
    }
    return Array.from(m.values())
      .map((x) => ({ ...x, avgLatency: x.calls ? Math.round(x.latency / x.calls) : 0 }))
      .sort((a, b) => b.cost - a.cost);
  }, [rows]);

  const byOperation = useMemo(() => {
    const m = new Map<string, { operation: string; calls: number; cost: number; tokens: number }>();
    for (const r of rows) {
      const k = r.operation;
      const prev = m.get(k) ?? { operation: k, calls: 0, cost: 0, tokens: 0 };
      prev.calls += 1;
      prev.cost += Number(r.estimated_cost_usd ?? 0);
      prev.tokens += r.total_tokens ?? 0;
      m.set(k, prev);
    }
    return Array.from(m.values()).sort((a, b) => b.cost - a.cost);
  }, [rows]);

  const recent = rows.slice(0, 20);

  return (
    <div className="space-y-6">
      {/* Header with range selector */}
      <div className="glass rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center shadow-glow">
              <Brain className="w-4 h-4 text-primary-foreground" />
            </div>
            <h2 className="text-lg font-bold">Consommation IA</h2>
            <Badge variant="outline" className="text-xs font-mono border-primary/40 text-primary bg-primary/10">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse mr-1.5" /> LIVE
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">Suivi en temps réel des appels Lovable AI — coût, tokens, latence, historique.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="glass border border-border rounded-xl p-1 flex">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setDays(r.value)}
                className={`px-3 py-1.5 text-xs font-mono rounded-lg transition ${
                  days === r.value ? "bg-gradient-primary text-primary-foreground shadow-glow" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => load(true)} disabled={refreshing}>
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<Coins className="w-4 h-4" />}
          label="Coût estimé"
          value={fmtUsd(stats.totalCost)}
          delta={deltaText(stats.totalCost, prevStats.totalCost)}
          trend={stats.totalCost - prevStats.totalCost}
          accent="from-amber-500/20 to-amber-500/5 border-amber-500/30"
        />
        <KpiCard
          icon={<Zap className="w-4 h-4" />}
          label="Tokens totaux"
          value={fmtTokens(stats.totalTokens)}
          delta={deltaText(stats.totalTokens, prevStats.totalTokens)}
          trend={stats.totalTokens - prevStats.totalTokens}
          accent="from-violet-500/20 to-violet-500/5 border-violet-500/30"
        />
        <KpiCard
          icon={<Activity className="w-4 h-4" />}
          label="Appels IA"
          value={String(stats.calls)}
          delta={deltaText(stats.calls, prevStats.calls)}
          trend={stats.calls - prevStats.calls}
          accent="from-cyan-500/20 to-cyan-500/5 border-cyan-500/30"
        />
        <KpiCard
          icon={<Clock className="w-4 h-4" />}
          label="Latence moy."
          value={`${stats.avgLatency} ms`}
          delta={deltaText(stats.avgLatency, prevStats.avgLatency)}
          trend={stats.avgLatency - prevStats.avgLatency}
          accent="from-emerald-500/20 to-emerald-500/5 border-emerald-500/30"
          inverted
        />
      </div>

      {/* Health row */}
      <div className="grid md:grid-cols-3 gap-4">
        <div className="glass rounded-2xl p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">TAUX DE SUCCÈS</div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="text-2xl font-bold">{stats.successRate.toFixed(1)}%</span>
            {stats.errors > 0 && (
              <Badge variant="outline" className="border-destructive/40 text-destructive bg-destructive/10 text-xs">
                <AlertTriangle className="w-3 h-3 mr-1" /> {stats.errors} erreur{stats.errors > 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <Progress value={stats.successRate} className="h-2" />
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">COÛT MOY. / APPEL</div>
          <div className="text-2xl font-bold">{fmtUsd(stats.avgCost)}</div>
          <div className="text-xs text-muted-foreground mt-2">
            Prompt: {fmtTokens(stats.totalPrompt)} · Réponse: {fmtTokens(stats.totalCompletion)}
          </div>
        </div>
        <div className="glass rounded-2xl p-5">
          <div className="text-xs font-mono text-muted-foreground mb-2">MODÈLES UTILISÉS</div>
          <div className="text-2xl font-bold">{byModel.length}</div>
          <div className="flex flex-wrap gap-1 mt-2">
            {byModel.slice(0, 3).map((m) => (
              <Badge key={m.model} variant="outline" className="text-[10px] font-mono">
                <Cpu className="w-2.5 h-2.5 mr-1" /> {m.model.split("/")[1]}
              </Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Time series */}
      <div className="glass rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-semibold flex items-center gap-2"><BarChart3 className="w-4 h-4 text-primary" /> Historique des coûts</h3>
            <p className="text-xs text-muted-foreground">Évolution du coût estimé et du volume de tokens sur la période.</p>
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.6} />
                  <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="tokGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#22d3ee" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `$${v.toFixed(3)}`} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => fmtTokens(v)} />
              <Tooltip
                contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                formatter={(v: any, name: string) => name === "Coût" ? fmtUsd(Number(v)) : fmtTokens(Number(v))}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area yAxisId="left" type="monotone" dataKey="cost" name="Coût" stroke="#a78bfa" fill="url(#costGrad)" strokeWidth={2} />
              <Area yAxisId="right" type="monotone" dataKey="tokens" name="Tokens" stroke="#22d3ee" fill="url(#tokGrad)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Two-column: by model + by operation */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-4"><Cpu className="w-4 h-4 text-primary" /> Répartition par modèle</h3>
          {byModel.length === 0 ? (
            <EmptyChart />
          ) : (
            <>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={byModel} dataKey="cost" nameKey="model" outerRadius={80} innerRadius={45} paddingAngle={2}>
                      {byModel.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                      formatter={(v: any) => fmtUsd(Number(v))}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 mt-2">
                {byModel.map((m, i) => (
                  <div key={m.model} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="truncate font-mono">{m.model}</span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-muted-foreground">{m.calls} appels</span>
                      <span className="text-muted-foreground">{m.avgLatency}ms</span>
                      <span className="font-mono font-semibold">{fmtUsd(m.cost)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="glass rounded-2xl p-5">
          <h3 className="font-semibold flex items-center gap-2 mb-4"><Activity className="w-4 h-4 text-primary" /> Par opération</h3>
          {byOperation.length === 0 ? (
            <EmptyChart />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={byOperation} layout="vertical" margin={{ top: 10, right: 16, left: 80, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `$${Number(v).toFixed(3)}`} />
                  <YAxis type="category" dataKey="operation" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} width={140} />
                  <Tooltip
                    contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any) => fmtUsd(Number(v))}
                  />
                  <Bar dataKey="cost" fill="#a78bfa" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Recent calls */}
      <div className="glass rounded-2xl p-5">
        <h3 className="font-semibold flex items-center gap-2 mb-4"><Clock className="w-4 h-4 text-primary" /> Appels récents</h3>
        {loading ? (
          <div className="text-center text-muted-foreground py-8 text-sm">Chargement...</div>
        ) : recent.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">
            Aucun appel IA enregistré sur cette période. L'agent commencera à logger dès le prochain email traité.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground font-mono">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3">Quand</th>
                  <th className="py-2 pr-3">Opération</th>
                  <th className="py-2 pr-3">Modèle</th>
                  <th className="py-2 pr-3 text-right">Tokens</th>
                  <th className="py-2 pr-3 text-right">Coût</th>
                  <th className="py-2 pr-3 text-right">Latence</th>
                  <th className="py-2 text-right">Statut</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="py-2 pr-3 font-mono">{r.operation}</td>
                    <td className="py-2 pr-3 font-mono text-muted-foreground">{r.model.split("/")[1]}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmtTokens(r.total_tokens)}</td>
                    <td className="py-2 pr-3 text-right font-mono">{fmtUsd(Number(r.estimated_cost_usd))}</td>
                    <td className="py-2 pr-3 text-right font-mono text-muted-foreground">{r.latency_ms}ms</td>
                    <td className="py-2 text-right">
                      {r.success ? (
                        <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-400 bg-emerald-500/10">OK</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive bg-destructive/10">ERR</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  icon, label, value, delta, trend, accent, inverted,
}: { icon: React.ReactNode; label: string; value: string; delta: string; trend: number; accent: string; inverted?: boolean }) {
  const realTrend = inverted ? -trend : trend;
  return (
    <div className={`glass rounded-2xl p-5 border bg-gradient-to-br ${accent} relative overflow-hidden`}>
      <div className="flex items-center justify-between mb-3">
        <div className="w-8 h-8 rounded-lg bg-background/40 backdrop-blur flex items-center justify-center">{icon}</div>
        <div className="flex items-center gap-1 text-[11px] font-mono text-muted-foreground">
          {deltaIcon(realTrend)} {delta}
        </div>
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-[11px] font-mono text-muted-foreground uppercase mt-1">{label}</div>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">
      Aucune donnée sur cette période.
    </div>
  );
}
