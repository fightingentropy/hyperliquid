import { cx } from "../lib/cx";

export default function ButtonGroup({
  options,
  value,
  onChange,
  className,
  kind = "pills",
  size = "md",
  uppercase = false,
}) {
  const containerClassName =
    kind === "underline"
      ? "flex gap-2 overflow-x-auto border-b border-border pb-px scrollbar-hide"
      : kind === "segmented"
        ? "flex flex-wrap gap-1 rounded-sm border border-border p-1"
        : "flex flex-wrap gap-1";

  return (
    <div className={cx(containerClassName, className)}>
      {options.map((option) => {
        const selected = option.value === value;
        const buttonClassName =
          kind === "underline"
            ? cx(
                "shrink-0 whitespace-nowrap px-3 py-2 text-sm font-light tracking-wide transition-colors",
                uppercase && "uppercase",
                selected
                  ? "border-b-2 border-primary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )
            : kind === "segmented"
              ? cx(
                  size === "sm"
                    ? "rounded-sm px-3 py-1.5 text-xs font-medium transition-colors"
                    : "rounded-sm px-4 py-2 text-sm font-medium transition-colors",
                  uppercase && "uppercase",
                  selected
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )
              : cx(
                  "rounded-sm px-3 py-1.5 text-xs font-medium transition-colors",
                  uppercase && "uppercase",
                  selected
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                );

        return (
          <button
            key={option.value}
            type="button"
            className={buttonClassName}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
