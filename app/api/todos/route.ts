import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("todo_tasks")
      .select("id, raw_ledger_id, task_description, status, created_at")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[todos] fetch error:", error);
      return NextResponse.json({ error: "Failed to fetch todos.", detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ todos: data ?? [] }, { status: 200 });
  } catch (err) {
    console.error("[todos] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const body = (await request.json()) as { id: string; status: string };
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json({ error: "id and status are required." }, { status: 400 });
    }

    if (!["pending", "done"].includes(status)) {
      return NextResponse.json({ error: "status must be 'pending' or 'done'." }, { status: 400 });
    }

    const supabase = createClient();

    // Use update without .single() to avoid failure when 0 rows matched
    const { data, error } = await supabase
      .from("todo_tasks")
      .update({ status })
      .eq("id", id)
      .select("id, status");

    if (error) {
      console.error("[todos] update error:", error);
      return NextResponse.json({ error: "Failed to update todo.", detail: error.message }, { status: 500 });
    }

    if (!data || data.length === 0) {
      return NextResponse.json({ error: "No todo found with that id." }, { status: 404 });
    }

    return NextResponse.json({ todo: data[0] }, { status: 200 });
  } catch (err) {
    console.error("[todos] patch unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
