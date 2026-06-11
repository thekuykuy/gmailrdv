import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Brain, Calendar, Send, CheckCircle2, AlertTriangle } from "lucide-react";

const ICONS: Record<string, any> = {
  email_received: Mail,
  analysis: Brain,
  calendar_check: Calendar,
  reply_sent: Send,
  appointment_created: CheckCircle2,
  error: AlertTriangle,
};
const COLORS: Record<string, string> = {
  email_received: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
  analysis: "text-violet-400 bg-violet-500/10 border-violet-500/30",
  calendar_check: "text-amber-400 bg-amber-500/10 border-amber-500/30",
  reply_sent: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  appointment_created: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
  error: "text-destructive bg-destructive/10 border-destructive/30",
};

export function ActivityTab() {
  const [logs, setLogs] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(100);
    setLogs(data ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("activity")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "activity_logs" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="glass rounded-2xl p-6">
      <h3 className="font-semibold mb-4">Journal d'activité temps réel</h3>
      {logs.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">L'agent n'a encore rien fait. Lancez une analyse pour voir l'activité ici.</p>
      ) : (
        <ol className="relative space-y-3">
          {logs.map((a) => {
            const Icon = ICONS[a.type] ?? Brain;
            const color = COLORS[a.type] ?? "text-primary bg-primary/10 border-primary/30";
            return (
              <li key={a.id} className="flex gap-4 items-start">
                <div className={`w-9 h-9 rounded-lg border ${color} flex items-center justify-center shrink-0`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <h4 className="text-sm font-medium truncate">{a.title}</h4>
                    <span className="text-xs text-muted-foreground font-mono whitespace-nowrap">
                      {new Date(a.created_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                    </span>
                  </div>
                  {a.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{a.description}</p>}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
