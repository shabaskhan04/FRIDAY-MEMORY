import { NextRequest, NextResponse } from "next/server";
import { stageEmail, type EmailPayload } from "@/lib/google-staging";
import { getFridayUserId } from "@/lib/supabase-server";

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = (await req.json()) as Partial<EmailPayload>;

    if (!body.to || !body.subject || !body.body) {
      return NextResponse.json(
        { error: "to, subject, and body are required." },
        { status: 400 }
      );
    }

    const userId = getFridayUserId();
    const { id } = await stageEmail(userId, {
      to: body.to,
      subject: body.subject,
      body: body.body,
      cc: body.cc,
    });

    return NextResponse.json({ staged: true, id }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Internal error";
    console.error("[stage/email]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
