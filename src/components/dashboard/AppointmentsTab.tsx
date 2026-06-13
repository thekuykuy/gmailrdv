import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Calendar, Clock, User } from "lucide-react";

export function AppointmentsTab() {
  const [items, setItems] = useState<any[]>([]);

  const load = async () => {
    const { data } = await supabase.from("appointments").select("*").order("scheduled_at", { ascending: true }).limit(100);
    setItems(data ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("appointments")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  return (
    <div className="glass rounded-2xl p-6">
      <h3 className="font-semibold mb-4">Rendez-vous</h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">Aucun rendez-vous pour l'instant.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {items.map((a) => (
            <div key={a.id} className="glass rounded-xl p-4 hover:shadow-glow transition">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-gradient-primary/20 border border-primary/30 flex items-center justify-center">
                    <Calendar className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <div className="font-medium text-sm">{a.client_name || a.client_email}</div>
                    <div className="text-xs text-muted-foreground">{a.client_email}</div>
                  </div>
                </div>
                <Badge variant="outline" className={
                  a.status === "confirmed" ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                  : a.status === "pending" ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                  : "border-destructive/40 text-destructive bg-destructive/10"
                }>
                  {a.status === "confirmed" ? "Confirmé" : a.status === "pending" ? "En attente" : "Annulé"}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />
                  {new Date(a.scheduled_at).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short" })}
                </span>
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {a.duration_minutes}min</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
