import { useEffect, useState } from "react";

export function useCompactLayout({
  setLeftPanelOpen,
  setRightPanelOpen,
}: {
  setLeftPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setRightPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const [isCompactLayout, setIsCompactLayout] = useState(
    typeof window !== "undefined"
      ? window.innerWidth - 292 * 2 < 482
      : false,
  );

  useEffect(() => {
    const onResize = () => {
      const sideWidth = 292;
      const compact = window.innerWidth - sideWidth * 2 < 482;
      setIsCompactLayout(compact);
      if (compact) {
        setLeftPanelOpen(false);
        setRightPanelOpen(false);
      } else {
        setLeftPanelOpen(true);
        setRightPanelOpen(true);
      }
    };

    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [setLeftPanelOpen, setRightPanelOpen]);

  return isCompactLayout;
}
