// Estimated USD pricing per 1M tokens for Lovable AI Gateway models.
// Used to derive a cost estimate from token usage — actual billing happens via credits.
export type ModelPricing = { input: number; output: number };

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "google/gemini-3-flash-preview": { input: 0.3, output: 2.5 },
  "google/gemini-3.1-flash-lite-preview": { input: 0.1, output: 0.4 },
  "google/gemini-3.5-flash": { input: 0.3, output: 2.5 },
  "google/gemini-3.1-pro-preview": { input: 1.25, output: 10 },
  "google/gemini-2.5-pro": { input: 1.25, output: 10 },
  "google/gemini-2.5-flash": { input: 0.3, output: 2.5 },
  "google/gemini-2.5-flash-lite": { input: 0.1, output: 0.4 },
  "openai/gpt-5": { input: 1.25, output: 10 },
  "openai/gpt-5-mini": { input: 0.25, output: 2 },
  "openai/gpt-5-nano": { input: 0.05, output: 0.4 },
  "openai/gpt-5.2": { input: 1.25, output: 10 },
  "openai/gpt-5.4": { input: 1.5, output: 12 },
  "openai/gpt-5.4-mini": { input: 0.3, output: 2.4 },
  "openai/gpt-5.4-nano": { input: 0.06, output: 0.5 },
  "openai/gpt-5.4-pro": { input: 5, output: 25 },
  "openai/gpt-5.5": { input: 2, output: 15 },
  "openai/gpt-5.5-pro": { input: 6, output: 30 },
};

export const DEFAULT_PRICING: ModelPricing = { input: 0.3, output: 2.5 };

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = MODEL_PRICING[model] ?? DEFAULT_PRICING;
  return (promptTokens * p.input + completionTokens * p.output) / 1_000_000;
}
