"use client";

import { useState, useEffect } from "react";
import { Users, ChevronRight, Loader2, UserX } from "lucide-react";
import { cn } from "@/lib/utils";
import { getPeople } from "@/lib/api-client";

interface Person {
  name: string;
  interaction_type: string;
  latest_note: string;
  entry_count: number;
  last_seen: string;
  dominant_trust: "positive" | "negative" | "neutral";
}

interface PeopleListProps {
  onSelectPerson: (name: string) => void;
}

const trustColors = {
  positive: { dot: "bg-success", badge: "bg-success/10 text-success", ring: "ring-success/20" },
  negative: { dot: "bg-destructive", badge: "bg-destructive/10 text-destructive", ring: "ring-destructive/20" },
  neutral:  { dot: "bg-muted-foreground", badge: "bg-secondary text-muted-foreground", ring: "ring-border" },
};

const interactionIcons: Record<string, string> = {
  friend: "👥", family: "👨‍👩‍👧", business: "💼", conflict: "⚡",
};

function getRelativeTime(iso: string): string {
  const diffMs    = Date.now() - new Date(iso).getTime();
  const diffMins  = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays  = Math.floor(diffMs / 86400000);
  if (diffMins < 1)  return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function PeopleList({ onSelectPerson }: PeopleListProps) {
  const [people, setPeople]   = useState<Person[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await getPeople();
        setPeople((data.people ?? []) as Person[]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load");
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, []);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading people...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl glass-card p-6 text-center">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  if (people.length === 0) {
    return (
      <div className="rounded-2xl glass-card p-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <UserX className="h-6 w-6 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">No people yet</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Mention someone in a memory and their profile will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-4">
        <Users className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">
          {people.length} {people.length === 1 ? "Person" : "People"} in your network
        </h2>
      </div>

      {people.map((person, index) => {
        const trust = trustColors[person.dominant_trust];
        const icon  = interactionIcons[person.interaction_type] ?? "👤";

        return (
          <button
            key={person.name}
            onClick={() => onSelectPerson(person.name)}
            className={cn(
              "w-full text-left rounded-2xl glass-card p-4 transition-all duration-300",
              "hover:glass-card-hover animate-fade-up ring-1",
              trust.ring
            )}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-xl">
                  {icon}
                </div>
                <span className={cn("absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background", trust.dot)} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground truncate">{person.name}</span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium capitalize", trust.badge)}>
                    {person.dominant_trust}
                  </span>
                  <span className="text-[10px] text-muted-foreground capitalize">{person.interaction_type}</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground line-clamp-1">{person.latest_note}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground/70">
                    {person.entry_count} {person.entry_count === 1 ? "entry" : "entries"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40">·</span>
                  <span className="text-[10px] text-muted-foreground/70">{getRelativeTime(person.last_seen)}</span>
                </div>
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
