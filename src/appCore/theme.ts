import type { CSSProperties } from "react";
import { DEFAULT_SETTINGS } from "./models";
import { THEME_SWATCHS } from "./chat";

export const THEME_SWATCH_STORAGE_KEY = "galaxy.themeSwatchId";

export const themeSwatchById = (id?: string | null) =>
  THEME_SWATCHS.find((swatch) => swatch.id === id) ??
  THEME_SWATCHS.find((swatch) => swatch.id === DEFAULT_SETTINGS.theme_swatch_id) ??
  THEME_SWATCHS[0];

export const readStoredThemeSwatchId = () => {
  try {
    const stored = localStorage.getItem(THEME_SWATCH_STORAGE_KEY);
    return THEME_SWATCHS.some((swatch) => swatch.id === stored)
      ? stored!
      : DEFAULT_SETTINGS.theme_swatch_id;
  } catch {
    return DEFAULT_SETTINGS.theme_swatch_id;
  }
};

export const startupThemeStyle = (id = readStoredThemeSwatchId()) => {
  const swatch = themeSwatchById(id);
  return {
    "--startup-accent": swatch.accent,
    "--startup-accent-soft": swatch.soft,
    "--startup-accent-glow": `${swatch.accent}44`,
    "--accent-color": swatch.accent,
    "--accent-hover": swatch.hover,
    "--accent-soft": swatch.soft,
    "--accent-soft-strong": `${swatch.accent}44`,
  } as CSSProperties;
};
