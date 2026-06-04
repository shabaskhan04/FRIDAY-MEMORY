"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Loader2, Send, Plus } from "lucide-react";
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
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div 
      className={cn(
        "rounded-2xl glass-card p-2 transition-all duration-200",
        isFocused && "ring-1 ring-primary/30",
        isRecording && "ring-1 ring-destructive/30"
      )}
    >
      <div className="flex items-center gap-2">
        {/* Add/Record Button */}
        {speechSupported && (
          <button
            type="button"
            onClick={toggleRecording}
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
              isRecording 
                ? "bg-destructive text-destructive-foreground" 
                : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
            )}
          >
            {isRecording ? (
              <MicOff className="h-5 w-5" />
            ) : (
              <Mic className="h-5 w-5" />
            )}
          </button>
        )}
        
        {/* Input Field */}
        <input
          ref={inputRef}
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={isLoading}
          placeholder={isRecording ? "Listening..." : "Enter a memory..."}
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        
        {/* Submit Button */}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!content.trim() || isLoading}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
            content.trim() && !isLoading
              ? "gradient-purple text-white"
              : "bg-secondary text-muted-foreground"
          )}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Plus className="h-5 w-5" />
          )}
        </button>
      </div>
      
      {/* Recording Indicator */}
      {isRecording && (
        <div className="mt-2 flex items-center gap-2 px-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
          </span>
          <span className="text-xs text-destructive">Recording...</span>
        </div>
      )}
    </div>
  );
}
