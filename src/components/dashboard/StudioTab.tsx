import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

type Conn = { id: string; endpoint_url: string; enabled: boolean; sent_count: number; last_sent_at: string | null };

export function StudioTab() {
  const [conn, setConn] = useState<Conn | null>(null);
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("studio_connections")
      .select("id, endpoint_url, enabled, sent_count, last_sent_at")
      .maybeSingle();
    setConn(data as Conn | null);
    if (data) setUrl(data.endpoint_url);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel("studio-conn")
      .on("postgres_changes", { event: "*", schema: "public", table: "studio_connections" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const save = async () => {
    if (!/^https:\/\/.+/i.test(url.trim())) return toast.error("L'adresse doit commencer par https://");
    if (!conn && !key.trim()) return toast.error("Renseignez votre clé API");
    setSaving(true);
    const { data: u } = await supabase.auth.getUser();
    const payload: any = { endpoint_url: url.trim(), updated_at: new Date().toISOString() };
    if (key.trim()) payload.api_key = key.trim();
    const { error } = conn
      ? await supabase.from("studio_connections").update(payload).eq("id", conn.id)
      : await supabase.from("studio_connections").insert({ ...payload, user_id: u.user!.id, enabled: true });
    setSaving(false);
    if (error) return toast.error(error.message);
    setKey(""); toast.success("Studio connecté"); load();
  };

  const toggle = async (v: boolean) => {
    if (!conn) return;
    setConn({ ...conn, enabled: v });
    await supabase.from("studio_connections").update({ enabled: v }).eq("id", conn.id);
  };

  const disconnect = async () => {
    if (!conn || !confirm("Déconnecter le Studio ?")) return;
    await supabase.from("studio_connections").delete().eq("id", conn.id);
    setConn(null); setUrl(""); setKey(""); toast.success("Studio déconnecté");
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="text-xs text-muted-foreground">Événements envoyés</div>
          <div className="text-3xl font-semibold mt-1">{conn?.sent_count ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-5">
          <div className="text-xs text-muted-foreground">Dernier envoi</div>
          <div className="text-lg font-medium mt-2">
            {conn?.last_sent_at ? new Date(conn.last_sent_at).toLocaleString("fr-FR", { timeZone: "Indian/Reunion" }) : "—"}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-6 space-y-5">
        <div className="space-y-2">
          <Label htmlFor="studio-url">Adresse d'envoi du Studio</Label>
          <Input id="studio-url" placeholder="https://mon-studio.com/webhook" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="studio-key">Clé API</Label>
          <Input id="studio-key" type="password" autoComplete="off"
            placeholder={conn ? "•••••••• (laisser vide pour conserver)" : "Votre clé API"}
            value={key} onChange={(e) => setKey(e.target.value)} />
        </div>
        {conn && (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-medium">Envoi en direct</div>
              <div className="text-xs text-muted-foreground">{conn.enabled ? "Actif" : "En pause"}</div>
            </div>
            <Switch checked={conn.enabled} onCheckedChange={toggle} />
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={save} disabled={saving} className="rounded-xl">{conn ? "Enregistrer" : "Connecter le Studio"}</Button>
          {conn && <Button variant="outline" onClick={disconnect} className="rounded-xl">Déconnecter</Button>}
        </div>
      </div>
    </div>
  );
}
