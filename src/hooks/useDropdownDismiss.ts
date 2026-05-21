import { useEffect, useRef } from "react";

export function useDropdownDismiss(closeDropdowns: () => void) {
  const closeDropdownsRef = useRef(closeDropdowns);
  closeDropdownsRef.current = closeDropdowns;

  useEffect(() => {
    const closeOpenDropdowns = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest("[data-dropdown-root]")) {
        return;
      }

      closeDropdownsRef.current();
    };

    document.addEventListener("pointerdown", closeOpenDropdowns);
    return () => document.removeEventListener("pointerdown", closeOpenDropdowns);
  }, []);
}
