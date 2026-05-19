import { ModelLibraryEntry, ThemeSwatch } from "../appCore";
import { BrainIcon, ChevronDownIcon, EyeIcon, FolderIcon } from "./Icons";
import { HeartbeatMonitor } from "./HeartbeatMonitor";

export function BrainSection({
  brainStatus,
  modelMenuOpen,
  availableModels,
  selectedModelPath,
  currentModelName,
  currentModelEntry,
  theme,
  isAudioPlaying,
  waveformProcessing,
  onChooseModelFolder,
  onToggleModelMenu,
  onSelectModel,
}: {
  brainStatus: "Idle" | "Loading" | "Ready" | "Thinking" | "Error";
  modelMenuOpen: boolean;
  availableModels: ModelLibraryEntry[];
  selectedModelPath: string;
  currentModelName: string;
  currentModelEntry?: ModelLibraryEntry | null;
  theme: ThemeSwatch;
  isAudioPlaying: boolean;
  waveformProcessing: boolean;
  onChooseModelFolder: () => void;
  onToggleModelMenu: () => void;
  onSelectModel: (path: string) => void;
}) {
  const activeBrain = brainStatus === "Ready" || brainStatus === "Thinking";

  return (
    <section className="rounded-[20px] border border-[#282a2c] bg-[#1e1f20] p-2.5 shadow-sm">
      <div className="flex h-9 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-[0.22em] text-[#c4c7c5]">AI Brain</div>
        </div>
        <button
          type="button"
          title="Choose GGUF models folder"
          onClick={onChooseModelFolder}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#282a2c] bg-[#131314] text-[#e3e3e3] shadow-sm transition hover:bg-[#282a2c]"
        >
          <FolderIcon className="h-4.5 w-4.5" />
        </button>
      </div>
      <div className="relative mt-2.5" data-dropdown-root>
        <button
          type="button"
          onClick={onToggleModelMenu}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-[#282a2c] bg-[#131314] px-4 py-3 text-left text-sm text-[#e3e3e3] outline-none transition hover:bg-[#282a2c] focus:border-[var(--accent-color)]"
        >
          <span className="flex shrink-0 items-center gap-1.5">
            <BrainIcon className={`h-5 w-5 ${activeBrain ? "text-emerald-400" : brainStatus === "Loading" ? "animate-pulse text-[var(--accent-color)]" : brainStatus === "Error" ? "text-rose-400" : "text-[#c4c7c5]"}`} />
            {currentModelEntry?.has_vision && <EyeIcon className="h-4 w-4 text-[var(--accent-color)]" />}
          </span>
          <span className="min-w-0 flex-1 truncate text-left">
            {selectedModelPath ? currentModelName : "No model selected"}
          </span>
          <ChevronDownIcon className={`h-4 w-4 shrink-0 text-[#c4c7c5] transition ${modelMenuOpen ? "rotate-180" : ""}`} />
        </button>

        {modelMenuOpen && (
          <div className="dropdown-scroll absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-[#282a2c] bg-[#131314] p-2 shadow-2xl">
            {availableModels.length === 0 ? (
              <div className="px-3 py-3 text-sm text-[#c4c7c5]">No model selected. Choose a GGUF folder first.</div>
            ) : (
              availableModels.map((model) => (
                <button
                  key={model.path}
                  type="button"
                  onClick={() => onSelectModel(model.path)}
                  className={`w-full rounded-xl px-3 py-2 text-left transition ${selectedModelPath === model.path ? "bg-[var(--accent-soft)] ring-1 ring-[var(--accent-soft-strong)]" : "hover:bg-[#1e1f20]"}`}
                >
                  <div className="flex items-center gap-2">
                    <BrainIcon className={`h-4 w-4 shrink-0 ${selectedModelPath === model.path && activeBrain ? "text-emerald-400" : "text-[#c4c7c5]"}`} />
                    {model.has_vision && <EyeIcon className="h-4 w-4 shrink-0 text-[var(--accent-color)]" />}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-[#e3e3e3]">{model.name}</div>
                      <div className="mt-0.5 truncate text-xs text-[#c4c7c5]">{model.relative_path}</div>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
      <div className="mt-3 overflow-hidden rounded-2xl border border-[#282a2c] bg-[#131314] p-3">
        <HeartbeatMonitor
          accent={theme.accent}
          soft={theme.soft}
          mode={isAudioPlaying ? "voice" : waveformProcessing ? "image" : "idle"}
        />
      </div>
    </section>
  );
}
