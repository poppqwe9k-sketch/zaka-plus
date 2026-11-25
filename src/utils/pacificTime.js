const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const BAGHDAD_TIME_ZONE = 'Asia/Baghdad';

const PACIFIC_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: PACIFIC_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

const BAGHDAD_TIME_FORMATTER = new Intl.DateTimeFormat('en-US', {
  timeZone: BAGHDAD_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
});

function parseZonedParts(formatter, ms) {
  const safeMs = Number.isFinite(Number(ms)) ? Number(ms) : Date.now();
  const rawParts = formatter.formatToParts(new Date(safeMs));
  const map = {};
  for (const part of rawParts) {
    if (part.type !== 'literal') {
      map[part.type] = Number(part.value);
    }
  }
  const hour = map.hour === 24 ? 0 : (map.hour || 0);
  return {
    year: map.year || 1970,
    month: map.month || 1,
    day: map.day || 1,
    hour,
    minute: map.minute || 0,
    second: map.second || 0
  };
}

export function getPacificDateKey(nowMs = Date.now()) {
  const { year, month, day } = parseZonedParts(PACIFIC_FORMATTER, nowMs);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getPacificCycleStartMs(nowMs = Date.now()) {
  const safeNow = Number.isFinite(Number(nowMs)) ? Math.floor(Number(nowMs)) : Date.now();
  const { year, month, day } = parseZonedParts(PACIFIC_FORMATTER, safeNow);
  const targetMidnightAsUtc = Date.UTC(year, month - 1, day, 0, 0, 0, 0);

  // Initial probe using PST (UTC-8); adjust up to 3 times to resolve exact PST/PDT offset at midnight.
  let candidate = targetMidnightAsUtc + 8 * 60 * 60 * 1000;
  for (let i = 0; i < 3; i += 1) {
    const actual = parseZonedParts(PACIFIC_FORMATTER, candidate);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
      0
    );
    const diffMs = targetMidnightAsUtc - actualAsUtc;
    if (diffMs === 0) break;
    candidate += diffMs;
  }
  return candidate;
}

export function getNextPacificResetMs(nowMs = Date.now()) {
  const currentStart = getPacificCycleStartMs(nowMs);
  // Adding 26 hours always lands safely inside the next calendar day in America/Los_Angeles (even across DST transitions).
  return getPacificCycleStartMs(currentStart + 26 * 60 * 60 * 1000);
}

export function isPacificCycleExpired(cycleStartedAtMs, ptDateKey = '', nowMs = Date.now()) {
  if (typeof cycleStartedAtMs !== 'number' || !Number.isFinite(cycleStartedAtMs) || cycleStartedAtMs <= 0) {
    return true;
  }
  const safeNow = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  if (safeNow < cycleStartedAtMs) {
    return true;
  }
  const normalizedKey = typeof ptDateKey === 'string' ? ptDateKey.trim() : '';
  if (normalizedKey && normalizedKey !== getPacificDateKey(safeNow)) {
    return true;
  }
  return safeNow >= getNextPacificResetMs(cycleStartedAtMs);
}

export function getBaghdadResetTimeLabel(nextResetMs) {
  const parts = parseZonedParts(BAGHDAD_TIME_FORMATTER, nextResetMs);
  return `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}

export function formatPacificResetCountdown(nowMs = Date.now()) {
  const safeNow = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const nextResetMs = getNextPacificResetMs(safeNow);
  const totalMs = Math.max(0, nextResetMs - safeNow);
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const formatted = [hours, minutes, seconds]
    .map((val) => String(val).padStart(2, '0'))
    .join(':');

  return {
    hours,
    minutes,
    seconds,
    totalMs,
    nextResetMs,
    ptDateKey: getPacificDateKey(safeNow),
    baghdadResetTime: getBaghdadResetTimeLabel(nextResetMs),
    formatted
  };
}

export function calculateExchangeCharCount(userText = '', replyText = '') {
  const userChars = typeof userText === 'string' ? userText.length : 0;
  const replyChars = typeof replyText === 'string' ? replyText.length : 0;
  return Math.max(0, userChars + replyChars);
}
