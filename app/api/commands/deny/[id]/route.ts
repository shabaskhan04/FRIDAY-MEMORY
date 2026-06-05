import { NextRequest, NextResponse } from "next/server";
import { createServiceClient, getFridayUserId } from "@/lib/supabase-server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing command id." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const userId = getFridayUserId();

  const { data, error } = await supabase
    .from("pending_commands")
    .update({ status: "denied" })
    .eq("id", id)
    .eq("user_id", userId)
    .eq("status", "pending")   // only deny if still pending
    .select("id, status")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Command not found or already actioned." },
      { status: 404 }
    );
  }

  return NextResponse.json({ denied: true, id });
}
