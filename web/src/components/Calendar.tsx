import { Club } from "../data/clubs";
import { daysInMonth, isoDate, startOffset, weekdayLabels } from "../lib/dates";

type Props = {
  year: number;
  month: number;
  selected: string;
  clubs: Club[];
  bookedDates: Set<string>;
  onSelect: (iso: string) => void;
};

export function Calendar({ year, month, selected, clubs, bookedDates, onSelect }: Props) {
  const offset = startOffset(year, month);
  const total = daysInMonth(year, month);
  const cells = Array.from({ length: offset + total }, (_, i) =>
    i < offset ? null : i - offset + 1,
  );
  const today = new Date();
  const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate());

  // One dot per club, not per distinct colour: three clubs that happen to share
  // two colours must still show three dots.
  const colorsByDay = new Map<string, string[]>();
  for (const club of clubs) {
    const list = colorsByDay.get(club.date) ?? [];
    list.push(club.color);
    colorsByDay.set(club.date, list);
  }

  return (
    <section className="calendar">
      <div className="weekdays">
        {weekdayLabels().map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid" key={`${year}-${month}`}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} className="cell empty" />;
          const iso = isoDate(year, month, day);
          const dots = colorsByDay.get(iso) ?? [];
          const isSelected = iso === selected;
          const isToday = iso === todayIso;
          const isBooked = bookedDates.has(iso);
          return (
            <button
              key={iso}
              className={`cell${isSelected ? " selected" : ""}${isToday ? " today" : ""}${
                isBooked ? " booked" : ""
              }`}
              onClick={() => onSelect(iso)}
              type="button"
            >
              <span className="num">{day}</span>
              <span className="dots">
                {dots.slice(0, 3).map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
