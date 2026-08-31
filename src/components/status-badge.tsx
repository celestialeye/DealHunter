import { formatAvailability } from "@/lib/format";

export function StatusBadge({
  value,
  label,
}: {
  value: unknown;
  label?: string | null;
}) {
  const normalized = String(value ?? "UNKNOWN");
  const tone =
    normalized === "IN_STOCK" || normalized === "DELIVERED"
      ? "success"
      : normalized === "COMING_SOON" ||
          normalized === "PREORDER" ||
          normalized === "AWAITING_APPROVAL"
        ? "warning"
        : normalized === "OUT_OF_STOCK" ||
            normalized === "UNAVAILABLE" ||
            normalized === "FAILED" ||
            normalized === "CHALLENGE"
          ? "danger"
          : "neutral";
  return (
    <span className={`status-badge status-${tone}`}>
      <span className="status-dot" />
      {label || formatAvailability(normalized)}
    </span>
  );
}
