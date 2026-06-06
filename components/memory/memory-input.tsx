"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Mic, MicOff, Loader2, Plus, MapPin, MapPinOff, Brain, CheckSquare, ChevronDown, Mail, Calendar as CalendarIcon } from "lucide-react";
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

export interface LocationData {
  location_text: string;
  location_lat: number;
  location_lon: number;
}

export type InputMode = "memory" | "gmail" | "calendar" | "task";

interface MemoryInputProps {
  onSubmit: (
    content: string,
    deviceType: string,
    timezone: string,
    location?: LocationData,
    mode?: InputMode
  ) => Promise<void>;
  isLoading: boolean;
  onRecordingChange?: (isRecording: boolean) => void;
  prefillText?: string;
  onPrefillConsumed?: () => void;
}

function detectDeviceType(): "mobile" | "desktop" {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent;
  if (/Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return "mobile";
  return "desktop";
}

function detectTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; }
}

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10`,
      { headers: { "Accept-Language": "en" } }
    );
    const data = (await res.json()) as {
      address?: {
        city?: string;
        town?: string;
        village?: string;
        state?: string;
        country?: string;
      };
    };
    const a = data.address ?? {};
    const city = a.city ?? a.town ?? a.village ?? "";
    const state = a.state ?? "";
    const country = a.country ?? "";
    return [city, state, country].filter(Boolean).join(", ");
  } catch {
    return `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
  }
}

type LocationState = "idle" | "requesting" | "granted" | "denied";

export function MemoryInput({
  onSubmit,
  isLoading,
  onRecordingChange,
  prefillText,
  onPrefillConsumed,
}: MemoryInputProps) {
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<InputMode>("memory");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [locationState, setLocationState] = useState<LocationState>("idle");
  const [locationData, setLocationData] = useState<LocationData | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Handle prefill from quick actions
  useEffect(() => {
    if (prefillText) {
      setContent(prefillText);
      inputRef.current?.focus();
      onPrefillConsumed?.();
    }
  }, [prefillText, onPrefillConsumed]);

  // Auto-request location on mount
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    requestLocation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestLocation = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setLocationState("requesting");
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const text = await reverseGeocode(latitude, longitude);
        setLocationData({ location_text: text, location_lat: latitude, location_lon: longitude });
        setLocationState("granted");
      },
      () => {
        setLocationState("denied");
      },
      { timeout: 8000, maximumAge: 300000 }
    );
  }, []);

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
        if (event.results[i].isFinal) transcript += event.results[i][0].transcript;
      }
      if (transcript.trim()) {
        setContent((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
      }
    };

    recognition.onend = (): void => { setIsRecording(false); onRecordingChange?.(false); };
    recognition.onerror = (): void => { setIsRecording(false); onRecordingChange?.(false); };
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
    const deviceType = detectDeviceType();
    const timezone = detectTimezone();
    await onSubmit(trimmed, deviceType, timezone, locationData ?? undefined, mode);
    setContent("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSubmit(); }
  };

  const locationIcon =
    locationState === "granted" ? (
      <MapPin className="h-3 w-3 text-success" />
    ) : locationState === "requesting" ? (
      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
    ) : (
      <MapPinOff className="h-3 w-3 text-muted-foreground/50" />
    );

  const locationLabel =
    locationState === "granted" && locationData
      ? locationData.location_text
      : locationState === "requesting"
      ? "Getting location..."
      : locationState === "denied"
      ? "Location denied"
      : "No location";

  return (
    <div
      className={cn(
        "rounded-2xl glass-card p-2 transition-all duration-200",
        isFocused && "ring-1 ring-primary/30",
        isRecording && "ring-1 ring-destructive/30"
      )}
    >
      <div className="flex items-center gap-2">
        {/* Mic Button */}
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
            {isRecording ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
        )}

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          disabled={isLoading}
          placeholder={
            isRecording ? "Listening..." :
            mode === "gmail"    ? "e.g. Email john@acme.com about the project update..." :
            mode === "calendar" ? "e.g. Team standup tomorrow at 10am for 30 mins..." :
            mode === "task"     ? "e.g. Buy groceries by Friday..." :
            "Enter a memory..."
          }
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />

        {/* Mode selector */}
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className={cn(
              "flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[11px] font-medium transition-all duration-200",
              mode === "memory"   && "bg-primary/10 text-primary",
              mode === "gmail"    && "bg-amber-500/10 text-amber-400",
              mode === "calendar" && "bg-blue-500/10 text-blue-400",
              mode === "task"     && "bg-emerald-500/10 text-emerald-400",
            )}
          >
            {mode === "memory"   && <Brain className="h-3 w-3" />}
            {mode === "gmail"    && <Mail className="h-3 w-3" />}
            {mode === "calendar" && <CalendarIcon className="h-3 w-3" />}
            {mode === "task"     && <CheckSquare className="h-3 w-3" />}
            <span className="capitalize">{mode}</span>
            <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", dropdownOpen && "rotate-180")} />
          </button>

          {dropdownOpen && (
            <div className="absolute bottom-full mb-1.5 right-0 w-32 rounded-xl border border-border/60 bg-background shadow-lg overflow-hidden z-10">
              {([
                { value: "memory",   label: "Memory",   icon: Brain,         color: "text-primary"      },
                { value: "gmail",    label: "Gmail",    icon: Mail,          color: "text-amber-400"    },
                { value: "calendar", label: "Calendar", icon: CalendarIcon,  color: "text-blue-400"     },
                { value: "task",     label: "Task",     icon: CheckSquare,   color: "text-emerald-400"  },
              ] as const).map(({ value, label, icon: Icon, color }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setMode(value); setDropdownOpen(false); }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors",
                    mode === value
                      ? "bg-secondary text-foreground font-medium"
                      : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                  )}
                >
                  <Icon className={cn("h-3 w-3", color)} />
                  <span>{label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!content.trim() || isLoading}
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200",
            content.trim() && !isLoading ? "gradient-purple text-white" : "bg-secondary text-muted-foreground"
          )}
        >
          {isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
        </button>
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div className="mt-2 flex items-center gap-2 px-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
          </span>
          <span className="text-xs text-destructive">Recording...</span>
        </div>
      )}

      {/* Meta: location + timezone + device */}
      <div className="mt-1.5 px-1 flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={locationState === "denied" || locationState === "idle" ? requestLocation : undefined}
          className="flex items-center gap-1 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          title={locationState === "denied" ? "Click to retry location" : ""}
        >
          {locationIcon}
          <span className="truncate max-w-[160px]">{locationLabel}</span>
        </button>
        <span className="text-[10px] text-muted-foreground/40">·</span>
        <span className="text-[10px] text-muted-foreground/50">{detectTimezone()}</span>
        <span className="text-[10px] text-muted-foreground/40">·</span>
        <span className="text-[10px] text-muted-foreground/50 capitalize">{detectDeviceType()}</span>
      </div>
    </div>
  );
}
