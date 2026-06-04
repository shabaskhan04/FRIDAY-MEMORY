"use client";

import { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase";
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
  type: "success" | "error";
  text: string;
  temporalCount?: number;
  entityCount?: number;
}

export default function CognitiveRouter() {
  const [ledgers, setLedgers] = useState<RawLedger[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const supabase = createClient();

  const fetchLedgers = useCallback(async (): Promise<void> => {
    const { data, error } = await supabase
      .from("raw_ledgers")
      .select("id, created_at, content")
      .order("created_at", { ascending: false })
      .limit(5);
    if (!error && data) setLedgers(data as RawLedger[]);
  }, [supabase]);

  useEffect(() => {
    void fetchLedgers();
  }, [fetchLedgers]);

  const handleSubmit = async (content: string): Promise<void> => {
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
      
      <Header isOnline />
      
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
