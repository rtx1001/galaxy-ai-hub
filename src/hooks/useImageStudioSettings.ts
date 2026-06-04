import { useState } from "react";
import { DEFAULT_SETTINGS } from "../appCore";

export function useImageStudioSettings() {
  const [imageWidth, setImageWidth] = useState(DEFAULT_SETTINGS.image_width);
  const [imageHeight, setImageHeight] = useState(DEFAULT_SETTINGS.image_height);
  const [quickImagePrompt, setQuickImagePrompt] = useState("");
  const [quickImageMode, setQuickImageMode] = useState("text_image");

  return {
    imageWidth,
    setImageWidth,
    imageHeight,
    setImageHeight,
    quickImagePrompt,
    setQuickImagePrompt,
    quickImageMode,
    setQuickImageMode,
  };
}
