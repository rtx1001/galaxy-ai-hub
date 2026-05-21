import { ReactNode } from "react";
import { CloseIcon } from "./Icons";
import { IconButton } from "./UI";

type AppSidePanelProps = {
  actions?: ReactNode;
  children: ReactNode;
  isCompactLayout: boolean;
  onClose: () => void;
  open: boolean;
  side: "left" | "right";
  title: string;
};

export function AppSidePanel({
  actions,
  children,
  isCompactLayout,
  onClose,
  open,
  side,
  title,
}: AppSidePanelProps) {
  const compactPosition = side === "left" ? "left-0" : "right-0";
  const desktopBorder = side === "left" ? "border-r" : "border-l";
  const closeLabel = side === "left" ? "Close app settings" : "Close model controls";

  return (
    <>
      <aside
        className={`${open ? "flex" : "hidden"} ${
          isCompactLayout ? `fixed inset-y-0 ${compactPosition} z-50 w-[320px]` : `relative z-30 w-[292px] flex-none ${desktopBorder}`
        } flex-col border-[#323437] bg-[#18191b]`}
      >
        <div className="flex h-14 items-center justify-between border-b border-[#282a2c] px-4">
          <div className="text-sm font-semibold text-[#e3e3e3]">{title}</div>
          <div className="flex items-center gap-2">
            {actions}
            <IconButton size="sm" title={closeLabel} onClick={onClose}>
              <CloseIcon />
            </IconButton>
          </div>
        </div>
        <div className="panel-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>

      {isCompactLayout && open && (
        <button
          type="button"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/35"
          aria-label={`${closeLabel} overlay`}
        />
      )}
    </>
  );
}
