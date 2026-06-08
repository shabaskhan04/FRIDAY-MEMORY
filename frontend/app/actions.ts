"use server";

export async function verifyPassword(password: string): Promise<boolean> {
  const correct = process.env.APP_PASSWORD ?? process.env.NEXT_PUBLIC_APP_PASSWORD ?? "friday";
  return password === correct;
}
