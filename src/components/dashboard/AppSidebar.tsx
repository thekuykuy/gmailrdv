import { Bot, LayoutDashboard, Activity, MessagesSquare, CalendarDays, Brain, Settings as SettingsIcon, LogOut } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from "@/components/ui/sidebar";

export type DashboardTab = "overview" | "activity" | "conversations" | "appointments" | "usage" | "settings";

const ITEMS: { id: DashboardTab; title: string; icon: any }[] = [
  { id: "overview", title: "Dashboard", icon: LayoutDashboard },
  { id: "activity", title: "Activité", icon: Activity },
  { id: "conversations", title: "Conversations", icon: MessagesSquare },
  { id: "appointments", title: "Calendrier", icon: CalendarDays },
  { id: "usage", title: "Crédits IA", icon: Brain },
  { id: "settings", title: "Paramètres", icon: SettingsIcon },
];

export function AppSidebar({
  active, onSelect, userEmail, onSignOut,
}: { active: DashboardTab; onSelect: (t: DashboardTab) => void; userEmail: string; onSignOut: () => void }) {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" className="border-r border-border bg-surface">
      <SidebarHeader className="p-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-surface-elevated border border-border flex items-center justify-center shrink-0">
            <Bot className="w-5 h-5 text-foreground" />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="font-semibold leading-tight truncate">Mira</div>
              <div className="text-[10px] font-mono tracking-widest text-muted-foreground">AGENT IA · RDV</div>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="px-2">
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {ITEMS.map((it) => (
                <SidebarMenuItem key={it.id}>
                  <SidebarMenuButton
                    isActive={active === it.id}
                    onClick={() => onSelect(it.id)}
                    tooltip={it.title}
                    className="h-11 rounded-xl data-[active=true]:bg-surface-elevated data-[active=true]:text-foreground hover:bg-surface-elevated/60"
                  >
                    <it.icon className="w-4 h-4" />
                    <span className="text-sm">{it.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onSignOut} tooltip={userEmail} className="h-11 rounded-xl hover:bg-surface-elevated/60">
              <LogOut className="w-4 h-4" />
              <span className="text-xs truncate">{userEmail.split("@")[0]}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
