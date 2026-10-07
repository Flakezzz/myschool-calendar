import { useState } from "react";
import type { Club } from "../data/clubs";

type Props = {
  initial: Club;
  isNew: boolean;
  closing: boolean;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (club: Club) => void;
};

const COLORS = ["#E85D4C", "#3BA99C", "#E8B86D", "#1B4D6E", "#8E5FD1"];

export function ClubForm({ initial, isNew, closing, saving, error, onClose, onSave }: Props) {
  const [club, setClub] = useState<Club>(initial);

  const set = <K extends keyof Club>(key: K, value: Club[K]) => setClub((c) => ({ ...c, [key]: value }));

  const canSave =
    club.title.trim() &&
    club.date &&
    club.startTime &&
    club.endTime &&
    club.teacher.trim() &&
    club.seats > 0 &&
    club.priceUah >= 0;

  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article className={`sheet${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <header>
          <h2>{isNew ? "Новий клаб" : "Редагувати клаб"}</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </header>

        <form
          className="club-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) onSave(club);
          }}
        >
          <label>
            Назва
            <input value={club.title} onChange={(e) => set("title", e.target.value)} required />
          </label>
          <label>
            Опис
            <textarea value={club.description} onChange={(e) => set("description", e.target.value)} rows={2} />
          </label>
          <div className="form-row">
            <label>
              Дата
              <input type="date" value={club.date} onChange={(e) => set("date", e.target.value)} required />
            </label>
            <label>
              Рівень
              <input value={club.level} onChange={(e) => set("level", e.target.value)} />
            </label>
          </div>
          <div className="form-row">
            <label>
              Початок
              <input type="time" value={club.startTime} onChange={(e) => set("startTime", e.target.value)} required />
            </label>
            <label>
              Кінець
              <input type="time" value={club.endTime} onChange={(e) => set("endTime", e.target.value)} required />
            </label>
          </div>
          <label>
            Викладач
            <input value={club.teacher} onChange={(e) => set("teacher", e.target.value)} required />
          </label>
          <div className="form-row">
            <label>
              Місць
              <input
                type="number"
                min={1}
                value={club.seats}
                onChange={(e) => set("seats", Number(e.target.value))}
                required
              />
            </label>
            <label>
              Ціна, ₴
              <input
                type="number"
                min={0}
                value={club.priceUah}
                onChange={(e) => set("priceUah", Number(e.target.value))}
                required
              />
            </label>
          </div>
          <label>
            Колір
            <div className="color-picker">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch${club.color === c ? " is-selected" : ""}`}
                  style={{ background: c }}
                  onClick={() => set("color", c)}
                  aria-label={c}
                />
              ))}
            </div>
          </label>

          <label>
            Посилання на зустріч
            <input
              type="url"
              inputMode="url"
              placeholder="https://meet.google.com/..."
              value={club.meetingUrl ?? ""}
              onChange={(e) => set("meetingUrl", e.target.value)}
            />
          </label>
          <label>
            Відео від викладача
            <input
              type="url"
              inputMode="url"
              placeholder="YouTube або пряме посилання на файл"
              value={club.videoUrl ?? ""}
              onChange={(e) => set("videoUrl", e.target.value)}
            />
          </label>

          {error ? <p className="form-error">{error}</p> : null}

          <button type="submit" className="pay-btn" disabled={!canSave || saving}>
            {saving ? "Збереження…" : "Зберегти"}
          </button>
        </form>
      </article>
    </div>
  );
}
