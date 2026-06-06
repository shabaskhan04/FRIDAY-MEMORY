import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export const runtime = "nodejs";

const FRIDAY_USER_ID = process.env.FRIDAY_USER_ID ?? "default-user";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing command id." }, { status: 400 });

  const supabase = createClient();

  const { data: cmd, error: fetchErr } = await supabase
    .from("pending_commands")
    .select("id, status")
    .eq("id", id)
    .eq("user_id", FRIDAY_USER_ID)
    .single();

  if (fetchErr || !cmd) return NextResponse.json({ error: "Command not found." }, { status: 404 });
  if ((cmd as { status: string }).status !== "pending") {
    return NextResponse.json({ error: `Cannot deny a command with status '${(cmd as { status: string }).status}'.` }, { status: 409 });
  }

  const { error: updateErr } = await supabase
    .from("pending_commands")
    .update({ status: "denied", denied_at: new Date().toISOString() })
    .eq("id", id);

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

  return NextResponse.json({ denied: true, id });
}
