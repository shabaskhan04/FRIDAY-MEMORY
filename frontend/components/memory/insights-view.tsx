"use client";

import { DigitalTwinCard } from "./digital-twin-card";
import { ActivityCard } from "./activity-card";
import { PatternCard } from "./pattern-card";
import { DecisionsPanel } from "./decisions-panel";

interface InsightsViewProps {
  isConfigured: boolean;
}

export function InsightsView({ isConfigured }: InsightsViewProps) {
  if (!isConfigured) {
    return (
      <div className="rounded-2xl glass-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Connect Supabase to see insights</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Intro Header Banner */}
      <div className="rounded-2xl glass-card p-5 relative overflow-hidden bg-gradient-to-r from-primary/10 via-purple-500/5 to-transparent">
        <h2 className="text-lg font-bold text-foreground mb-1">Cognitive Engine Insights</h2>
        <p className="text-xs text-muted-foreground leading-relaxed">
          FRIDAY analyzes your cognitive inputs to form a digital twin, trace daily activities, log critical decisions, and discover causal pathways.
        </p>
      </div>

      {/* Main Responsive Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Left Column */}
        <div className="space-y-5">
          <DigitalTwinCard />
          <DecisionsPanel />
        </div>

        {/* Right Column */}
        <div className="space-y-5">
          <ActivityCard />
          <PatternCard />
        </div>
      </div>
    </div>
  );
}
