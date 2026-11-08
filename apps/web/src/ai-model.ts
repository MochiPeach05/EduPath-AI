// The model that wrote a stored AI output, and where it ran (user 2026-11-08: the AI moved from the PC's Ollama to
// Cloudflare Workers AI). Each output keeps the model id it was written with, so an older comment still reads "chạy cục
// bộ" and a new one names Cloudflare.

/** "gemma4:e4b" → "Gemma 4 E4B"; "@cf/google/gemma-4-26b-a4b-it" → "Gemma 4 26B"; absent → the PC's Gemma 4 E4B. */
export function modelLabel(model: string | null | undefined): string {
  if (!model) return "Gemma 4 E4B";
  const local = /^gemma(\d+):e(\d+)b/i.exec(model);
  if (local) return `Gemma ${local[1]} E${local[2]}B`;
  const cloud = /^@cf\/google\/gemma-(\d+)-(\d+)b/i.exec(model);
  if (cloud) return `Gemma ${cloud[1]} ${cloud[2]}B`;
  return model;
}

/** Where the model ran: "chạy trên Cloudflare Workers AI" for a Workers AI model (@cf/…), else "chạy cục bộ". */
export function modelPlace(model: string | null | undefined): string {
  return /^@cf\//.test(model ?? "") ? "chạy trên Cloudflare Workers AI" : "chạy cục bộ";
}
