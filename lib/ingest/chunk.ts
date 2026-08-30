/**
 * Recursive chunking at ~500-800 tokens with ~15% overlap.
 * Token count is estimated at 4 characters per token.
 */

export const CHUNK_TARGET_TOKENS = 600;
export const CHUNK_MAX_TOKENS = 800;
export const CHUNK_OVERLAP_RATIO = 0.15;
export const CHARS_PER_TOKEN = 4;

export interface TextSegment {
  text: string;
  page: number | null;
}

export interface Chunk {
  content: string;
  pageNumber: number | null;
  chunkIndex: number;
  tokenCount: number;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function countTokens(text: string): number {
  return estimateTokens(text);
}

const SPLIT_BOUNDARIES: Array<[string, number]> = [
  ["\n\n", 0], // paragraph breaks
  ["\n", 1], // line breaks
  [". ", 2], // sentences
  [" ", 3], // words
];

/**
 * Recursively split text until every piece fits below maxChars,
 * preferring the largest structural boundaries first.
 */
export function recursiveSplit(text: string, maxChars: number): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars || trimmed.length <= 50) {
    return trimmed.length > 0 ? [trimmed] : [];
  }

  const [firstBoundary, level] = SPLIT_BOUNDARIES[0];
  const parts = splitOnBoundary(trimmed, firstBoundary, level);
  if (parts.length === 1) {
    return recursiveSplit(trimmed, Math.max(maxChars, trimmed.length)); // cannot split further at this level
  }

  const result: string[] = [];
  for (const part of parts) {
    if (part.length > maxChars && level < SPLIT_BOUNDARIES.length) {
      // recurse with next-level boundary for oversized pieces
      result.push(...splitLarge(part, maxChars, level + 1));
    } else if (part.trim().length > 0) {
      result.push(part.trim());
    }
  }
  return result;
}

function splitLarge(text: string, maxChars: number, startLevel: number): string[] {
  if (text.length <= maxChars || startLevel >= SPLIT_BOUNDARIES.length) {
    return text.length > 0 ? [text] : [];
  }
  const [boundary, level] = SPLIT_BOUNDARIES[startLevel];
  const parts = splitOnBoundary(text, boundary, level);
  if (parts.length === 1) {
    return splitLarge(text, maxChars, startLevel + 1);
  }
  const result: string[] = [];
  for (const part of parts) {
    if (part.length > maxChars) {
      result.push(...splitLarge(part, maxChars, startLevel + 1));
    } else if (part.trim().length > 0) {
      result.push(part.trim());
    }
  }
  return result;
}

function splitOnBoundary(text: string, boundary: string, level: number): string[] {
  if (level === 0) {
    return text
      .split(boundary)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
  if (level === 1) {
    return text.split(boundary);
  }
  if (level === 2) {
    return splitKeepingDelimiter(text, ". ");
  }
  return text.split(boundary);
}

function splitKeepingDelimiter(text: string, delimiter: string): string[] {
  const parts: string[] = [];
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.slice(i, i + delimiter.length) === delimiter) {
      parts.push(text.slice(last, i + delimiter.length).trim());
      last = i + delimiter.length;
    }
  }
  if (last < text.length) parts.push(text.slice(last).trim());
  return parts.filter((p) => p.length > 0);
}

/**
 * Chunk page-tracked text segments into chunks with target size and overlap.
 */
export function chunkSegments(segments: TextSegment[]): Chunk[] {
  const maxChars = CHUNK_MAX_TOKENS * CHARS_PER_TOKEN;
  const targetChars = CHUNK_TARGET_TOKENS * CHARS_PER_TOKEN;
  const overlapChars = Math.round(targetChars * CHUNK_OVERLAP_RATIO);

  // Flatten segments into a single ordered list, then re-split by boundaries.
  const fullText = segments
    .map((s) => `\n\n${s.text}`)
    .join("")
    .trim();

  let pieces: string[] = recursiveSplit(fullText, maxChars);

  if (pieces.length === 1 && pieces[0].length > maxChars) {
    // Fall back to hard split by characters if recursion couldn't break it.
    pieces = hardSplit(pieces[0], maxChars, overlapChars);
  }

  const chunks: Chunk[] = [];
  let previousTail = "";

  pieces.forEach((piece, index) => {
    let content = piece;
    if (previousTail && content.length + previousTail.length <= maxChars) {
      // Add overlap from the tail of the previous chunk.
      content = `${previousTail}\n${content}`;
    }
    const nextTail = content.slice(-overlapChars);
    previousTail = nextTail;

    chunks.push({
      content,
      pageNumber: findPageForContent(content, segments),
      chunkIndex: index,
      tokenCount: countTokens(content),
    });
  });

  return chunks;
}

export function chunkText(text: string): Chunk[] {
  // For TXT/MD there are no explicit page boundaries; treat as a single page.
  return chunkSegments([{ text, page: 1 }]);
}

function hardSplit(text: string, maxChars: number, overlapChars: number): string[] {
  const pieces: string[] = [];
  let i = 0;
  while (i < text.length) {
    const slice = text.slice(i, i + maxChars);
    pieces.push(slice);
    i = i + maxChars - overlapChars;
  }
  return pieces.filter((p) => p.length > 0);
}

function findPageForContent(content: string, segments: TextSegment[]): number | null {
  // The page of the chunk is the page containing the start of the content.
  for (const seg of segments) {
    const start = content.indexOf(seg.text.slice(0, Math.min(40, seg.text.length)));
    if (start !== -1) return seg.page;
  }
  const seg = segments.find((s) => content.startsWith(s.text.slice(0, 10)));
  return seg?.page ?? null;
}