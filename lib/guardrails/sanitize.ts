/**
 * Prompt-injection defense.
 *
 * Retrieved document content is untrusted. Before it reaches an LLM prompt we
 * neutralize obvious instruction-like patterns so hostile text inside a
 * document cannot hijack the assistant. This only rewrites the copy placed in
 * <context> blocks — the stored chunk remains the original.
 */

const INSTRUCTION_PATTERNS: Array<{ regex: RegExp; label: string }> = [
  { regex: /ignore\s+(all\s+)?((previous|prior|above)\s+)?(instructions?|rules?|prompts?|directions?|system\s+prompt)/gi, label: "instruction-override" },
  { regex: /disregard\s+(all\s+)?((previous|prior|above)\s+)?(instructions?|rules?|prompts?|directions?)/gi, label: "instruction-override" },
  { regex: /forget\s+(everything|all\s+(your\s+)?(instructions?|rules?|prompts?|training|context))/gi, label: "instruction-override" },
  { regex: /you\s+(are|'?re)\s+(now|an?|being)\s+/gi, label: "role-redirect" },
  { regex: /act\s+as\s+(if\s+)?(an?|a)/gi, label: "role-redirect" },
  { regex: /pretend\s+(to\s+be|you\s+are)/gi, label: "role-redirect" },
  { regex: /emergency\s+override|override\s+(all\s+)?(instructions?|rules?|guardrails?)/gi, label: "override" },
  { regex: /system\s+prompt\s*[:=]|new\s+system\s+prompt/gi, label: "system-prompt-attack" },
  { regex: /your\s+(instructions?|system\s+prompt|rules?)\s*(are|have been|were)\s*(changed|updated|overridden|modified)/gi, label: "claim-change" },
  { regex: /reveal\s+(your|the)\s+(instructions?|system\s+prompt|prompt|secrets?|keys?)/gi, label: "exfiltration" },
  { regex: /what\s+are\s+your\s+(instructions?|system\s+prompt|prompt)/gi, label: "exfiltration" },
  { regex: /from\s+now\s+on\s+/gi, label: "steering" },
  { regex: /important\s*:\s*(now\s+)?(ignore|disregard|forget|you\s+must\s+respond)/gi, label: "steering" },
  { regex: /do\s+not\s+(follow|obey|listen\s+to)\s+(the\s+)?(instructions?|system|previous)/gi, label: "instruction-override" },
  { regex: /respond\s+(only\s+)?(as|to)\s+this\s+rather\s+than\s+following/gi, label: "instruction-override" },
];

const NEUTRALIZED_PREFIX = "[neutralized]";

/** Reset lastIndex so global-flag regexes are stateless between calls. */
function resetIndex(regex: RegExp): RegExp {
  regex.lastIndex = 0;
  return regex;
}

/**
 * Detect if a string contains an obvious instruction-like pattern.
 * Public for independent testing.
 */
export function containsInstructionPattern(input: string): boolean {
  return INSTRUCTION_PATTERNS.some((p) => resetIndex(p.regex).test(input));
}

/**
 * Neutralize instruction-like patterns in untrusted chunk text. Matching spans
 * are replaced with a short, safe marker so the text keeps flowing naturally
 * but cannot steer the model.
 */
export function sanitizeChunkContent(content: string): string {
  let output = content;
  for (const pattern of INSTRUCTION_PATTERNS) {
    if (resetIndex(pattern.regex).test(output)) {
      output = output.replace(resetIndex(pattern.regex), NEUTRALIZED_PREFIX);
    }
  }
  return output;
}

/** Number of active patterns — used for tests. */
export const patternCount = INSTRUCTION_PATTERNS.length;