import { stageEmail } from "@/lib/google-staging";

export async function GET() {
  await stageEmail("FRIDAY_USER_ID", {
    to: "hello@ahabaskhan.me",
    subject: "[TEST] Project update",
    body: "Hi, here's a quick update...",
  });

  return Response.json({
    success: true,
  });
}