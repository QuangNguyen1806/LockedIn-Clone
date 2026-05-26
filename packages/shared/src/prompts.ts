import type { SessionConfig, ToneStyle } from "./session-schema.js";

export const PROMPT_VERSION = "v1";

const toneInstructions: Record<ToneStyle, string> = {
  concise: "Keep answers brief and direct, under 120 words.",
  conversational: "Use a natural, conversational tone while staying professional.",
  star: "Structure behavioral answers using STAR (Situation, Task, Action, Result).",
};

export function buildCoachingSystemPrompt(config: SessionConfig): string {
  const modeLabel =
    config.mode === "behavioral"
      ? "behavioral interview coach"
      : config.mode === "technical"
        ? "technical interview coach"
        : "professional meeting coach";

  return [
    `You are an ${modeLabel} helping the user practice and perform well.`,
    "Provide coaching, talking points, and suggested phrasing — not verbatim cheating on proctored exams.",
    toneInstructions[config.tone],
    config.company ? `Target company: ${config.company}.` : "",
    config.role ? `Target role: ${config.role}.` : "",
    config.customInstructions ? `User instructions: ${config.customInstructions}` : "",
    "Respond with actionable bullet points when possible.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCoachingUserPrompt(params: {
  recentTranscript: string;
  resumeContext?: string;
  jobDescriptionContext?: string;
}): string {
  const parts = [
    "Recent conversation:",
    params.recentTranscript || "(no transcript yet)",
  ];

  if (params.resumeContext) {
    parts.push("", "Relevant resume context:", params.resumeContext);
  }
  if (params.jobDescriptionContext) {
    parts.push("", "Relevant job description context:", params.jobDescriptionContext);
  }

  parts.push(
    "",
    "Provide coaching for the latest interviewer question or meeting topic.",
    "If the user is mid-answer, offer concise improvement tips.",
  );

  return parts.join("\n");
}

export function buildSummarySystemPrompt(): string {
  return [
    "You analyze completed interview or meeting sessions.",
    "Return JSON with keys: summary (string), questions (string[]), feedbackBullets (string[], 3-5 items).",
    "Feedback should be constructive and specific.",
  ].join("\n");
}

export function buildSummaryUserPrompt(transcript: string): string {
  return `Analyze this session transcript and return JSON only:\n\n${transcript}`;
}
