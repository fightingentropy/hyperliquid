const wholeNumber = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const compactCurrency = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function pad2(value) {
  return `${value}`.padStart(2, "0");
}

export function formatCount(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return wholeNumber.format(value);
}

export function formatCurrency(value, maximumFractionDigits = 0) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits > 0 ? 2 : 0,
  }).format(value)}`;
}

export function formatSignedCurrency(value, maximumFractionDigits = 0) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatCurrency(Math.abs(value), maximumFractionDigits)}`;
}

export function formatCompactCurrency(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `$${compactCurrency.format(value)}`;
}

export function formatCompactSignedCurrency(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  if (value === 0) {
    return "$0";
  }

  const sign = value > 0 ? "+" : "-";
  return `${sign}${formatCompactCurrency(Math.abs(value))}`;
}

export function formatAxisCurrency(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `$${compactCurrency.format(value)}`;
}

export function formatPrice(value) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  const maximumFractionDigits = value >= 100 ? 2 : 4;
  return `$${new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: 2,
  }).format(value)}`;
}

export function formatPercent(value, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits,
  }).format(value)}%`;
}

export function formatSignedPercent(value, maximumFractionDigits = 2) {
  if (!Number.isFinite(value)) {
    return "—";
  }

  if (value === 0) {
    return formatPercent(0, maximumFractionDigits);
  }

  const sign = value > 0 ? "+" : "-";
  return `${sign}${formatPercent(Math.abs(value), maximumFractionDigits)}`;
}

export function shortAddress(address) {
  if (!address) {
    return "Unknown wallet";
  }

  if (address.length <= 12) {
    return address;
  }

  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatHourLabel(isoString) {
  const date = new Date(isoString);
  return `${date.getUTCHours()}h`;
}

export function formatBucketLabel(isoString, chartWindow) {
  if (chartWindow === "24h") {
    return formatHourLabel(isoString);
  }

  const date = new Date(isoString);
  const month = pad2(date.getUTCMonth() + 1);
  const day = pad2(date.getUTCDate());
  const hour = chartWindow === "30d" ? pad2(date.getUTCHours()) : date.getUTCHours();

  return `${month}/${day} ${hour}h`;
}

export function formatTooltipTimestamp(isoString) {
  const date = new Date(isoString);
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())} ${pad2(date.getUTCHours())}:00 UTC`;
}
