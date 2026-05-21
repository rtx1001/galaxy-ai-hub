import { useEffect } from "react";

export function useMissingTooltips() {
  useEffect(() => {
    const applyMissingTooltip = (event: MouseEvent) => {
      const target = event.target instanceof Element
        ? event.target.closest("button,input,textarea,select")
        : null;
      if (!(target instanceof HTMLElement) || target.getAttribute("title")) return;
      const tooltip =
        target.getAttribute("aria-label") ||
        target.getAttribute("placeholder") ||
        target.textContent?.replace(/\s+/g, " ").trim() ||
        "";
      if (tooltip) target.setAttribute("title", tooltip);
    };
    document.addEventListener("mouseover", applyMissingTooltip, true);
    return () => document.removeEventListener("mouseover", applyMissingTooltip, true);
  }, []);
}
