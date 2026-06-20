import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { updateSettings, resetAgentData } from "@/lib/agent.functions";
import { AGENT_AI_MODELS, DEFAULT_AGENT_AI_MODEL } from "@/lib/ai-models";
import { Save, AlertTriangle, RotateCcw, Timer } from "lucide-react";

const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export function SettingsTab() {
  const [s, setS] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const save = useServerFn(updateSettings);
  const reset = useServerFn(resetAgentData);

  useEffect(() => {
    supabase.from("agent_settings").select("*").maybeSingle().then(({ data }) => setS(data));
  }, []);

  if (!s) return <div className="glass rounded-2xl p-8 text-center text-muted-foreground">Chargement...</div>;

  const update = (patch: any) => setS({ ...s, ...patch });
  const toggleDay = (d: number) => {
    const cur = s.working_days as number[];
    update({ working_days: cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort() });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await save({
        data: {
          agent_enabled: s.agent_enabled,
          auto_send: s.auto_send,
          timezone: s.timezone,
          working_days: s.working_days,
          working_hours_start: s.working_hours_start,
          working_hours_end: s.working_hours_end,
          appointment_duration_minutes: s.appointment_duration_minutes,
          buffer_minutes: s.buffer_minutes,
          language: s.language,
          signature: s.signature ?? "",
          agent_persona: s.agent_persona ?? "",
          calendar_id: s.calendar_id,
          ai_model: s.ai_model ?? DEFAULT_AGENT_AI_MODEL,
          cron_interval_minutes: s.cron_interval_minutes ?? 5,
        },
      });
      toast.success("Paramètres enregistrés");
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm("RÉINITIALISER toutes les données de l'agent ? (conversations, RDV, activités, crédits IA, événements Google liés). Cette action est IRRÉVERSIBLE.")) return;
    if (!confirm("Confirmation finale : vraiment tout effacer ?")) return;
    setResetting(true);
    try { await reset(); toast.success("Données de l'agent réinitialisées."); }
    catch (e: any) { toast.error(e?.message ?? "Erreur"); }
    finally { setResetting(false); }
  };

  return (
    <div className="space-y-6">
      <div className="glass rounded-2xl p-6 space-y-5">
        <h3 className="font-semibold text-lg">État de l'agent</h3>
        <div className="flex items-center justify-between">
          <div>
            <Label>Agent activé</Label>
            <p className="text-xs text-muted-foreground">Quand désactivé, aucun email n'est traité.</p>
          </div>
          <Switch checked={s.agent_enabled} onCheckedChange={(v) => update({ agent_enabled: v })} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label>Envoi automatique des réponses</Label>
            <p className="text-xs text-muted-foreground">L'agent envoie sans validation préalable.</p>
          </div>
          <Switch checked={s.auto_send} onCheckedChange={(v) => update({ auto_send: v })} />
        </div>
      </div>

      <div className="glass rounded-2xl p-6 space-y-5">
        <h3 className="font-semibold text-lg flex items-center gap-2"><Timer className="w-4 h-4 text-primary" /> Planification (Cron)</h3>
        <div>
          <Label>Fréquence d'analyse Gmail (minutes)</Label>
          <p className="text-xs text-muted-foreground mb-2">Intervalle entre deux exécutions automatiques de l'agent (1 à 60 min).</p>
          <Input
            type="number" min={1} max={60}
            value={s.cron_interval_minutes ?? 5}
            onChange={(e) => update({ cron_interval_minutes: Math.max(1, Math.min(60, Number(e.target.value) || 5)) })}
          />
          <p className="text-[11px] text-muted-foreground mt-1 font-mono">Planning actuel : */{s.cron_interval_minutes ?? 5} * * * *</p>
        </div>
      </div>

      <div className="glass rounded-2xl p-6 space-y-5">
        <h3 className="font-semibold text-lg">Disponibilités</h3>
        <div>
          <Label className="mb-2 block">Jours travaillés</Label>
          <div className="flex gap-2 flex-wrap">
            {DAYS.map((d, i) => (
              <button key={i} onClick={() => toggleDay(i)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition ${s.working_days.includes(i) ? "bg-gradient-primary text-primary-foreground border-transparent shadow-glow" : "border-border text-muted-foreground hover:border-primary/40"}`}>
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Début journée</Label><Input type="time" value={s.working_hours_start} onChange={(e) => update({ working_hours_start: e.target.value })} /></div>
          <div><Label>Fin journée</Label><Input type="time" value={s.working_hours_end} onChange={(e) => update({ working_hours_end: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Durée par défaut (min)</Label><Input type="number" min={10} max={480} value={s.appointment_duration_minutes} onChange={(e) => update({ appointment_duration_minutes: Number(e.target.value) })} /></div>
          <div><Label>Marge tampon (min)</Label><Input type="number" min={0} max={120} value={s.buffer_minutes} onChange={(e) => update({ buffer_minutes: Number(e.target.value) })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Fuseau horaire</Label><Input value={s.timezone} onChange={(e) => update({ timezone: e.target.value })} placeholder="Indian/Reunion" /></div>
          <div><Label>Langue</Label><Input value={s.language} onChange={(e) => update({ language: e.target.value })} placeholder="fr" maxLength={5} /></div>
        </div>
      </div>

      <div className="glass rounded-2xl p-6 space-y-5">
        <h3 className="font-semibold text-lg">Personnalité de l'agent</h3>
        <div>
          <Label>Modèle IA</Label>
          <Select value={s.ai_model ?? DEFAULT_AGENT_AI_MODEL} onValueChange={(v) => update({ ai_model: v })}>
            <SelectTrigger><SelectValue placeholder="Choisir un modèle" /></SelectTrigger>
            <SelectContent>
              {AGENT_AI_MODELS.map((model) => (<SelectItem key={model.value} value={model.value}>{model.label}</SelectItem>))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Persona / Instructions</Label>
          <Textarea rows={4} value={s.agent_persona ?? ""} onChange={(e) => update({ agent_persona: e.target.value })} placeholder="Tu es un assistant professionnel..." />
        </div>
        <div>
          <Label>Signature email</Label>
          <Textarea rows={3} value={s.signature ?? ""} onChange={(e) => update({ signature: e.target.value })} placeholder={"Cordialement,\nVotre Agent IA"} />
        </div>
      </div>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving} className="bg-gradient-primary text-primary-foreground shadow-glow">
          <Save className="w-4 h-4 mr-2" /> {saving ? "Enregistrement..." : "Enregistrer"}
        </Button>
      </div>

      <div className="rounded-2xl p-6 border border-destructive/40 bg-destructive/5 space-y-3">
        <h3 className="font-semibold text-lg flex items-center gap-2 text-destructive"><AlertTriangle className="w-4 h-4" /> Zone dangereuse</h3>
        <p className="text-sm text-muted-foreground">
          Réinitialise toutes les données traitées par l'Agent : conversations, messages, rendez-vous (et leurs événements Google Calendar liés), journal d'activité, historique des crédits IA. Les paramètres et la connexion Gmail sont préservés.
        </p>
        <Button variant="outline" onClick={handleReset} disabled={resetting} className="border-destructive/50 text-destructive hover:bg-destructive/10">
          <RotateCcw className="w-4 h-4 mr-2" /> {resetting ? "Réinitialisation..." : "Réinitialiser les données de l'agent"}
        </Button>
      </div>
    </div>
  );
}
