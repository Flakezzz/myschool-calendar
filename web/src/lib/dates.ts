const MONTHS_UK = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];

// Genitive case — "10 жовтня", not "10 Жовтень".
const MONTHS_UK_GENITIVE = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Нд"];

export function monthTitle(year: number, month: number) {
  return `${MONTHS_UK[month]} ${year}`;
}

export function isoDate(year: number, month: number, day: number) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

export function weekdayLabels() {
  return WEEKDAYS;
}

export function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/** Monday-first offset */
export function startOffset(year: number, month: number) {
  const js = new Date(year, month, 1).getDay();
  return (js + 6) % 7;
}

/** "2026-10-10" -> "10 жовтня" */
export function formatShortDate(iso: string) {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS_UK_GENITIVE[m - 1]}`;
}

/** A club's start as a local Date. Dates and times are stored naive and
 * meant as Kyiv local time, which is also the phone's timezone here. */
export function clubStart(date: string, startTime: string) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = startTime.split(":").map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

export function hasStarted(date: string, startTime: string) {
  return clubStart(date, startTime).getTime() <= Date.now();
}

/** "2026-11-02T10:00:00+00:00" -> "2 листопада" */
export function formatTimestampDate(ts: string) {
  const date = new Date(ts);
  return `${date.getDate()} ${MONTHS_UK_GENITIVE[date.getMonth()]}`;
}

export function formatDayTitle(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const weekday = [
    "Неділя",
    "Понеділок",
    "Вівторок",
    "Середа",
    "Четвер",
    "П’ятниця",
    "Субота",
  ][date.getDay()];
  return `${weekday}, ${d} ${MONTHS_UK[m - 1].toLowerCase()}`;
}
