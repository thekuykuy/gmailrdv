export const AGENT_AI_MODEL_VALUES = [
  "google/gemini-3-flash-preview",
  "google/gemini-3.1-flash-lite-preview",
  "google/gemini-3.5-flash",
  "google/gemini-3.1-pro-preview",
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "openai/gpt-5",
  "openai/gpt-5-mini",
  "openai/gpt-5-nano",
  "openai/gpt-5.2",
  "openai/gpt-5.4",
  "openai/gpt-5.4-mini",
  "openai/gpt-5.4-nano",
  "openai/gpt-5.4-pro",
  "openai/gpt-5.5",
  "openai/gpt-5.5-pro",
] as const;

const MODEL_LABELS: Record<(typeof AGENT_AI_MODEL_VALUES)[number], string> = {
  "google/gemini-3-flash-preview": "Gemini 3 Flash Preview",
  "google/gemini-3.1-flash-lite-preview": "Gemini 3.1 Flash Lite Preview",
  "google/gemini-3.5-flash": "Gemini 3.5 Flash",
  "google/gemini-3.1-pro-preview": "Gemini 3.1 Pro Preview",
  "google/gemini-2.5-pro": "Gemini 2.5 Pro",
  "google/gemini-2.5-flash": "Gemini 2.5 Flash",
  "google/gemini-2.5-flash-lite": "Gemini 2.5 Flash Lite",
  "openai/gpt-5": "GPT-5",
  "openai/gpt-5-mini": "GPT-5 Mini",
  "openai/gpt-5-nano": "GPT-5 Nano",
  "openai/gpt-5.2": "GPT-5.2",
  "openai/gpt-5.4": "GPT-5.4",
  "openai/gpt-5.4-mini": "GPT-5.4 Mini",
  "openai/gpt-5.4-nano": "GPT-5.4 Nano",
  "openai/gpt-5.4-pro": "GPT-5.4 Pro",
  "openai/gpt-5.5": "GPT-5.5",
  "openai/gpt-5.5-pro": "GPT-5.5 Pro",
};

export const AGENT_AI_MODELS = AGENT_AI_MODEL_VALUES.map((value) => ({ value, label: MODEL_LABELS[value] }));

export const DEFAULT_AGENT_AI_MODEL = "google/gemini-2.5-flash";

export function normalizeAgentAiModel(model: string | null | undefined) {
  return AGENT_AI_MODELS.some((m) => m.value === model) ? model! : DEFAULT_AGENT_AI_MODEL;
}