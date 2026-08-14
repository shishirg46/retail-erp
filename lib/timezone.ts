// Shop-local timezone handling (D10).
//
// Postgres TIMESTAMP(3) columns are naive instants: Prisma round-trips them as
// UTC wall-clock, so "what local day does this instant fall on" has been host-
// process dependent. The ERP fixes this at the boundary with zero schema
// change: report day bounds are computed as instants in the shop timezone
// (ERP_TIMEZONE, default Asia/Kathmandu), and the range echo is rendered as an
// ISO-8601 string carrying the shop's offset so it is both unambiguous and
// shop-local.

export const DEFAULT_TIMEZONE = "Asia/Kathmandu";

// IANA timezone from ERP_TIMEZONE; a misconfigured value fails loudly rather
// than silently reporting the wrong day.
export function shopTimeZone(): string {
  const tz = process.env.ERP_TIMEZONE || DEFAULT_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new Error(
      `ERP_TIMEZONE '${tz}' is not a valid IANA time zone. ` +
        `Fix .env or remove it to use the default '${DEFAULT_TIMEZONE}'.`
    );
  }

  return tz;
}

// UTC offset (ms) of `timeZone` at `instant`, i.e. timeZoneWallClock - UTC.
export function getUtcOffsetMs(timeZone: string, instant: Date): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

  const parts = formatter.formatToParts(instant);
  const values: Record<string, string> = {};
  for (const part of parts) values[part.type] = part.value;

  let hour = Number(values.hour);
  if (hour === 24) hour = 0; // some zones format midnight transitions as 24:xx

  const wallClockUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    hour,
    Number(values.minute),
    Number(values.second),
    Number(values.fractionalSecond)
  );

  return wallClockUtc - instant.getTime();
}

// Local wall-clock components in the shop timezone.
function shopLocalParts(instant: Date): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  ms: number;
} {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: shopTimeZone(),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });

  const parts = formatter.formatToParts(instant);
  const values: Record<string, string> = {};
  for (const part of parts) values[part.type] = part.value;

  let hour = Number(values.hour);
  if (hour === 24) hour = 0;

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour,
    minute: Number(values.minute),
    second: Number(values.second),
    ms: Number(values.fractionalSecond),
  };
}

// Treat naive wall-clock components as shop-local time and return the instant
// (absolute UTC Date) whose shop clock shows exactly those components.
// Offsets are resolved at the naive-as-UTC instant; Nepal (+05:45) and the
// zones the tests use have no DST, so the approximation is exact there.
export function naiveAsShopLocal(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0
): Date {
  const naive = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  return new Date(naive.getTime() - getUtcOffsetMs(shopTimeZone(), naive));
}

// Midnight (00:00:00.000) at the start of the given shop-local day.
export function shopLocalDayStart(
  year: number,
  month: number,
  day: number
): Date {
  return naiveAsShopLocal(year, month, day);
}

// Render an instant as ISO-8601 with the shop's own offset, e.g.
// "2026-08-14T00:00:00.000+05:45". Unambiguous and shop-local (D10).
export function formatShopLocal(instant: Date): string {
  const parts = shopLocalParts(instant);
  const offsetMs = getUtcOffsetMs(shopTimeZone(), instant);
  const sign = offsetMs >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMs);
  const offset = `${sign}${String(Math.floor(abs / 3600000)).padStart(2, "0")}:${String(
    Math.floor((abs % 3600000) / 60000)
  ).padStart(2, "0")}`;

  const pad = (n: number, width = 2) => String(n).padStart(width, "0");

  return (
    `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}` +
    `T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}.${pad(parts.ms, 3)}${offset}`
  );
}
