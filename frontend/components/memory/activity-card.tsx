"use client";

import { useState, useEffect } from "react";
import { Activity, Clock, Users, Calendar, Loader2, Sparkles } from "lucide-react";
import { getActivityClusters } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const categoryStyles: Record<string, { bg: string; text: string; dot: string }> = {
  WORK: { bg: "bg-blue-500/10", text: "text-blue-400", dot: "bg-blue-500" },
  HEALTH: { bg: "bg-emerald-500/10", text: "text-emerald-400", dot: "bg-emerald-500" },
  LEARNING: { bg: "bg-purple-500/10", text: "text-purple-400", dot: "bg-purple-500" },
  SOCIAL: { bg: "bg-pink-500/10", text: "text-pink-400", dot: "bg-pink-500" },
  FINANCE: { bg: "bg-amber-500/10", text: "text-amber-400", dot: "bg-amber-500" },
  PROJECT: { bg: "bg-indigo-500/10", text: "text-indigo-400", dot: "bg-indigo-500" },
  PERSONAL: { bg: "bg-teal-500/10", text: "text-teal-400", dot: "bg-teal-500" },
  SYSTEM: { bg: "bg-slate-500/10", text: "text-slate-400", dot: "bg-slate-500" },
};

export function ActivityCard() {
  const [activities, setActivities] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchActivities = async () => {
      try {
        const data = await getActivityClusters(10);
        setActivities(data);
      } catch (err) {
        console.error("Failed to fetch activities:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchActivities();
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center p-8 glass-card rounded-2xl">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!activities.length) {
    return (
      <div className="rounded-2xl glass-card p-6 text-center space-y-2">
        <Activity className="h-8 w-8 mx-auto text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No activities clustered yet.</p>
        <p className="text-xs text-muted-foreground/60">Activities will form automatically as observations accumulate.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl glass-card p-4 space-y-4">
      {/* Title */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Recent Activities</h3>
        </div>
        <span className="text-[10px] text-muted-foreground font-medium bg-secondary/50 px-2 py-0.5 rounded-full">
          {activities.length} Clusters
        </span>
      </div>

      {/* List */}
      <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 scrollbar-thin">
        {activities.map((activity) => {
          const styles = categoryStyles[activity.category?.toUpperCase()] || {
            bg: "bg-slate-500/10",
            text: "text-slate-400",
            dot: "bg-slate-400",
          };
          const dateStr = new Date(activity.started_at).toLocaleDateString("en", {
            month: "short",
            day: "numeric",
          });
          const timeStr = new Date(activity.started_at).toLocaleTimeString("en", {
            hour: "numeric",
            minute: "2-digit",
          });

          return (
            <div
              key={activity.id}
              className="group rounded-xl bg-secondary/20 hover:bg-secondary/35 border border-border/20 p-3 transition-all duration-200"
            >
              {/* Top Row: Category and Time */}
              <div className="flex items-center justify-between mb-1.5">
                <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider", styles.bg, styles.text)}>
                  {activity.category || "General"}
                </span>
                <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Calendar className="h-3 w-3" />
                  <span>{dateStr}</span>
                  <span className="text-muted-foreground/40">•</span>
                  <Clock className="h-3 w-3" />
                  <span>{timeStr}</span>
                </div>
              </div>

              {/* Title / Summary */}
              <p className="text-sm font-medium text-foreground leading-snug group-hover:text-primary transition-colors">
                {activity.title}
              </p>

              {/* Bottom Metadata */}
              <div className="flex items-center justify-between mt-2 pt-1.5 border-t border-border/10 text-[10px] text-muted-foreground">
                {/* Entities */}
                <div className="flex items-center gap-1">
                  {activity.related_entities?.length > 0 && (
                    <>
                      <Users className="h-3 w-3 text-muted-foreground/60" />
                      <span className="truncate max-w-[150px]">
                        {activity.related_entities.join(", ")}
                      </span>
                    </>
                  )}
                </div>

                {/* Score badge */}
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-0.5 text-warning">
                    <Sparkles className="h-2.5 w-2.5 fill-current" />
                    <span>{(activity.importance_score * 10).toFixed(0)}</span>
                  </span>
                  <span className="text-muted-foreground/35">|</span>
                  <span className="text-[9px] text-muted-foreground/75">
                    {Math.round(activity.signal_quality * 100)}% signal
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
