"use client";

import { useEffect, useState } from "react";
import { Download, RefreshCw, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

const INSTALL_DISMISSED_KEY = "friday_install_prompt_dismissed";

export function PwaLifecycle() {
  const [online, setOnline] = useState(true);
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showOfflineCue, setShowOfflineCue] = useState(false);
  const [showInstallCue, setShowInstallCue] = useState(false);

  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);

  useEffect(() => {
    setOnline(navigator.onLine);

    const handleOnline = () => {
      setOnline(true);
      setShowOfflineCue(false);
    };
    const handleOffline = () => {
      setOnline(false);
      setShowOfflineCue(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    if (isStandalone) return;

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
      setShowInstallCue(localStorage.getItem(INSTALL_DISMISSED_KEY) !== "true");
    };

    const handleAppInstalled = () => {
      setInstallPrompt(null);
      setShowInstallCue(false);
      localStorage.setItem(INSTALL_DISMISSED_KEY, "true");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, [isStandalone]);

  useEffect(() => {
    if (
      process.env.NODE_ENV !== "production" ||
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    let refreshing = false;

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    window.addEventListener("load", () => {
      void navigator.serviceWorker.register("/sw.js").then((registration) => {
        if (registration.waiting) {
          setWaitingWorker(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(worker);
            }
          });
        });
      });
    });
  }, []);

  const applyUpdate = () => {
    waitingWorker?.postMessage({ type: "SKIP_WAITING" });
    setWaitingWorker(null);
  };

  const installApp = async () => {
    if (!installPrompt) return;

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;

    if (choice.outcome === "accepted") {
      localStorage.setItem(INSTALL_DISMISSED_KEY, "true");
    }

    setInstallPrompt(null);
    setShowInstallCue(false);
  };

  const dismissInstall = () => {
    localStorage.setItem(INSTALL_DISMISSED_KEY, "true");
    setShowInstallCue(false);
  };

  const mode = waitingWorker
    ? "update"
    : showInstallCue && installPrompt
      ? "install"
      : showOfflineCue && !online
        ? "offline"
        : null;

  if (!mode) return null;

  return (
    <div
      className={cn(
        "fixed inset-x-3 bottom-24 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-card/95 p-3 text-card-foreground shadow-xl backdrop-blur",
        "supports-[padding:max(0px)]:bottom-[max(6rem,env(safe-area-inset-bottom))]"
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {mode === "offline" ? <WifiOff className="h-4 w-4" /> : <Download className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">
          {mode === "update"
            ? "Update ready"
            : mode === "install"
              ? "Install FRIDAY"
              : "Offline mode"}
        </p>
        <p className="text-xs text-muted-foreground">
          {mode === "update" && "Refresh to load the newest FRIDAY build."}
          {mode === "install" && "Add it to your device for a faster standalone app."}
          {mode === "offline" &&
            "Recent screens stay available. New saves sync when you are back online."}
        </p>
      </div>
      {mode === "update" ? (
        <Button size="sm" onClick={applyUpdate}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      ) : mode === "install" ? (
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={() => void installApp()}>
            <Download className="h-4 w-4" />
            Install
          </Button>
          <button
            type="button"
            className="rounded-lg p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
            onClick={dismissInstall}
            aria-label="Dismiss install message"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="rounded-lg p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
          onClick={() => setShowOfflineCue(false)}
          aria-label="Dismiss offline message"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
