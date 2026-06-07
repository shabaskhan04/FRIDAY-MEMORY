import Groq from "groq-sdk";

let _groq: Groq | null = null;

export function getGroqClient(): Groq {
  if (_groq) return _groq;
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("[Groq] GROQ_API_KEY is not set.");
  _groq = new Groq({ apiKey });
  return _groq;
}
