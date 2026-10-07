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
  // Numbers are kept as text while typing so the field can be genuinely
  // empty — a bound 0 is impossible to clear and has to be selected first.
  const [seatsText, setSeatsText] = useState(isNew ? "" : String(initial.seats));
  const [priceText, setPriceText] = useState(isNew ? "" : String(initial.priceUah));

  const onNumber = (
    raw: string,
    setText: (v: string) => void,
    key: "seats" | "priceUah",
  ) => {
    const digits = raw.replace(/[^0-9]/g, "");
    setText(digits);
    set(key, digits === "" ? 0 : Number(digits));
  };

  const set = <K extends keyof Club>(key: K, value: Club[K]) => setClub((c) => ({ ...c, [key]: value }));

  const canSave =
    priceText !== "" &&
    seatsText !== "" &&
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
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="10"
                value={seatsText}
                onChange={(e) => onNumber(e.target.value, setSeatsText, "seats")}
                required
              />
            </label>
            <label>
              Ціна, грн
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                placeholder="300"
                value={priceText}
                onChange={(e) => onNumber(e.target.value, setPriceText, "priceUah")}
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
            <small className="field-hint">прийде учасникам за годину до уроку</small>
          </label>
          <label>
            Відео від тічера
            <input
              type="url"
              inputMode="url"
              placeholder="кидай лінк на відео"
              value={club.videoUrl ?? ""}
              onChange={(e) => set("videoUrl", e.target.value)}
            />
            <small className="field-hint">
              ютуб, гугл драйв або пряме посилання на mp4 / webm / mov — покажемо в описі клаба
            </small>
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
