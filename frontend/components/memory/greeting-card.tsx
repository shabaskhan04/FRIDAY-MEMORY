"use client";

import { Sparkles, Mic } from "lucide-react";

interface GreetingCardProps {
  isConfigured: boolean;
  isRecording: boolean;
  isProcessing: boolean;
}

export function GreetingCard({ isConfigured, isRecording, isProcessing }: GreetingCardProps) {
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const getMessage = () => {
    if (isProcessing) return "Processing your thoughts...";
    if (isRecording) return "Listening to you...";
    if (!isConfigured) return "Connect Supabase to get started";
    return "Ready to capture your thoughts";
  };

  return (
    <div className="mb-6 rounded-2xl glass-card p-5 relative overflow-hidden">
      {/* Gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-purple-600/5 pointer-events-none" />
      
      <div className="relative">
        <p className="text-sm text-muted-foreground mb-1">{getGreeting()}</p>
        <h1 className="text-xl font-semibold text-foreground mb-3 text-balance">
          {isRecording ? (
            <span className="flex items-center gap-2">
              <Mic className="h-5 w-5 text-primary animate-pulse-soft" />
              Listening...
            </span>
          ) : isProcessing ? (
            <span className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary animate-pulse-soft" />
              Processing...
            </span>
          ) : (
            "Your cognitive memory awaits"
          )}
        </h1>
        <p className="text-sm text-muted-foreground">{getMessage()}</p>
      </div>
    </div>
  );
}
