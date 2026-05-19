import { ChevronDownIcon, EditIcon, PlusIcon } from "./Icons";
import { AvatarImage, IconButton } from "./UI";

export type ProfilePickerOption = {
  id: string;
  name: string;
  avatar?: string;
};

export function ProfilePickerSection({
  title,
  selectedId,
  selectedName,
  selectedAvatar,
  selectedFallback,
  options,
  menuOpen,
  createTitle,
  avatarTitle,
  onAvatarClick,
  onToggleMenu,
  onSelect,
  onCreate,
}: {
  title: string;
  selectedId: string;
  selectedName: string;
  selectedAvatar?: string;
  selectedFallback: string;
  options: ProfilePickerOption[];
  menuOpen: boolean;
  createTitle: string;
  avatarTitle: string;
  onAvatarClick: () => void;
  onToggleMenu: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  return (
    <section className="overflow-visible rounded-[20px] border border-[#282a2c] bg-[#1e1f20] p-2.5 shadow-sm">
      <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">{title}</div>
      <div className="mt-2 flex items-center gap-2">
        <div className="relative min-w-0 flex-1" data-dropdown-root>
          <div className="flex h-11 items-center gap-2 overflow-hidden rounded-[16px] border border-[#282a2c] bg-[#131314] p-1 text-sm text-[#e3e3e3] transition focus-within:border-[var(--accent-color)] hover:bg-[#282a2c]">
            <button
              type="button"
              onClick={onAvatarClick}
              className="group relative h-9 w-9 shrink-0 overflow-hidden rounded-[12px] ring-1 ring-[#282a2c]"
              title={avatarTitle}
            >
              <AvatarImage src={selectedAvatar} fallback={selectedFallback} className="h-full w-full rounded-[12px]" />
              <span className="absolute inset-0 hidden items-center justify-center bg-black/45 text-[#e3e3e3] group-hover:flex">
                <EditIcon className="h-4 w-4" />
              </span>
            </button>
            <button
              type="button"
              onClick={onToggleMenu}
              className="flex h-9 min-w-0 flex-1 items-center justify-between gap-3 px-1.5 text-left outline-none"
            >
              <span className="min-w-0 flex-1 truncate font-semibold">{selectedName}</span>
              <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#c4c7c5] transition ${menuOpen ? "rotate-180" : ""}`} />
            </button>
          </div>
          {menuOpen && (
            <div className="dropdown-scroll absolute left-0 right-0 top-full z-50 mt-1.5 max-h-56 overflow-y-auto rounded-[18px] border border-[#282a2c] bg-[#131314] p-1.5 shadow-2xl">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onSelect(option.id)}
                  className={`flex w-full items-center gap-2 rounded-[16px] px-2 py-1.5 text-left transition ${selectedId === option.id ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-soft-strong)]" : "hover:bg-[#1e1f20]"}`}
                >
                  <AvatarImage src={option.avatar} fallback={option.name} className="h-8 w-8 rounded-[12px]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#e3e3e3]">{option.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <IconButton size="lg" title={createTitle} onClick={onCreate}>
          <PlusIcon className="h-5 w-5" />
        </IconButton>
      </div>
    </section>
  );
}
