import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Clock, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { deleteAppointment, deleteAllAppointments } from "@/lib/agent.functions";

export function AppointmentsTab() {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const delOne = useServerFn(deleteAppointment);
  const delAll = useServerFn(deleteAllAppointments);

  const load = async () => {
    const { data } = await supabase.from("appointments").select("*").order("scheduled_at", { ascending: true }).limit(200);
    setItems(data ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("appointments")
      .on("postgres_changes", { event: "*", schema: "public", table: "appointments" }, load).subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Supprimer ce rendez-vous ?")) return;
    setBusy(id);
    try { await delOne({ data: { id } }); toast.success("Rendez-vous supprimé"); }
    catch (e: any) { toast.error(e?.message ?? "Erreur"); }
    finally { setBusy(null); }
  };

  const handleDeleteAll = async () => {
    if (!confirm("Supprimer TOUS les rendez-vous ? Cette action est irréversible.")) return;
    setBusy("all");
    try { await delAll(); toast.success("Tous les rendez-vous ont été supprimés"); }
    catch (e: any) { toast.error(e?.message ?? "Erreur"); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Rendez-vous ({items.length})</h3>
        {items.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleDeleteAll} disabled={busy === "all"} className="text-destructive border-destructive/40 hover:bg-destructive/10">
            <Trash2 className="w-4 h-4 mr-2" /> Tout supprimer
          </Button>
        )}
      </div>
      <div className="glass rounded-2xl p-6">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-12 text-center">Aucun rendez-vous pour l'instant.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {items.map((a) => (
              <div key={a.id} className="glass rounded-xl p-4 hover:shadow-glow transition group">
                <div className="flex items-start justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-gradient-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
                      <Calendar className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{a.client_name || a.client_email}</div>
                      <div className="text-xs text-muted-foreground truncate">{a.client_email}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant="outline" className={
                      a.status === "confirmed" ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
                      : a.status === "pending" ? "border-amber-500/40 text-amber-400 bg-amber-500/10"
                      : "border-destructive/40 text-destructive bg-destructive/10"
                    }>
                      {a.status === "confirmed" ? "Confirmé" : a.status === "pending" ? "En attente" : "Annulé"}
                    </Badge>
                    <Button size="icon" variant="ghost" disabled={busy === a.id} onClick={() => handleDelete(a.id)} className="h-7 w-7 opacity-60 hover:opacity-100 hover:text-destructive">
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                  <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />
                    {new Date(a.scheduled_at).toLocaleString("fr-FR", { dateStyle: "full", timeStyle: "short", timeZone: "Indian/Reunion" })}
                  </span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {a.duration_minutes}min</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
