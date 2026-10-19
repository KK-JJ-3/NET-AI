export function formatWhen(iso) {
  if (!iso) {
    return {
      relative: "Unknown",
      absolute: "Unknown",
    };
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return {
      relative: "Unknown",
      absolute: "Unknown",
    };
  }

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);

  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];

  const [unit, size] = units.find(
    ([, seconds]) => Math.abs(diffSeconds) >= seconds,
  ) || ["second", 1];

  const relative = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  }).format(Math.round(diffSeconds / size), unit);

  const absolute = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

  return {
    relative,
    absolute,
  };
}

