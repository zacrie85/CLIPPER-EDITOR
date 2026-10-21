"use client";

/* ============================================================
   CLIPPER EDITOR — Elemen UI bersama
   ============================================================ */

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Panel({
  title,
  icon,
  children,
  right,
  className,
}: {
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("clip-panel rounded-md", className)}>
      {title && (
        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
          <div className="flex items-center gap-2 text-[11px] tracking-[0.18em] text-foreground/80 uppercase">
            {icon}
            {title}
          </div>
          {right}
        </div>
      )}
      <div className="p-3 space-y-3">{children}</div>
    </div>
  );
}

export function Chip({
  active,
  onClick,
  children,
  disabled,
  className,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      data-active={active ? "true" : "false"}
      onClick={onClick}
      className={cn(
        "clip-chip rounded px-2.5 py-1.5 uppercase text-foreground/70",
        active && "text-white",
        disabled && "opacity-40 cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="clip-label shrink-0">{label}</span>
      <div className="flex items-center gap-1 flex-wrap justify-end">{children}</div>
    </div>
  );
}

export function Range({
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
  label,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  suffix?: string;
  label?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="space-y-1">
      {label && (
        <div className="flex justify-between">
          <span className="clip-label">{label}</span>
          <span className="text-[11px] text-foreground/80">
            {value.toFixed(step < 1 ? 2 : 0)}
            {suffix}
          </span>
        </div>
      )}
      <input
        type="range"
        className="clip-range"
        style={{ ["--fill" as string]: `${fill}%` }}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  className,
  type = "text",
  min,
  max,
  step,
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  type?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type={type}
      min={min}
      max={max}
      step={step}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "bg-input/60 border border-border rounded px-2 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/70 w-full",
        className
      )}
    />
  );
}

export function ActionBtn({
  onClick,
  children,
  disabled,
  variant = "ghost",
  className,
  title,
}: {
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  className?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.12em] transition-all",
        variant === "primary" &&
          "bg-primary text-primary-foreground hover:shadow-[0_0_18px_rgba(226,29,29,0.55)] hover:brightness-110",
        variant === "ghost" && "border border-border bg-secondary/60 hover:border-primary/60 hover:text-white",
        variant === "danger" && "border border-primary/50 text-primary hover:bg-primary hover:text-white",
        disabled && "opacity-40 cursor-not-allowed",
        className
      )}
    >
      {children}
    </button>
  );
}

export function Progress({ p, className }: { p: number; className?: string }) {
  return (
    <div className={cn("clip-progress", className)}>
      <div style={{ width: `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%` }} />
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10.5px] leading-relaxed text-muted-foreground border-l-2 border-primary/40 pl-2">
      {children}
    </div>
  );
}
