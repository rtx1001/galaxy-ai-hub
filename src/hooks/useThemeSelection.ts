import { useEffect, useState } from "react";
import { readStoredThemeSwatchId, THEME_SWATCHS, THEME_SWATCH_STORAGE_KEY, themeSwatchById } from "../appCore";

export function useThemeSelection() {
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [themeSwatchId, setThemeSwatchId] = useState(readStoredThemeSwatchId);
  const selectedThemeSwatch = themeSwatchById(themeSwatchId);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_SWATCH_STORAGE_KEY, themeSwatchId);
    } catch {
      // Theme persistence is cosmetic; settings save still keeps the source of truth.
    }
  }, [themeSwatchId]);

  return {
    themePickerOpen,
    setThemePickerOpen,
    themeSwatchId,
    setThemeSwatchId,
    selectedThemeSwatch,
    themeSwatches: THEME_SWATCHS,
  };
}
