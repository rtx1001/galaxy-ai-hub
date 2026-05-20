import { useState } from "react";
import { DEFAULT_SETTINGS } from "../appCore";

export function useSamplingSettings() {
  const [creativity, setCreativity] = useState(DEFAULT_SETTINGS.creativity);
  const [samplingTemperature, setSamplingTemperature] = useState(
    DEFAULT_SETTINGS.sampling_temperature,
  );
  const [topK, setTopK] = useState(DEFAULT_SETTINGS.top_k);
  const [topP, setTopP] = useState(DEFAULT_SETTINGS.top_p);
  const [minP, setMinP] = useState(DEFAULT_SETTINGS.min_p);
  const [repeatLastN, setRepeatLastN] = useState(DEFAULT_SETTINGS.repeat_last_n);
  const [repeatPenalty, setRepeatPenalty] = useState(
    DEFAULT_SETTINGS.repeat_penalty,
  );
  const [memorySize, setMemorySize] = useState(DEFAULT_SETTINGS.memory_size);
  const [replyLength, setReplyLength] = useState(DEFAULT_SETTINGS.reply_length);
  const [intelligenceQuality, setIntelligenceQuality] = useState(
    DEFAULT_SETTINGS.intelligence_quality,
  );

  const resetSamplingDefaults = () => {
    setSamplingTemperature(DEFAULT_SETTINGS.sampling_temperature);
    setTopK(DEFAULT_SETTINGS.top_k);
    setTopP(DEFAULT_SETTINGS.top_p);
    setMinP(DEFAULT_SETTINGS.min_p);
    setRepeatLastN(DEFAULT_SETTINGS.repeat_last_n);
    setRepeatPenalty(DEFAULT_SETTINGS.repeat_penalty);
  };

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
