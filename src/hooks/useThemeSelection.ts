import { useState } from "react";
import { DEFAULT_SETTINGS, THEME_SWATCHS } from "../appCore";

export function useThemeSelection() {
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [themeSwatchId, setThemeSwatchId] = useState(
    DEFAULT_SETTINGS.theme_swatch_id,
  );
  const selectedThemeSwatch =
    THEME_SWATCHS.find((swatch) => swatch.id === themeSwatchId) ??
    THEME_SWATCHS[0];

  return {
    themePickerOpen,
    setThemePickerOpen,
    themeSwatchId,
    setThemeSwatchId,
    selectedThemeSwatch,
    themeSwatches: THEME_SWATCHS,
  };
}
