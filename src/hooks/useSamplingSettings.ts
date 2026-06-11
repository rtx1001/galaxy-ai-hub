import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, modelDefaultSampling } from "../appCore";

export function useSamplingSettings({
  selectedModelPath,
  thinkingEnabled,
}: {
  selectedModelPath?: string;
  thinkingEnabled?: boolean;
} = {}) {
  const initialSampling = modelDefaultSampling(selectedModelPath, thinkingEnabled);
  const [creativity, setCreativity] = useState(DEFAULT_SETTINGS.creativity);
  const [samplingTemperature, setSamplingTemperature] = useState(
    initialSampling.temperature,
  );
  const [topK, setTopK] = useState(initialSampling.topK);
  const [topP, setTopP] = useState(initialSampling.topP);
  const [minP, setMinP] = useState(initialSampling.minP);
  const [repeatLastN, setRepeatLastN] = useState(DEFAULT_SETTINGS.repeat_last_n);
  const [repeatPenalty, setRepeatPenalty] = useState(
    initialSampling.repeatPenalty,
  );
  const [memorySize, setMemorySize] = useState(DEFAULT_SETTINGS.memory_size);
  const [replyLength, setReplyLength] = useState(DEFAULT_SETTINGS.reply_length);
  const [intelligenceQuality, setIntelligenceQuality] = useState(
    DEFAULT_SETTINGS.intelligence_quality,
  );

  const applyModelDefaults = () => {
    const nextSampling = modelDefaultSampling(selectedModelPath, thinkingEnabled);
    setSamplingTemperature(nextSampling.temperature);
    setTopK(nextSampling.topK);
    setTopP(nextSampling.topP);
    setMinP(nextSampling.minP);
    setRepeatLastN(DEFAULT_SETTINGS.repeat_last_n);
    setRepeatPenalty(nextSampling.repeatPenalty);
  };

  useEffect(() => {
    applyModelDefaults();
  }, [selectedModelPath]);

  const resetSamplingDefaults = applyModelDefaults;

  return {
    creativity,
    setCreativity,
    samplingTemperature,
    setSamplingTemperature,
    topK,
    setTopK,
    topP,
    setTopP,
    minP,
    setMinP,
    repeatLastN,
    setRepeatLastN,
    repeatPenalty,
    setRepeatPenalty,
    memorySize,
    setMemorySize,
    replyLength,
    setReplyLength,
    intelligenceQuality,
    setIntelligenceQuality,
    resetSamplingDefaults,
  };
}
