import { NextRequest, NextResponse } from "next/server";
import { stageCalendarEvent, type CalendarPayload } from "@/lib/google-staging";
import { getFridayUserId } from "@/lib/supabase-server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Partial<CalendarPayload>;

    if (!body.title || !body.startTime) {
      return NextResponse.json(
        { error: "title and startTime are required." },
        { status: 400 }
      );
    }

    // Basic ISO validation
    if (isNaN(Date.parse(body.startTime))) {
      return NextResponse.json(
        { error: "startTime must be a valid ISO 8601 string." },
        { status: 400 }
      );
    }

    const userId = getFridayUserId();
    const { id } = await stageCalendarEvent(userId, {
      title: body.title,
      startTime: body.startTime,
      endTime: body.endTime,
      description: body.description,
      location: body.location,
    });

    return NextResponse.json({ staged: true, id }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("[stage/calendar]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
