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
