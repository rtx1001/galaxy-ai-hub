import { useState, useEffect } from "react";
import { ResourceBarStatus } from "../types";
import { CameraIcon, PlusIcon } from "./Icons";
import { clampNumber } from "../utils";

export function IconButton({
      title,
      onClick,
      disabled,
      active,
      tone = "default",
      size = "md",
      children,
    }: {
          title: string;
          onClick: () => void;
          disabled?: boolean;
          active?: boolean;
          tone?: "default" | "primary" | "danger";
          size?: "sm" | "md" | "lg";
          children: React.ReactNode;
        }) {
    const toneClasses = tone === "danger"
                ? "bg-rose-500/15 text-rose-200 hover:bg-rose-500/25"
                : "bg-[#1e1f20] text-[#e3e3e3] hover:bg-[#282a2c]";
    const sizeClasses =
      size === "sm" ? "h-9 w-9 rounded-xl" : size === "lg" ? "h-11 w-11 rounded-2xl" : "h-10 w-10 rounded-2xl";
    const style =
      tone === "primary"
        ? ({
            backgroundColor: "var(--accent-color)",
            color: "#131314",
          } as React.CSSProperties)
        : active && tone !== "danger"
          ? ({
              backgroundColor: "var(--accent-soft)",
              color: "var(--accent-color)",
              boxShadow: "inset 0 0 0 1px var(--accent-soft-strong)",
            } as React.CSSProperties)
          : undefined;
    return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex ${sizeClasses} items-center justify-center border border-[#282a2c] shadow-sm transition ${toneClasses} disabled:cursor-not-allowed disabled:opacity-40`}
      style={style}
    >
      {children}
    </button>
    );
}

export function NumberStepper({
      value,
      min,
      max,
      step,
      onChange,
      className = "",
    }: {
          value: number;
          min: number;
          max: number;
          step: number;
          onChange: (nextValue: number) => void;
          className?: string;
        }) {
    const [draftValue, setDraftValue] = useState(String(value));
    useEffect(() => {
    setDraftValue(String(value));
    }, [value]);
    const adjust = (direction: 1 | -1) => {
            const nextValue = clampNumber(value + step * direction, min, max);
            setDraftValue(String(nextValue));
            onChange(nextValue);
          };
    const commitDraft = () => {
            const numericValue = Number(draftValue);
            if (!Number.isFinite(numericValue)) {
              setDraftValue(String(value));
              return;
            }
            const nextValue = clampNumber(numericValue, min, max);
            setDraftValue(String(nextValue));
            onChange(nextValue);
          };
    return (
    <div className={`grid h-9 ${className || "w-full min-w-[112px]"} grid-cols-[minmax(42px,1fr)_30px_30px] overflow-hidden rounded-xl border border-[#282a2c] bg-[#131314] shadow-sm focus-within:border-[var(--accent-color)]`}>
      <input
        type="number"
        value={draftValue}
        onChange={(event) => {
          const nextDraft = event.target.value;
          setDraftValue(nextDraft);
          const numericValue = Number(nextDraft);
          if (Number.isFinite(numericValue)) {
            onChange(numericValue);
          }
        }}
        onBlur={commitDraft}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        className="number-input min-w-0 appearance-none bg-transparent px-1 text-center text-sm font-semibold leading-none tabular-nums text-[#e3e3e3] outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        onClick={() => adjust(-1)}
        className="grid h-full w-full place-items-center border-l border-[#282a2c] text-center text-sm font-semibold leading-none text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
        aria-label="Decrease value"
      >
        -
      </button>
      <button
        type="button"
        onClick={() => adjust(1)}
        className="grid h-full w-full place-items-center border-l border-[#282a2c] text-center text-sm font-semibold leading-none text-[#c4c7c5] transition hover:bg-[#282a2c] hover:text-[var(--accent-color)]"
        aria-label="Increase value"
      >
        +
      </button>
    </div>
    );
}

export function SliderField({
      label,
      value,
      min,
      max,
      step,
      suffix = "",
      onChange,
      helper,
    }: {
          label: string;
          value: number;
          min: number;
          max: number;
          step: number;
          suffix?: string;
          onChange: (nextValue: number) => void;
          helper?: string;
        }) {
    const valueTitle = suffix ? `${value} ${suffix}` : String(value);
    return (
    <div className="space-y-2.5" title={helper}>
      <div className="grid grid-cols-[minmax(0,1fr)_128px] items-center gap-2">
        <div className="min-w-0" title={helper}>
          <div className="truncate text-sm font-semibold leading-tight text-[#e3e3e3]">{label}</div>
        </div>
        <div title={valueTitle}>
          <NumberStepper value={value} min={min} max={max} step={step} onChange={onChange} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={clampNumber(value, min, max)}
          onChange={(event) => onChange(clampNumber(Number(event.target.value), min, max))}
          className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[#282a2c] accent-[var(--accent-color)]"
        />
      </div>
    </div>
    );
}

export function ResourceBar({
      metric,
      detail,
    }: {
          metric: ResourceBarStatus;
          detail?: string;
        }) {
    const barColor = metric.available ? "var(--accent-color)" : "#3a3b3d";
    return (
    <div className="min-w-0 flex-1 items-end gap-2">
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex min-h-[12px] items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#c4c7c5]">
          <span className="shrink-0 truncate">{metric.label}</span>
          {detail ? (
            <span className="min-w-0 flex-1 truncate normal-case tracking-normal text-[#9aa0a6]" title={detail}>
              {detail}
            </span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          <span className="shrink-0 text-right normal-case tracking-normal text-[#e3e3e3]">
            {metric.summary}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#090a0b] shadow-inner">
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${Math.max(metric.available ? 6 : 4, metric.percent)}%`, backgroundColor: barColor }}
          />
        </div>
      </div>
    </div>
    );
}

export function AvatarImage({
      src,
      fallback,
      className = "h-10 w-10",
    }: {
          src?: string;
          fallback: string;
          className?: string;
        }) {
    const imageSrc = src && /^(data:image\/|blob:|https?:\/\/|file:)/i.test(src) ? src : "";
    return (
    <div className={`overflow-hidden rounded-2xl ${className}`}>
      {imageSrc ? (
        <img src={imageSrc} alt={fallback} className="h-full w-full object-cover" />
      ) : (
        <div className="relative flex h-full w-full items-center justify-center bg-[#131314] text-[#c4c7c5]" title={fallback}>
          <CameraIcon className="h-1/2 w-1/2" />
          <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-[var(--accent-color)] text-[#131314] ring-2 ring-[#131314]">
            <PlusIcon className="h-3 w-3" />
          </span>
        </div>
      )}
    </div>
    );
}
