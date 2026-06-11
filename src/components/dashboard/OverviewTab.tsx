import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Calendar, MessagesSquare, Sparkles } from "lucide-react";

interface Stats { threads: number; appointments: number; messages: number; activities: number }

export function OverviewTab() {
  const [stats, setStats] = useState<Stats>({ threads: 0, appointments: 0, messages: 0, activities: 0 });
  const [recent, setRecent] = useState<any[]>([]);

  const load = async () => {
    const [t, a, m, act] = await Promise.all([
      supabase.from("email_threads").select("id", { count: "exact", head: true }),
      supabase.from("appointments").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
      supabase.from("email_messages").select("id", { count: "exact", head: true }),
      supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(8),
    ]);
    setStats({ threads: t.count ?? 0, appointments: a.count ?? 0, messages: m.count ?? 0, activities: act.data?.length ?? 0 });
    setRecent(act.data ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("overview")
      .on("postgres_changes", { event: "*", schema: "public", table: "activity_logs" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const cards = [
    { icon: MessagesSquare, label: "Conversations", value: stats.threads, color: "from-cyan-400/20 to-cyan-500/5" },
    { icon: Calendar, label: "RDV confirmés", value: stats.appointments, color: "from-violet-400/20 to-violet-500/5" },
    { icon: Mail, label: "Emails traités", value: stats.messages, color: "from-emerald-400/20 to-emerald-500/5" },
    { icon: Sparkles, label: "Actions IA récentes", value: stats.activities, color: "from-amber-400/20 to-amber-500/5" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className={`glass rounded-2xl p-5 bg-gradient-to-br ${c.color} hover:shadow-glow transition-all`}>
            <c.icon className="w-5 h-5 text-primary mb-3" />
            <div className="text-3xl font-bold font-mono">{c.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="glass rounded-2xl p-6">
        <h3 className="font-semibold mb-4 flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Dernières actions de l'agent</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Aucune activité pour l'instant. Connectez Gmail et lancez une analyse.</p>
        ) : (
          <ul className="space-y-3">
            {recent.map((a) => (
              <li key={a.id} className="flex items-start gap-3 text-sm border-l-2 border-primary/40 pl-3">
                <div className="flex-1">
                  <div className="font-medium">{a.title}</div>
                  {a.description && <div className="text-xs text-muted-foreground mt-0.5">{a.description}</div>}
                </div>
                <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                  {new Date(a.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
