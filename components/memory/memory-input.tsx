"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: {
    length: number;
    isFinal: boolean;
    [index: number]: { transcript: string }[] & { isFinal: boolean };
  };
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

interface MemoryInputProps {
  onSubmit: (content: string) => Promise<void>;
  isLoading: boolean;
  onRecordingChange?: (isRecording: boolean) => void;
}

export function MemoryInput({ onSubmit, isLoading, onRecordingChange }: MemoryInputProps) {
  const [content, setContent] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechAPI) return;

    setSpeechSupported(true);
    const recognition = new SpeechAPI();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent): void => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        }
      }
      if (transcript.trim()) {
        setContent((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
      }
    };

    recognition.onend = (): void => {
      setIsRecording(false);
      onRecordingChange?.(false);
    };
    
    recognition.onerror = (): void => {
      setIsRecording(false);
      onRecordingChange?.(false);
    };

    recognitionRef.current = recognition;
  }, [onRecordingChange]);

  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  const toggleRecording = useCallback(() => {
    if (!recognitionRef.current) return;
    
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
      onRecordingChange?.(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
        onRecordingChange?.(true);
      } catch (e) {
        console.error("[SpeechRecognition] start failed:", e);
        setIsRecording(false);
        onRecordingChange?.(false);
      }
    }
  }, [isRecording, onRecordingChange]);

  const handleSubmit = async () => {
    const trimmed = content.trim();
    if (!trimmed || isLoading) return;
    await onSubmit(trimmed);
    setContent("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="relative rounded-2xl border border-border/50 bg-card/30 backdrop-blur-sm p-1 transition-all duration-300 focus-within:border-primary/30 focus-within:shadow-lg focus-within:shadow-primary/5">
      <div className="relative">
        <Textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isLoading}
          placeholder="Begin transcription. Mix past memories, present observations, and future intentions. Mention people freely — the router will extract, classify, and commit everything to the ledger..."
          className="min-h-[180px] border-0 bg-transparent text-base leading-relaxed focus-visible:ring-0 focus-visible:ring-offset-0 resize-none placeholder:text-muted-foreground/50"
        />
        
        {isRecording && (
          <div className="absolute right-4 top-4 flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive border border-destructive/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive"></span>
            </span>
            Recording
          </div>
        )}
      </div>
      
      <div className="flex items-center justify-between gap-3 border-t border-border/30 p-3">
        <div className="flex items-center gap-2">
          {speechSupported && (
            <Button
              type="button"
              variant={isRecording ? "destructive" : "outline"}
              size="icon"
              onClick={toggleRecording}
              className={cn(
                "relative h-10 w-10 rounded-full transition-all duration-200",
                isRecording && "animate-pulse"
              )}
            >
              {isRecording ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
              {isRecording && (
                <span className="absolute inset-0 rounded-full border border-destructive animate-pulse-ring" />
              )}
            </Button>
          )}
          <span className="text-xs text-muted-foreground font-mono">
            {content.length.toLocaleString()} chars
          </span>
        </div>
        
        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-muted-foreground">
            ⌘ + Enter to commit
          </span>
          <Button
            onClick={() => void handleSubmit()}
            disabled={!content.trim() || isLoading}
            variant="glow"
            size="lg"
            className="relative overflow-hidden"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Processing</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span>Commit to Memory</span>
                <Send className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
