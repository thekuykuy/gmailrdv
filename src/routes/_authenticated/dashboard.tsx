import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Sparkles, LayoutDashboard, Activity, MessagesSquare, CalendarDays, Settings as SettingsIcon,
  LogOut, RefreshCw, Plug, CheckCircle2, AlertCircle, Power,
} from "lucide-react";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { ActivityTab } from "@/components/dashboard/ActivityTab";
import { ConversationsTab } from "@/components/dashboard/ConversationsTab";
import { AppointmentsTab } from "@/components/dashboard/AppointmentsTab";
import { SettingsTab } from "@/components/dashboard/SettingsTab";
import { useServerFn } from "@tanstack/react-start";
import { runAgentNow, disconnectGoogle } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Tableau de bord · Meeting Agent" }] }),
});

function Dashboard() {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState<string>("");
  const [googleConn, setGoogleConn] = useState<any>(null);
  const [loadingConn, setLoadingConn] = useState(true);
  const [running, setRunning] = useState(false);
  const runFn = useServerFn(runAgentNow);
  const disconnectFn = useServerFn(disconnectGoogle);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("google") === "connected") {
      toast.success("Compte Google connecté !");
      url.searchParams.delete("google");
      window.history.replaceState({}, "", url.toString());
    }
    if (url.searchParams.get("google_error")) {
      toast.error("Erreur Google : " + url.searchParams.get("google_error"));
      url.searchParams.delete("google_error");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const loadConn = async () => {
    setLoadingConn(true);
    const { data } = await supabase.from("google_connections").select("*").maybeSingle();
    setGoogleConn(data);
    setLoadingConn(false);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ""));
    loadConn();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const connectGoogle = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    window.location.href = `/api/google/connect?uid=${data.user.id}`;
  };

  const runNow = async () => {
    if (!googleConn) {
      toast.error("Connectez d'abord votre compte Google.");
      return;
    }
    setRunning(true);
    try {
      const res = await runFn();
      toast.success(`Analyse terminée — ${(res as any).processed ?? 0} email(s) traité(s).`);
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
    } finally {
      setRunning(false);
    }
  };

  const disconnect = async () => {
    if (!confirm("Déconnecter votre compte Google ?")) return;
    await disconnectFn();
    toast.success("Compte Google déconnecté");
    loadConn();
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="glass-strong border-b border-border sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
              <Sparkles className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-bold text-gradient">Meeting Agent</span>
          </Link>
          <div className="flex items-center gap-3">
            {googleConn ? (
              <Badge variant="outline" className="border-success/40 text-success bg-success/10 font-mono text-xs">
                <CheckCircle2 className="w-3 h-3 mr-1" /> {googleConn.google_email}
              </Badge>
            ) : (
              <Badge variant="outline" className="border-warning/40 text-warning bg-warning/10 font-mono text-xs">
                <AlertCircle className="w-3 h-3 mr-1" /> Google non connecté
              </Badge>
            )}
            <Button size="sm" variant="ghost" onClick={signOut}>
              <LogOut className="w-4 h-4 mr-1.5" /> {userEmail.split("@")[0]}
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl mx-auto w-full px-6 py-8">
        {/* Hero status */}
        <div className="glass-strong rounded-3xl p-6 md:p-8 mb-8 relative overflow-hidden">
          <div className="absolute -top-20 -right-20 w-72 h-72 bg-gradient-primary opacity-20 blur-3xl rounded-full" />
          <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
            <div>
              <div className="flex items-center gap-2 text-xs font-mono text-primary mb-2">
                <span className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
                {googleConn ? "AGENT ACTIF" : "EN ATTENTE DE CONNEXION GOOGLE"}
              </div>
              <h1 className="text-2xl md:text-3xl font-bold mb-1">Bienvenue, <span className="text-gradient">{userEmail.split("@")[0]}</span></h1>
              <p className="text-sm text-muted-foreground">
                {googleConn
                  ? "Votre agent surveille votre boîte Gmail et répond aux clients automatiquement."
                  : "Connectez votre compte Google pour lancer l'agent."}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {googleConn ? (
                <>
                  <Button onClick={runNow} disabled={running} className="bg-gradient-primary text-primary-foreground shadow-glow">
                    <RefreshCw className={`w-4 h-4 mr-2 ${running ? "animate-spin" : ""}`} />
                    {running ? "Analyse..." : "Analyser maintenant"}
                  </Button>
                  <Button variant="outline" onClick={disconnect}>
                    <Power className="w-4 h-4 mr-2" /> Déconnecter Google
                  </Button>
                </>
              ) : (
                <Button onClick={connectGoogle} className="bg-gradient-primary text-primary-foreground shadow-glow">
                  <Plug className="w-4 h-4 mr-2" /> Connecter Gmail + Calendar
                </Button>
              )}
            </div>
          </div>
        </div>

        <Tabs defaultValue="overview" className="space-y-6">
          <TabsList className="glass border border-border h-12 p-1.5">
            <TabsTrigger value="overview" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground gap-2">
              <LayoutDashboard className="w-4 h-4" /> Vue d'ensemble
            </TabsTrigger>
            <TabsTrigger value="activity" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground gap-2">
              <Activity className="w-4 h-4" /> Activité
            </TabsTrigger>
            <TabsTrigger value="conversations" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground gap-2">
              <MessagesSquare className="w-4 h-4" /> Conversations
            </TabsTrigger>
            <TabsTrigger value="appointments" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground gap-2">
              <CalendarDays className="w-4 h-4" /> Rendez-vous
            </TabsTrigger>
            <TabsTrigger value="settings" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground gap-2">
              <SettingsIcon className="w-4 h-4" /> Paramètres
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview"><OverviewTab /></TabsContent>
          <TabsContent value="activity"><ActivityTab /></TabsContent>
          <TabsContent value="conversations"><ConversationsTab /></TabsContent>
          <TabsContent value="appointments"><AppointmentsTab /></TabsContent>
          <TabsContent value="settings"><SettingsTab /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
