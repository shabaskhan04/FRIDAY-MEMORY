"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { isSupabaseConfigured, createClient } from "@/lib/supabase";
import { Header } from "@/components/memory/header";
import { GreetingCard } from "@/components/memory/greeting-card";
import { StatsRow } from "@/components/memory/stats-row";
import { MemoryInput } from "@/components/memory/memory-input";
import { StatusToast } from "@/components/memory/status-toast";
import { LedgerList } from "@/components/memory/ledger-list";
import { BottomNav } from "@/components/memory/bottom-nav";
import { QuickActions } from "@/components/memory/quick-actions";

interface RawLedger {
  id: string;
  created_at: string;
  content: string;
}

interface StatusMessage {
  type: "success" | "error" | "warning";
  text: string;
  temporalCount?: number;
  entityCount?: number;
}

export default function CognitiveRouter() {
  const [ledgers, setLedgers] = useState<RawLedger[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [activeTab, setActiveTab] = useState<"home" | "memory" | "insights">("home");
  
  const isConfigured = useMemo(() => isSupabaseConfigured(), []);

  const fetchLedgers = useCallback(async (): Promise<void> => {
    if (!isConfigured) return;
    
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("raw_ledgers")
        .select("id, created_at, content")
        .order("created_at", { ascending: false })
        .limit(5);
      if (!error && data) setLedgers(data as RawLedger[]);
    } catch {
      // Supabase not configured, ignore
    }
  }, [isConfigured]);

  useEffect(() => {
    void fetchLedgers();
  }, [fetchLedgers]);

  const handleSubmit = async (content: string): Promise<void> => {
    if (!isConfigured) {
      setStatus({
        type: "warning",
        text: "Connect Supabase from Settings to enable memory storage.",
      });
      return;
    }
    
    setIsLoading(true);
    setStatus(null);

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        temporal_count?: number;
        entity_count?: number;
      };

      if (!res.ok) throw new Error(data.error ?? "Ingest failed.");

      setStatus({
        type: "success",
        text: "Memory processed and stored",
        temporalCount: data.temporal_count ?? 0,
        entityCount: data.entity_count ?? 0,
      });
      
      await fetchLedgers();
    } catch (err: unknown) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "An unknown error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickAction = (action: string) => {
    // Handle quick actions - could pre-fill prompts or navigate
    console.log("Quick action:", action);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-purple-600/5 blur-[100px]" />
      </div>
      
      <Header isOnline={isConfigured} />
      
      <main className="mx-auto max-w-lg px-4 pt-4">
        {/* Greeting Card */}
        <GreetingCard 
          isConfigured={isConfigured} 
          isRecording={isRecording}
          isProcessing={isLoading}
        />
        
        {/* Stats Row */}
        <StatsRow 
          totalEntries={ledgers.length}
          isProcessing={isLoading}
        />
        
        {/* Memory Input */}
        <div className="mb-6">
          <MemoryInput 
            onSubmit={handleSubmit} 
            isLoading={isLoading}
            onRecordingChange={setIsRecording}
          />
        </div>
        
        {/* Quick Actions */}
        <QuickActions onAction={handleQuickAction} />
        
        {/* Memory History */}
        <section className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Recent Memories</h2>
            {ledgers.length > 0 && (
              <span className="text-xs text-muted-foreground">See all</span>
            )}
          </div>
          <LedgerList ledgers={ledgers} />
        </section>
      </main>
      
      {/* Bottom Navigation */}
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
      
      {/* Status toast */}
      {status && (
        <StatusToast 
          status={status} 
          onDismiss={() => setStatus(null)} 
        />
      )}
    </div>
  );
}
