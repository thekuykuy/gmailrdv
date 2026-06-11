import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { MessagesSquare, Mail, Send } from "lucide-react";

const STATUS: Record<string, { label: string; cls: string }> = {
  analyzing: { label: "Analyse", cls: "border-amber-500/40 text-amber-400 bg-amber-500/10" },
  awaiting_client: { label: "En attente client", cls: "border-cyan-500/40 text-cyan-400 bg-cyan-500/10" },
  confirmed: { label: "Confirmé", cls: "border-emerald-500/40 text-emerald-400 bg-emerald-500/10" },
  declined: { label: "Refusé", cls: "border-destructive/40 text-destructive bg-destructive/10" },
  not_appointment: { label: "Hors RDV", cls: "border-muted-foreground/40 text-muted-foreground bg-muted/30" },
  error: { label: "Erreur", cls: "border-destructive/40 text-destructive bg-destructive/10" },
};

export function ConversationsTab() {
  const [threads, setThreads] = useState<any[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase.from("email_threads").select("*").order("last_message_at", { ascending: false }).limit(50);
    setThreads(data ?? []);
    if (!active && data?.[0]) setActive(data[0].id);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("threads")
      .on("postgres_changes", { event: "*", schema: "public", table: "email_threads" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    if (!active) return;
    supabase
      .from("email_messages")
      .select("*")
      .eq("thread_id", active)
      .order("sent_at", { ascending: true })
      .then(({ data }) => setMessages(data ?? []));
  }, [active]);

  return (
    <div className="grid lg:grid-cols-[340px_1fr] gap-4">
      <div className="glass rounded-2xl p-3 max-h-[70vh] overflow-y-auto">
        {threads.length === 0 ? (
          <p className="text-sm text-muted-foreground p-6 text-center">Aucune conversation.</p>
        ) : (
          threads.map((t) => (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`w-full text-left p-3 rounded-xl mb-1 transition ${
                active === t.id ? "bg-primary/15 border border-primary/30" : "hover:bg-secondary/50"
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-sm font-medium truncate">{t.client_name || t.client_email}</span>
                <Badge variant="outline" className={`${STATUS[t.status]?.cls ?? ""} text-[10px] px-1.5 py-0`}>
                  {STATUS[t.status]?.label ?? t.status}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground truncate">{t.subject}</div>
            </button>
          ))
        )}
      </div>
      <div className="glass rounded-2xl p-6 min-h-[400px]">
        {!active ? (
          <p className="text-muted-foreground text-sm text-center py-12">Sélectionnez une conversation.</p>
        ) : (
          <div className="space-y-4">
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-3 ${m.direction === "outbound" ? "flex-row-reverse" : ""}`}>
                <div className={`w-8 h-8 rounded-lg shrink-0 flex items-center justify-center ${
                  m.direction === "outbound" ? "bg-gradient-primary text-primary-foreground" : "bg-secondary"
                }`}>
                  {m.direction === "outbound" ? <Send className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" />}
                </div>
                <div className={`max-w-[80%] rounded-2xl p-4 ${
                  m.direction === "outbound" ? "bg-primary/15 border border-primary/30" : "bg-secondary/50 border border-border"
                }`}>
                  <div className="text-xs text-muted-foreground mb-1 font-mono">
                    {m.direction === "outbound" ? "Agent IA" : m.from_email} ·{" "}
                    {new Date(m.sent_at).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                  {m.subject && <div className="text-sm font-medium mb-1">{m.subject}</div>}
                  <pre className="text-sm whitespace-pre-wrap font-sans">{m.body}</pre>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
