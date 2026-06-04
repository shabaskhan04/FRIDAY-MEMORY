import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("health_logs")
      .select("*")
      .order("log_date", { ascending: false })
      .limit(90); // last ~3 months

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ logs: data ?? [] });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await req.json() as Record<string, unknown>;
    const { metric_type, log_date, ...fields } = body as {
      metric_type: string;
      log_date: string;
      [key: string]: unknown;
    };

    if (!metric_type || !log_date) {
      return NextResponse.json({ error: "metric_type and log_date required" }, { status: 400 });
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("health_logs")
      .upsert({ metric_type, log_date, ...fields }, { onConflict: "log_date,metric_type" })
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ log: data });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
