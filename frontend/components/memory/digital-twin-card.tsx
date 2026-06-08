"use client";

import { useState, useEffect } from "react";
import { Cpu, RefreshCw, Trophy, FolderGit, ShieldAlert, Zap, Loader2 } from "lucide-react";
import { getDigitalTwinProfile, rebuildDigitalTwin } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

function renderSummaryContent(summary: string) {
  if (!summary) {
    return <p className="text-sm text-muted-foreground leading-relaxed italic">"Cognitive profile summary processing..."</p>;
  }

  let cleaned = summary.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }

  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null) {
      throw new Error("Not a JSON object");
    }

    return (
      <div className="space-y-3 text-xs text-muted-foreground leading-relaxed">
        {Object.entries(parsed).map(([key, value]) => {
          const formattedKey = key
            .split(/[_-]/)
            .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
            .join(" ");

          if (typeof value === "object" && value !== null) {
            return (
              <div key={key} className="space-y-1">
                <span className="font-semibold text-foreground text-[11px] uppercase tracking-wider block">{formattedKey}</span>
                <div className="pl-3.5 space-y-1.5 border-l border-primary/20">
                  {Object.entries(value).map(([subKey, subValue]) => {
                    const formattedSubKey = subKey
                      .split(/[_-]/)
                      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
                      .join(" ");
                    return (
                      <div key={subKey} className="flex justify-between items-start gap-4">
                        <span className="text-muted-foreground/80">{formattedSubKey}:</span>
                        <span className="font-medium text-foreground text-right">
                          {Array.isArray(subValue) ? subValue.join(", ") : String(subValue)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }

          return (
            <div key={key} className="flex justify-between items-start gap-4">
              <span className="font-semibold text-foreground">{formattedKey}:</span>
              <span className="font-medium text-muted-foreground text-right">
                {Array.isArray(value) ? value.join(", ") : String(value)}
              </span>
            </div>
          );
        })}
      </div>
    );
  } catch (e) {
    return <p className="text-sm text-muted-foreground leading-relaxed italic">"{summary}"</p>;
  }
}

export function DigitalTwinCard() {
  const [profile, setProfile] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRebuilding, setIsRebuilding] = useState(false);

  const fetchProfile = async () => {
    try {
      const data = await getDigitalTwinProfile();
      setProfile(data);
    } catch (err) {
      console.error("Failed to fetch digital twin profile:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  const handleRebuild = async () => {
    setIsRebuilding(true);
    try {
      const model = await rebuildDigitalTwin();
      setProfile(model);
    } catch (err) {
      console.error("Rebuild failed:", err);
    } finally {
      setIsRebuilding(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center p-8 glass-card rounded-2xl">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="rounded-2xl glass-card p-6 text-center">
        <Cpu className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
        <p className="text-sm text-muted-foreground mb-4">No Digital Twin profile has been generated yet.</p>
        <Button onClick={handleRebuild} disabled={isRebuilding} size="sm">
          {isRebuilding && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
          Generate Twin
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl glass-card p-5 relative overflow-hidden space-y-4">
      {/* Background radial gradient decoration */}
      <div className="absolute inset-0 bg-gradient-to-tr from-purple-500/5 via-transparent to-primary/5 pointer-events-none" />

      {/* Header */}
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-primary" />
          <h3 className="text-base font-semibold text-foreground">AI Digital Twin</h3>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRebuild}
          disabled={isRebuilding}
          className="h-8 px-2 text-xs"
        >
          <RefreshCw className={`h-3 w-3 mr-1 ${isRebuilding ? "animate-spin" : ""}`} />
          Rebuild
        </Button>
      </div>

      {/* Summary */}
      <div className="border-l-2 border-primary/30 pl-3 py-1 relative z-10">
        {renderSummaryContent(profile.summary)}
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-2 text-xs relative z-10">
        <div className="rounded-xl bg-secondary/35 p-2.5 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-warning" />
          <div>
            <p className="text-muted-foreground text-[10px]">Risk Profile</p>
            <p className="font-bold text-foreground capitalize">{profile.risk_profile?.toLowerCase() || "Moderate"}</p>
          </div>
        </div>
        <div className="rounded-xl bg-secondary/35 p-2.5 flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <div>
            <p className="text-muted-foreground text-[10px]">Productivity Peak</p>
            <p className="font-bold text-foreground capitalize">{profile.productivity_peak || "Unknown"}</p>
          </div>
        </div>
      </div>

      {/* Lists */}
      <div className="space-y-3 relative z-10 pt-1">
        {profile.top_goals?.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <Trophy className="h-3.5 w-3.5 text-warning/80" />
              <span>Top Focus Goals</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {profile.top_goals.map((g: string, idx: number) => (
                <Badge key={idx} variant="outline" className="text-[10px] bg-secondary/20">
                  {g}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {profile.top_projects?.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <FolderGit className="h-3.5 w-3.5 text-primary/80" />
              <span>Key Projects</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {profile.top_projects.map((p: string, idx: number) => (
                <Badge key={idx} variant="outline" className="text-[10px] bg-secondary/20">
                  {p}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="text-[10px] text-muted-foreground/60 text-right pt-2 border-t border-border/40">
        Version {profile.version} • Rebuilt {profile.last_rebuilt_at ? new Date(profile.last_rebuilt_at).toLocaleString() : "just now"}
      </div>
    </div>
  );
}
