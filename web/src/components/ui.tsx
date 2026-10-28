/**
 * Shared UI primitives for SplitLink.
 */
import { clsx } from "clsx";
import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx("rounded-2xl border", className)}
      style={{
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(8px)",
        borderColor: "rgba(255,255,255,0.7)",
        boxShadow: "0 2px 16px rgba(27,49,88,0.07)",
      }}
    >
      {children}
    </div>
  );
}

// ── Button ────────────────────────────────────────────────────────────────────

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost" | "danger";
  loading?: boolean;
  children: ReactNode;
}

export function Button({
  variant = "primary",
  loading,
  children,
  className,
  disabled,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all select-none min-h-[44px]";
  const styles: Record<string, string> = {
    primary: "text-white disabled:opacity-50",
    ghost: "border disabled:opacity-40",
    danger: "text-white disabled:opacity-50",
  };
  const inlineStyle: Record<string, React.CSSProperties> = {
    primary: { background: "#1B3158" },
    ghost: {
      background: "transparent",
      borderColor: "#cbd5e1",
      color: "#475569",
    },
    danger: { background: "#dc2626" },
  };

  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(base, styles[variant], className)}
      style={inlineStyle[variant]}
    >
      {loading && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

// ── Badge ─────────────────────────────────────────────────────────────────────

export function StatusBadge({ status }: { status: number }) {
  const map: Record<number, { label: string; color: string; bg: string }> = {
    1: { label: "Open", color: "#166534", bg: "#dcfce7" },
    2: { label: "Paid", color: "#1e40af", bg: "#dbeafe" },
    3: { label: "Cancelled", color: "#991b1b", bg: "#fee2e2" },
  };
  const s = map[status] ?? {
    label: "Unknown",
    color: "#64748b",
    bg: "#f1f5f9",
  };
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
      style={{ color: s.color, background: s.bg }}
    >
      {s.label}
    </span>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <Loader2
      size={size}
      className="animate-spin"
      style={{ color: "#1B3158" }}
    />
  );
}

// ── AddressDisplay ────────────────────────────────────────────────────────────

export function AddressDisplay({
  address,
  shorten = true,
}: {
  address: string;
  shorten?: boolean;
}) {
  const display = shorten
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : address;
  return (
    <span className="font-mono text-xs break-all" style={{ color: "#475569" }}>
      {display}
    </span>
  );
}

// ── FieldError ────────────────────────────────────────────────────────────────

export function FieldError({ msg }: { msg: string }) {
  return (
    <p className="text-xs mt-1" style={{ color: "#dc2626" }}>
      {msg}
    </p>
  );
}

// ── InfoRow ───────────────────────────────────────────────────────────────────

export function InfoRow({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) {
  return (
    <div
      className="flex items-start justify-between gap-4 py-2 border-b last:border-0"
      style={{ borderColor: "#f1f5f9" }}
    >
      <span className="text-sm" style={{ color: "#64748b" }}>
        {label}
      </span>
      <span
        className="text-sm font-medium text-right"
        style={{ color: "#1a1a2e" }}
      >
        {value}
      </span>
    </div>
  );
}

// ── ExplorerLink ─────────────────────────────────────────────────────────────

export function ExplorerLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
      style={{ color: "#1B3158" }}
    >
      {label}
    </a>
  );
}
