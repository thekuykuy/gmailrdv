export const AGENT_AI_MODELS = [
  { value: "google/gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
  { value: "google/gemini-3.1-flash-lite-preview", label: "Gemini 3.1 Flash Lite Preview" },
  { value: "google/gemini-3.5-flash", label: "Gemini 3.5 Flash" },
  { value: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
  { value: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro" },
  { value: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { value: "google/gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { value: "openai/gpt-5", label: "GPT-5" },
  { value: "openai/gpt-5-mini", label: "GPT-5 Mini" },
  { value: "openai/gpt-5-nano", label: "GPT-5 Nano" },
  { value: "openai/gpt-5.2", label: "GPT-5.2" },
  { value: "openai/gpt-5.4", label: "GPT-5.4" },
  { value: "openai/gpt-5.4-mini", label: "GPT-5.4 Mini" },
  { value: "openai/gpt-5.4-nano", label: "GPT-5.4 Nano" },
  { value: "openai/gpt-5.4-pro", label: "GPT-5.4 Pro" },
  { value: "openai/gpt-5.5", label: "GPT-5.5" },
  { value: "openai/gpt-5.5-pro", label: "GPT-5.5 Pro" },
] as const;

export const DEFAULT_AGENT_AI_MODEL = "google/gemini-2.5-flash";
export const AGENT_AI_MODEL_VALUES = AGENT_AI_MODELS.map((model) => model.value) as [string, ...string[]];

export function normalizeAgentAiModel(model: string | null | undefined) {
  return AGENT_AI_MODELS.some((m) => m.value === model) ? model! : DEFAULT_AGENT_AI_MODEL;
}