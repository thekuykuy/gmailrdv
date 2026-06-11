import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Mail, Calendar, Brain, Zap, ArrowRight, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Meeting Agent — Agent IA autonome pour vos rendez-vous Gmail" },
      { name: "description", content: "Un Agent IA qui lit vos emails Gmail, vérifie votre Google Calendar et répond automatiquement à vos clients pour planifier les rendez-vous." },
      { property: "og:title", content: "Meeting Agent — Agent IA autonome pour vos rendez-vous" },
      { property: "og:description", content: "L'IA qui transforme votre boîte mail en assistant de planification autonome." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen relative overflow-hidden">
      <div className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="absolute top-[-200px] left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-gradient-primary opacity-20 blur-[150px] rounded-full pointer-events-none" />

      <header className="relative z-10 max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-gradient-primary flex items-center justify-center shadow-glow">
            <Sparkles className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="text-lg font-bold text-gradient">Meeting Agent</span>
        </div>
        <div className="flex gap-3">
          <Link to="/auth"><Button variant="ghost">Connexion</Button></Link>
          <Link to="/auth"><Button className="bg-gradient-primary text-primary-foreground shadow-glow">Commencer</Button></Link>
        </div>
      </header>

      <section className="relative z-10 max-w-5xl mx-auto px-6 pt-20 pb-32 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full glass text-xs font-mono text-primary mb-8">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse-glow" />
          AGENT IA AUTONOME · TEMPS RÉEL
        </div>
        <h1 className="text-5xl md:text-7xl font-bold leading-[1.05] tracking-tight mb-6">
          Votre agenda,<br />
          <span className="text-gradient">piloté par l'IA.</span>
        </h1>
        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10">
          Connectez Gmail et Google Calendar. L'Agent IA détecte les demandes de rendez-vous,
          vérifie vos disponibilités, et répond à vos clients de manière intelligente et autonome.
        </p>
        <div className="flex flex-wrap gap-4 justify-center">
          <Link to="/auth">
            <Button size="lg" className="bg-gradient-primary text-primary-foreground shadow-glow-strong font-semibold text-base h-12 px-8">
              Lancer mon agent <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
        </div>
      </section>

      <section className="relative z-10 max-w-6xl mx-auto px-6 pb-32">
        <div className="grid md:grid-cols-3 gap-6">
          {[
            { icon: Mail, title: "Détection automatique", desc: "L'IA scanne en continu votre boîte Gmail et identifie les demandes de rendez-vous." },
            { icon: Calendar, title: "Vérification temps réel", desc: "Croise instantanément votre Google Calendar pour confirmer ou proposer une alternative." },
            { icon: Brain, title: "Conversation intelligente", desc: "Pose les bonnes questions, propose les meilleurs créneaux, confirme et planifie." },
          ].map((f) => (
            <div key={f.title} className="glass rounded-2xl p-6 hover:shadow-glow transition-all duration-500">
              <div className="w-12 h-12 rounded-xl bg-gradient-primary/20 border border-primary/30 flex items-center justify-center mb-4">
                <f.icon className="w-5 h-5 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative z-10 max-w-4xl mx-auto px-6 pb-32">
        <div className="glass-strong rounded-3xl p-10 text-center shadow-glow">
          <Zap className="w-10 h-10 text-primary mx-auto mb-4" />
          <h2 className="text-3xl font-bold mb-3">Prêt à libérer votre temps ?</h2>
          <p className="text-muted-foreground mb-6">Inscription en 30 secondes · Aucune carte requise</p>
          <Link to="/auth">
            <Button size="lg" className="bg-gradient-primary text-primary-foreground shadow-glow font-semibold">
              Activer l'Agent IA <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </Link>
          <div className="flex flex-wrap gap-6 justify-center mt-8 text-sm text-muted-foreground">
            {["Gmail OAuth sécurisé", "Google Calendar natif", "Réponses 100% autonomes"].map((t) => (
              <div key={t} className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-primary" />{t}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border py-8 text-center text-xs text-muted-foreground">
        Meeting Agent · IA autonome pour la planification de rendez-vous
      </footer>
    </div>
  );
}
