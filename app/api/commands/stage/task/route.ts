import { NextRequest, NextResponse } from "next/server";
import { stageTask, type TaskPayload } from "@/lib/google-staging";
import { getFridayUserId } from "@/lib/supabase-server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Partial<TaskPayload>;

    if (!body.title) {
      return NextResponse.json(
        { error: "title is required." },
        { status: 400 }
      );
    }

    const userId = getFridayUserId();
    const { id } = await stageTask(userId, {
      title: body.title,
      dueDate: body.dueDate,
      notes: body.notes,
    });

    return NextResponse.json({ staged: true, id }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("[stage/task]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
