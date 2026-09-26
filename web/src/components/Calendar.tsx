import { Club } from "../data/clubs";
import { daysInMonth, isoDate, startOffset, weekdayLabels } from "../lib/dates";

type Props = {
  year: number;
  month: number;
  selected: string;
  clubs: Club[];
  onSelect: (iso: string) => void;
};

export function Calendar({ year, month, selected, clubs, onSelect }: Props) {
  const offset = startOffset(year, month);
  const total = daysInMonth(year, month);
  const cells = Array.from({ length: offset + total }, (_, i) =>
    i < offset ? null : i - offset + 1,
  );
  const today = new Date();
  const todayIso = isoDate(today.getFullYear(), today.getMonth(), today.getDate());

  const colorsByDay = new Map<string, string[]>();
  for (const club of clubs) {
    const list = colorsByDay.get(club.date) ?? [];
    if (!list.includes(club.color)) list.push(club.color);
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
          return (
            <button
              key={iso}
              className={`cell${isSelected ? " selected" : ""}${isToday ? " today" : ""}`}
              onClick={() => onSelect(iso)}
              type="button"
            >
              <span className="num">{day}</span>
              <span className="dots">
                {dots.slice(0, 3).map((c) => (
                  <i key={c} style={{ background: c }} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
