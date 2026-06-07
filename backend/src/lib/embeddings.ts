/**
 * Embedding provider dispatcher.
 *
 * Set EMBEDDING_PROVIDER in environment to choose backend:
 *   openai      → OpenAI text-embedding-3-small (default)
 *   huggingface → HuggingFace Inference API
 *   ollama      → local Ollama server
 */

export type EmbeddingVector = number[] | null;

const EMBEDDING_PROVIDER: string = process.env.EMBEDDING_PROVIDER ?? "openai";

async function generateEmbeddingOllama(text: string): Promise<EmbeddingVector> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_EMBEDDING_MODEL ?? "mxbai-embed-large";

  const response = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`[embedding/ollama] HTTP ${response.status}: ${err}`);
  }

  const json = (await response.json()) as { embedding?: number[] };
  if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
    throw new Error("[embedding/ollama] No embedding array in response.");
  }
  return json.embedding;
}

async function generateEmbeddingHuggingFace(text: string): Promise<EmbeddingVector> {
  const apiUrl =
    process.env.HUGGINGFACE_API_URL ??
    "https://api-inference.huggingface.co/pipeline/feature-extraction/BAAI/bge-large-en-v1.5";
  const apiKey = process.env.HUGGINGFACE_API_KEY;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ inputs: text }),
    signal: AbortSignal.timeout(35_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`[embedding/huggingface] HTTP ${response.status}: ${err}`);
  }

  const raw: unknown = await response.json();

  if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "number") {
    return raw as number[];
  }
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0]) && typeof (raw as number[][])[0][0] === "number") {
    return (raw as number[][])[0];
  }
  if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0]) && Array.isArray((raw as number[][][])[0][0])) {
    const tokenEmbeddings = (raw as number[][][])[0];
    const dim = tokenEmbeddings[0].length;
    const summed = new Array<number>(dim).fill(0);
    for (const tokenVec of tokenEmbeddings) {
      for (let i = 0; i < dim; i++) summed[i] += tokenVec[i];
    }
    return summed.map((v) => v / tokenEmbeddings.length);
  }

  throw new Error("[embedding/huggingface] Unexpected response shape.");
}

async function generateEmbeddingOpenAI(text: string): Promise<EmbeddingVector> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("[embedding/openai] OPENAI_API_KEY is not set.");

  const model = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: text }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => "");
    throw new Error(`[embedding/openai] HTTP ${response.status}: ${err}`);
  }

  const json = (await response.json()) as { data: Array<{ embedding: number[] }> };
  if (!Array.isArray(json.data) || !Array.isArray(json.data[0]?.embedding)) {
    throw new Error("[embedding/openai] Invalid embedding in response.");
  }
  return json.data[0].embedding;
}

/**
 * Top-level dispatcher. Returns null on failure (non-fatal — ingest continues).
 */
export async function generateEmbedding(text: string): Promise<EmbeddingVector> {
  try {
    switch (EMBEDDING_PROVIDER) {
      case "huggingface":
        return await generateEmbeddingHuggingFace(text);
      case "ollama":
        return await generateEmbeddingOllama(text);
      case "openai":
      default:
        return await generateEmbeddingOpenAI(text);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[embeddings] generation failed (non-fatal): ${message}`);
    return null;
  }
}

export function toVectorLiteral(v: number[]): string {
  return `[${v.join(",")}]`;
}
