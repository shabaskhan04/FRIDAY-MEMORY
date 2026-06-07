"use client";

import { useState, useEffect } from "react";
import {
  ArrowLeft,
  Loader2,
  Clock,
  FileText,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getPersonProfile } from "@/lib/api-client";

interface EntityEntry {
  id: string;
  raw_ledger_id: string;
  interaction_type: string;
  trust_signal: "positive" | "negative" | "neutral";
  ledger_note: string;
  created_at: string;
}

interface RawLedgerEntry {
  id: string;
  content: string;
  created_at: string;
  intent_tag: string;
}

interface TemporalMemory {
  id: string;
  raw_ledger_id: string;
  time_horizon: string;
  estimated_date: string;
  era: string;
  event_summary: string;
}

interface PersonProfileData {
  name: string;
  entries: EntityEntry[];
  raw_ledgers: RawLedgerEntry[];
  temporal_memories: TemporalMemory[];
}

interface PersonProfileProps {
  name: string;
  onBack: () => void;
}

const trustConfig = {
  positive: {
    label: "Positive",
    color: "text-success",
    bg: "bg-success/10",
    icon: TrendingUp,
  },
  negative: {
    label: "Negative",
    color: "text-destructive",
    bg: "bg-destructive/10",
    icon: TrendingDown,
  },
  neutral: {
    label: "Neutral",
    color: "text-muted-foreground",
    bg: "bg-secondary",
    icon: Minus,
  },
};

const interactionEmojis: Record<string, string> = {
  friend: "👥",
  family: "👨‍👩‍👧",
  business: "💼",
  conflict: "⚡",
};

const horizonConfig: Record<string, { label: string; color: string }> = {
  past: { label: "Past", color: "text-muted-foreground" },
  present: { label: "Now", color: "text-primary" },
  future: { label: "Future", color: "text-warning" },
};

export function PersonProfile({ name, onBack }: PersonProfileProps) {
  const [data, setData] = useState<PersonProfileData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<"notes" | "memories">("notes");

  useEffect(() => {
    const fetchProfile = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const json = await getPersonProfile(name) as PersonProfileData;
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setIsLoading(false);
      }
    };
    void fetchProfile();
  }, [name]);

  const getRelativeTime = (iso: string): string => {
    const now = new Date();
    const date = new Date(iso);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  // Compute trust stats
  const trustCounts = data?.entries.reduce(
    (acc, e) => {
      acc[e.trust_signal]++;
      return acc;
    },
    { positive: 0, negative: 0, neutral: 0 }
  ) ?? { positive: 0, negative: 0, neutral: 0 };

  const totalEntries = data?.entries.length ?? 0;
  const dominantTrust =
    trustCounts.positive >= trustCounts.negative &&
    trustCounts.positive >= trustCounts.neutral
      ? "positive"
      : trustCounts.negative >= trustCounts.positive &&
          trustCounts.negative >= trustCounts.neutral
        ? "negative"
        : "neutral";

  const latestInteractionType = data?.entries[0]?.interaction_type ?? "friend";
  const icon = interactionEmojis[latestInteractionType] ?? "👤";
  const trust = trustConfig[dominantTrust];
  const TrustIcon = trust.icon;

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h2 className="text-base font-semibold text-foreground">Person Profile</h2>
      </div>

      {isLoading && (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Loading profile...</p>
        </div>
      )}

      {error && (
        <div className="rounded-2xl glass-card p-6 text-center">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {data && !isLoading && (
        <div className="space-y-4">
          {/* Profile card */}
          <div className="rounded-2xl glass-card p-5 relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-primary/8 via-transparent to-transparent pointer-events-none" />
            <div className="relative flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary text-3xl shrink-0">
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-xl font-bold text-foreground">{data.name}</h1>
                <p className="text-xs text-muted-foreground capitalize mt-0.5">
                  {latestInteractionType}
                </p>
                <div className="flex items-center gap-1.5 mt-2">
                  <span
                    className={cn(
                      "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      trust.bg,
                      trust.color
                    )}
                  >
                    <TrustIcon className="h-3 w-3" />
                    {trust.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {totalEntries} {totalEntries === 1 ? "entry" : "entries"}
                  </span>
                </div>
              </div>
            </div>

            {/* Trust breakdown bar */}
            {totalEntries > 0 && (
              <div className="mt-4">
                <p className="text-[10px] text-muted-foreground mb-1.5">Trust signal breakdown</p>
                <div className="flex h-2 rounded-full overflow-hidden gap-0.5">
                  {trustCounts.positive > 0 && (
                    <div
                      className="bg-success rounded-full transition-all duration-500"
                      style={{ width: `${(trustCounts.positive / totalEntries) * 100}%` }}
                    />
                  )}
                  {trustCounts.neutral > 0 && (
                    <div
                      className="bg-muted-foreground/30 rounded-full transition-all duration-500"
                      style={{ width: `${(trustCounts.neutral / totalEntries) * 100}%` }}
                    />
                  )}
                  {trustCounts.negative > 0 && (
                    <div
                      className="bg-destructive rounded-full transition-all duration-500"
                      style={{ width: `${(trustCounts.negative / totalEntries) * 100}%` }}
                    />
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className="text-[10px] text-success">{trustCounts.positive} positive</span>
                  <span className="text-[10px] text-muted-foreground">{trustCounts.neutral} neutral</span>
                  <span className="text-[10px] text-destructive">{trustCounts.negative} negative</span>
                </div>
              </div>
            )}
          </div>

          {/* Section tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => setActiveSection("notes")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200",
                activeSection === "notes"
                  ? "gradient-purple text-white"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              <FileText className="h-3.5 w-3.5" />
              Notes ({data.entries.length})
            </button>
            <button
              onClick={() => setActiveSection("memories")}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200",
                activeSection === "memories"
                  ? "gradient-purple text-white"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              )}
            >
              <Clock className="h-3.5 w-3.5" />
              Memories ({data.raw_ledgers.length})
            </button>
          </div>

          {/* Notes section */}
          {activeSection === "notes" && (
            <div className="space-y-2">
              {data.entries.length === 0 ? (
                <div className="rounded-2xl glass-card p-6 text-center">
                  <p className="text-sm text-muted-foreground">No notes yet</p>
                </div>
              ) : (
                data.entries.map((entry, index) => {
                  const t = trustConfig[entry.trust_signal];
                  const EntryTrustIcon = t.icon;
                  return (
                    <div
                      key={entry.id}
                      className="rounded-2xl glass-card p-4 animate-fade-up"
                      style={{ animationDelay: `${index * 40}ms` }}
                    >
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <span
                          className={cn(
                            "flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                            t.bg,
                            t.color
                          )}
                        >
                          <EntryTrustIcon className="h-3 w-3" />
                          {entry.trust_signal}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {getRelativeTime(entry.created_at)}
                        </span>
                      </div>
                      <p className="text-sm text-foreground leading-relaxed">
                        {entry.ledger_note}
                      </p>
                      <p className="mt-1 text-[10px] text-muted-foreground capitalize">
                        {entry.interaction_type}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Memories section */}
          {activeSection === "memories" && (
            <div className="space-y-2">
              {/* Raw ledger entries */}
              {data.raw_ledgers.length === 0 ? (
                <div className="rounded-2xl glass-card p-6 text-center">
                  <p className="text-sm text-muted-foreground">No memories linked</p>
                </div>
              ) : (
                data.raw_ledgers.map((ledger, index) => (
                  <div
                    key={ledger.id}
                    className="rounded-2xl glass-card p-4 animate-fade-up"
                    style={{ animationDelay: `${index * 40}ms` }}
                  >
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full capitalize">
                        {ledger.intent_tag}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {getRelativeTime(ledger.created_at)}
                      </span>
                    </div>
                    <p className="text-sm text-foreground leading-relaxed line-clamp-3">
                      {ledger.content}
                    </p>
                    {/* Linked temporal memories */}
                    {data.temporal_memories
                      .filter((tm) => tm.raw_ledger_id === ledger.id)
                      .map((tm) => {
                        const horizon = horizonConfig[tm.time_horizon] ?? horizonConfig.present;
                        return (
                          <div
                            key={tm.id}
                            className="mt-2 rounded-xl bg-secondary/50 p-3"
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <Calendar className="h-3 w-3 text-muted-foreground" />
                              <span className={cn("text-[10px] font-medium", horizon.color)}>
                                {horizon.label}
                              </span>
                              {tm.estimated_date && (
                                <span className="text-[10px] text-muted-foreground">
                                  · {tm.estimated_date}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground">{tm.event_summary}</p>
                          </div>
                        );
                      })}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
