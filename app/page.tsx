"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { isSupabaseConfigured, createClient } from "@/lib/supabase";
import { Header } from "@/components/memory/header";
import { MemoryInput } from "@/components/memory/memory-input";
import { StatusToast } from "@/components/memory/status-toast";
import { LedgerList } from "@/components/memory/ledger-list";
import { SectionHeader } from "@/components/memory/section-header";
import { StatsCards } from "@/components/memory/stats-cards";

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
        text: "Supabase is not configured. Connect Supabase from Settings to enable memory storage.",
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
        text: "Memory successfully processed and stored.",
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

  return (
    <div className="min-h-screen bg-background">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent" />
        <div className="absolute right-0 top-0 h-[500px] w-[500px] bg-primary/5 blur-[120px] rounded-full" />
        <div className="absolute left-0 bottom-0 h-[400px] w-[400px] bg-blue-500/5 blur-[100px] rounded-full" />
      </div>
      
      <Header isOnline={isConfigured} />
      
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        {/* Hero section */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Cognitive Memory Router
          </h1>
          <p className="mt-3 text-base text-muted-foreground max-w-2xl mx-auto">
            Transform unstructured thoughts into structured temporal memories and entity records. 
            Speak or type — the AI will classify and commit everything to your personal ledger.
          </p>
        </div>
        
        {/* Setup banner if not configured */}
        {!isConfigured && (
          <div className="mb-8 rounded-lg border border-warning/30 bg-warning/5 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-full bg-warning/10 p-2">
                <svg className="h-5 w-5 text-warning" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-warning">Supabase not connected</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Connect Supabase from the Settings menu to enable memory storage and retrieval.
                </p>
              </div>
            </div>
          </div>
        )}
        
        {/* Stats */}
        <div className="mb-8">
          <StatsCards 
            totalEntries={ledgers.length} 
            isRecording={isRecording}
            isProcessing={isLoading}
          />
        </div>
        
        {/* Input section */}
        <section className="mb-12">
          <SectionHeader 
            title="Memory Input" 
            subtitle="Voice or text transcription"
            icon="brain"
          />
          <div className="mt-4">
            <MemoryInput 
              onSubmit={handleSubmit} 
              isLoading={isLoading}
              onRecordingChange={setIsRecording}
            />
          </div>
        </section>
        
        {/* Ledger section */}
        <section>
          <SectionHeader 
            title="Raw Linear Notebook" 
            subtitle="Latest committed entries"
            count={ledgers.length}
            icon="database"
          />
          <div className="mt-4">
            <LedgerList ledgers={ledgers} />
          </div>
        </section>
      </main>
      
      {/* Footer */}
      <footer className="border-t border-border/50 bg-background/50 backdrop-blur-sm">
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono text-xs">FRIDAY MEMORY</span>
              <span className="text-border">•</span>
              <span>Layer 1 Ingestion Protocol</span>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground/60">
              <span>Powered by Groq + Supabase</span>
            </div>
          </div>
        </div>
      </footer>
      
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
