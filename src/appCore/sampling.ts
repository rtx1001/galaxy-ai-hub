import { DEFAULT_SETTINGS } from "./models";

export type ReplySamplingInput = {
  modelPath?: string;
  temperature: number;
  topK: number;
  topP: number;
  minP: number;
  repeatPenalty: number;
  thinkingEnabled?: boolean;
};

export type ReplySamplingConfig = {
  temperature: number;
  topK: number;
  topP: number;
  minP: number;
  repeatPenalty: number;
};

const closeTo = (left: number, right: number, epsilon = 0.001) => Math.abs(left - right) <= epsilon;

export const isDefaultSampling = (sampling: ReplySamplingInput) =>
  closeTo(sampling.temperature, DEFAULT_SETTINGS.sampling_temperature) &&
  sampling.topK === DEFAULT_SETTINGS.top_k &&
  closeTo(sampling.topP, DEFAULT_SETTINGS.top_p) &&
  closeTo(sampling.minP, DEFAULT_SETTINGS.min_p) &&
  closeTo(sampling.repeatPenalty, DEFAULT_SETTINGS.repeat_penalty);

export const modelFamilyFromPath = (modelPath?: string) => {
  const lowered = (modelPath || "").toLowerCase();
  if (lowered.includes("qwen3.6") || lowered.includes("qwen3_6") || lowered.includes("qwen36")) return "qwen3_6";
  if (lowered.includes("qwen")) return "qwen";
  if (lowered.includes("gemma")) return "gemma";
  return "generic";
};

export const modelDefaultSampling = (modelPath?: string, thinkingEnabled?: boolean): ReplySamplingConfig => {
  switch (modelFamilyFromPath(modelPath)) {
    case "gemma":
      return {
        temperature: 1.0,
        topK: 64,
        topP: 0.95,
        minP: 0.0,
        repeatPenalty: 1.05,
      };
    case "qwen3_6":
    case "qwen":
      return thinkingEnabled
        ? {
            temperature: 0.6,
            topK: 20,
            topP: 0.95,
            minP: 0.0,
            repeatPenalty: 1.05,
          }
        : {
            temperature: 0.7,
            topK: 20,
            topP: 0.8,
            minP: 0.0,
            repeatPenalty: 1.05,
          };
    default:
      return {
        temperature: DEFAULT_SETTINGS.sampling_temperature,
        topK: DEFAULT_SETTINGS.top_k,
        topP: DEFAULT_SETTINGS.top_p,
        minP: DEFAULT_SETTINGS.min_p,
        repeatPenalty: DEFAULT_SETTINGS.repeat_penalty,
      };
  }
};

export const modelAwareReplySampling = (sampling: ReplySamplingInput): ReplySamplingConfig => {
  if (!isDefaultSampling(sampling)) {
    return {
      temperature: sampling.temperature,
      topK: sampling.topK,
      topP: sampling.topP,
      minP: sampling.minP,
      repeatPenalty: sampling.repeatPenalty,
    };
  }

  return modelDefaultSampling(sampling.modelPath, sampling.thinkingEnabled);
};
