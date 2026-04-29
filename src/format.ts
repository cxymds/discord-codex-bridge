export function chunkDiscordMessage(message: string, limit = 1900): string[] {
  const text = message.trim().length > 0 ? message : "(empty response)";
  const chunks: string[] = [];

  for (let offset = 0; offset < text.length; offset += limit) {
    chunks.push(text.slice(offset, offset + limit));
  }

  return chunks;
}

export function makeThreadTitle(prompt: string, maxLength = 90): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (cleaned.length === 0) {
    return "Codex session";
  }

  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1)}...` : cleaned;
}
