import { NextResponse } from "next/server";
import { isGoogleConnected } from "@/lib/google-token";

export async function GET(): Promise<NextResponse> {
  try {
    const connected = await isGoogleConnected();
    return NextResponse.json({ connected });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("[google/status]", msg);
    return NextResponse.json({ connected: false, error: msg }, { status: 500 });
  }
}
