import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, THEME_SWATCHS } from "../appCore";

export const THEME_SWATCH_STORAGE_KEY = "galaxy.themeSwatchId";

export function useThemeSelection() {
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const [themeSwatchId, setThemeSwatchId] = useState(() => {
    try {
      const stored = localStorage.getItem(THEME_SWATCH_STORAGE_KEY);
      return THEME_SWATCHS.some((swatch) => swatch.id === stored)
        ? stored!
        : DEFAULT_SETTINGS.theme_swatch_id;
    } catch {
      return DEFAULT_SETTINGS.theme_swatch_id;
    }
  });
  const selectedThemeSwatch =
    THEME_SWATCHS.find((swatch) => swatch.id === themeSwatchId) ??
    THEME_SWATCHS[0];

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
