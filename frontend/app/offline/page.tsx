import Link from "next/link";
import { Brain, Home, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
      <section className="w-full max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
          <WifiOff className="h-7 w-7" />
        </div>
        <div className="mb-6 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary">
            Offline
          </p>
          <h1 className="text-2xl font-bold tracking-tight">FRIDAY is still with you</h1>
          <p className="text-sm leading-6 text-muted-foreground">
            Cached memories and app screens remain available. New capture,
            analysis, and sync features need the network again.
          </p>
        </div>
        <div className="flex flex-col gap-3">
          <Button asChild>
            <Link href="/">
              <Home className="h-4 w-4" />
              Return home
            </Link>
          </Button>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <Brain className="h-3.5 w-3.5" />
            App shell cached for install use
          </div>
        </div>
      </section>
    </main>
  );
}
