import type { Club } from "../data/clubs";
import { PeopleIcon } from "./Icons";

type Props = {
  clubs: Club[];
  closing: boolean;
  error: string | null;
  onClose: () => void;
  onAddNew: () => void;
  onEdit: (club: Club) => void;
  onDelete: (club: Club) => void;
  onShowRegistrations: (club: Club) => void;
};

export function AdminPanel({
  clubs,
  closing,
  error,
  onClose,
  onAddNew,
  onEdit,
  onDelete,
  onShowRegistrations,
}: Props) {
  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article className={`sheet${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <header>
          <h2>Адмін · Клаби</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </header>

        <button type="button" className="pay-btn admin-add-btn" onClick={onAddNew}>
          + Новий клаб
        </button>

        {error ? <p className="form-error">{error}</p> : null}

        <ul className="admin-list">
          {clubs.map((club) => (
            <li key={club.id} className="admin-row">
              <div className="admin-row-info">
                <strong>{club.title}</strong>
                <span>
                  {club.date} · {club.startTime}–{club.endTime} · {club.taken}/{club.seats}
                </span>
              </div>
              <div className="admin-row-actions">
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => onShowRegistrations(club)}
                  aria-label="Хто записався"
                >
                  <PeopleIcon width={18} height={18} />
                </button>
                <button type="button" className="icon-btn" onClick={() => onEdit(club)} aria-label="Редагувати">
                  ✎
                </button>
                <button
                  type="button"
                  className="icon-btn admin-delete-btn"
                  onClick={() => onDelete(club)}
                  aria-label="Видалити"
                >
                  🗑
                </button>
              </div>
            </li>
          ))}
        </ul>
      </article>
    </div>
  );
}
