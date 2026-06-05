import { useEffect } from "react";

export function useMissingTooltips() {
  useEffect(() => {
    const tooltipEl = document.createElement("div");
    tooltipEl.className = "global-tooltip";
    document.body.appendChild(tooltipEl);

    let activeTarget: HTMLElement | null = null;
    let showTimer: number | null = null;

    const tooltipTarget = (eventTarget: EventTarget | null) => {
      if (eventTarget instanceof Element && eventTarget.closest("input:not([type='range']):not([type='checkbox']):not([type='radio']), textarea")) {
        return null;
      }
      const target = eventTarget instanceof Element
        ? eventTarget.closest<HTMLElement>("[title],button,select,[aria-label]")
        : null;
      return target instanceof HTMLElement ? target : null;
    };

    const tooltipText = (target: HTMLElement) => {
      const existingTitle = target.getAttribute("title");
      if (existingTitle) {
        target.dataset.tooltipTitle = existingTitle;
        target.removeAttribute("title");
      }
      return (
        target.dataset.tooltipTitle ||
        target.getAttribute("aria-label") ||
        target.textContent?.replace(/\s+/g, " ").trim() ||
        ""
      ).trim();
    };

    const hideTooltip = () => {
      if (showTimer !== null) {
        window.clearTimeout(showTimer);
        showTimer = null;
      }
      activeTarget = null;
      tooltipEl.classList.remove("is-visible");
    };

    const positionTooltip = (target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      const tooltipRect = tooltipEl.getBoundingClientRect();
      const gap = 9;
      const preferredLeft = rect.left + rect.width / 2 - tooltipRect.width / 2;
      const left = Math.min(Math.max(8, preferredLeft), window.innerWidth - tooltipRect.width - 8);
      const above = rect.top - tooltipRect.height - gap;
      const top = above >= 8 ? above : Math.min(rect.bottom + gap, window.innerHeight - tooltipRect.height - 8);
      tooltipEl.style.left = `${Math.round(left)}px`;
      tooltipEl.style.top = `${Math.round(top)}px`;
    };

    const showTooltip = (target: HTMLElement) => {
      const text = tooltipText(target);
      if (!text) return;
      activeTarget = target;
      tooltipEl.textContent = text;
      tooltipEl.classList.remove("is-visible");
      if (showTimer !== null) {
        window.clearTimeout(showTimer);
      }
      showTimer = window.setTimeout(() => {
        if (activeTarget !== target) return;
        positionTooltip(target);
        tooltipEl.classList.add("is-visible");
      }, 260);
    };

    const handlePointerOver = (event: MouseEvent) => {
      const target = tooltipTarget(event.target);
      if (!target || target === activeTarget) return;
      showTooltip(target);
    };

    const handlePointerOut = (event: MouseEvent) => {
      if (!activeTarget) return;
      const related = event.relatedTarget;
      if (related instanceof Node && activeTarget.contains(related)) return;
      hideTooltip();
    };

    const handleFocusIn = (event: FocusEvent) => {
      const target = tooltipTarget(event.target);
      if (target) showTooltip(target);
    };

    const handleScrollOrResize = () => {
      if (activeTarget && tooltipEl.classList.contains("is-visible")) {
        positionTooltip(activeTarget);
      }
    };

    document.addEventListener("mouseover", handlePointerOver, true);
    document.addEventListener("mouseout", handlePointerOut, true);
    document.addEventListener("focusin", handleFocusIn, true);
    document.addEventListener("focusout", hideTooltip, true);
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    return () => {
      document.removeEventListener("mouseover", handlePointerOver, true);
      document.removeEventListener("mouseout", handlePointerOut, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", hideTooltip, true);
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      tooltipEl.remove();
    };
  }, []);
}
