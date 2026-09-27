import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Plug, CheckCircle2, Power } from "lucide-react";
import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar, type DashboardTab } from "@/components/dashboard/AppSidebar";
import { OverviewTab } from "@/components/dashboard/OverviewTab";
import { ActivityTab } from "@/components/dashboard/ActivityTab";
import { ConversationsTab } from "@/components/dashboard/ConversationsTab";
import { AppointmentsTab } from "@/components/dashboard/AppointmentsTab";
import { SettingsTab } from "@/components/dashboard/SettingsTab";
import { UsageTab } from "@/components/dashboard/UsageTab";
import { StudioTab } from "@/components/dashboard/StudioTab";
import { useServerFn } from "@tanstack/react-start";
import { runAgentNow, disconnectGoogle } from "@/lib/agent.functions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Tableau de bord · Meeting Agent" }] }),
});

const TITLES: Record<DashboardTab, string> = {
  overview: "Dashboard",
  activity: "Activité",
  conversations: "Conversations",
  appointments: "Calendrier",
  usage: "Crédits IA",
  studio: "Connexion Studio",
  settings: "Paramètres",
};

function Dashboard() {
  const navigate = useNavigate();
  const [userEmail, setUserEmail] = useState<string>("");
  const [googleConn, setGoogleConn] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const [tab, setTab] = useState<DashboardTab>("overview");
  const runFn = useServerFn(runAgentNow);
  const disconnectFn = useServerFn(disconnectGoogle);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("google") === "connected") {
      toast.success("Compte Google connecté !");
      url.searchParams.delete("google"); window.history.replaceState({}, "", url.toString());
    }
    if (url.searchParams.get("google_error")) {
      toast.error("Erreur Google : " + url.searchParams.get("google_error"));
      url.searchParams.delete("google_error"); window.history.replaceState({}, "", url.toString());
    }
  }, []);

  const loadConn = async () => {
    const { data } = await supabase.from("google_connections").select("*").maybeSingle();
    setGoogleConn(data);
  };

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? ""));
    loadConn();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); navigate({ to: "/auth" }); };
  const connectGoogle = async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) return;
    window.location.href = `/api/google/connect?uid=${data.user.id}`;
  };
  const runNow = async () => {
    if (!googleConn) return toast.error("Connectez d'abord votre compte Google.");
    setRunning(true);
    try {
      const res = await runFn();
      toast.success(`Analyse terminée — ${(res as any).processed ?? 0} email(s) traité(s).`);
    } catch (e: any) { toast.error(e?.message ?? "Erreur"); } finally { setRunning(false); }
  };
  const disconnect = async () => {
    if (!confirm("Déconnecter votre compte Google ?")) return;
    await disconnectFn(); toast.success("Compte Google déconnecté"); loadConn();
  };

  return (
    <SidebarProvider defaultOpen>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar active={tab} onSelect={setTab} userEmail={userEmail} onSignOut={signOut} />
        <SidebarInset className="flex-1">
          <header className="h-14 border-b border-border flex items-center gap-3 px-4 sticky top-0 z-20 bg-background/80 backdrop-blur">
            <SidebarTrigger />
            <h1 className="text-base font-semibold">{TITLES[tab]}</h1>
            <div className="ml-auto flex items-center gap-2">
              {googleConn ? (
                <>
                  <Badge variant="outline" className="border-success/40 text-success bg-success/10 font-mono text-[10px] hidden md:inline-flex">
                    <CheckCircle2 className="w-3 h-3 mr-1" /> {googleConn.google_email}
                  </Badge>
                  <Button size="sm" onClick={runNow} disabled={running} variant="outline" className="rounded-xl">
                    <RefreshCw className={`w-4 h-4 mr-2 ${running ? "animate-spin" : ""}`} />
                    {running ? "Sync..." : "Sync maintenant"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={disconnect} title="Déconnecter Google">
                    <Power className="w-4 h-4" />
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={connectGoogle} className="bg-foreground text-background hover:bg-foreground/90 rounded-xl">
                  <Plug className="w-4 h-4 mr-2" /> Connecter Gmail + Calendar
                </Button>
              )}
            </div>
          </header>

          <main className="p-6 md:p-8 max-w-[1400px] w-full mx-auto">
            {tab === "overview" && (
              <div className="mb-6 flex items-center gap-2 text-sm text-muted-foreground">
                <span className={`w-2 h-2 rounded-full ${googleConn ? "bg-warning" : "bg-muted"} ${googleConn ? "animate-pulse" : ""}`} />
                {googleConn ? <>Agent actif · Gmail connecté ({googleConn.google_email})</> : <>En attente — connectez Gmail / Calendar</>}
              </div>
            )}
            {tab === "overview" && <OverviewTab />}
            {tab === "activity" && <ActivityTab />}
            {tab === "conversations" && <ConversationsTab />}
            {tab === "appointments" && <AppointmentsTab />}
            {tab === "usage" && <UsageTab />}
            {tab === "studio" && <StudioTab />}
            {tab === "settings" && <SettingsTab />}
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}

// Suppress unused import warnings for icons used in older layout
