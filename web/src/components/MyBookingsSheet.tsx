import { passSessionsLeft, type MyBooking, type MyPass } from "../lib/api";
import { formatShortDate, formatTimestampDate, hasStarted } from "../lib/dates";

type Props = {
  bookings: MyBooking[];
  passes: MyPass[];
  loading: boolean;
  error: string | null;
  cancellingId: string | null;
  closing: boolean;
  onClose: () => void;
  onCancel: (booking: MyBooking) => void;
};

export function MyBookingsSheet({
  bookings,
  passes,
  loading,
  error,
  cancellingId,
  closing,
  onClose,
  onCancel,
}: Props) {
  const withClub = bookings.filter((b) => b.club);
  const upcoming = withClub
    .filter((b) => !hasStarted(b.club!.date, b.club!.startTime))
    .sort((a, b) => (a.club!.date + a.club!.startTime).localeCompare(b.club!.date + b.club!.startTime));
  const past = withClub
    .filter((b) => hasStarted(b.club!.date, b.club!.startTime))
    .sort((a, b) => (b.club!.date + b.club!.startTime).localeCompare(a.club!.date + a.club!.startTime));

  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article className={`sheet${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <header>
          <h2>Мої записи</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </header>

        {error ? <p className="form-error">{error}</p> : null}

        {loading ? (
          <p className="sheet-desc">Завантаження…</p>
        ) : (
          <>
            {passes.length ? (
              <section className="mine-section">
                <h3>Абонементи</h3>
                <ul className="mine-list">
                  {passes.map((pass) => {
                    const left = passSessionsLeft(pass);
                    return (
                      <li key={pass.id} className="pass-card">
                        <div className="pass-top">
                          <strong>{pass.title}</strong>
                          <em>{left === null ? "Безліміт" : `${left} з ${pass.sessionsTotal}`}</em>
                        </div>
                        <p className="pass-meta">Діє до {formatTimestampDate(pass.expiresAt)}</p>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            <section className="mine-section">
              <h3>Найближчі клаби</h3>
              {upcoming.length ? (
                <ul className="mine-list">
                  {upcoming.map((booking) => (
                    <li key={booking.id} className="mine-row">
                      <i className="stripe" style={{ background: booking.club!.color }} />
                      <div className="mine-row-info">
                        <strong>{booking.club!.title}</strong>
                        <span>
                          {formatShortDate(booking.club!.date)} · {booking.club!.startTime}–
                          {booking.club!.endTime}
                        </span>
                        <span>
                          {booking.club!.teacher} ·{" "}
                          {booking.paidWith === "subscription"
                            ? "абонемент"
                            : `${booking.pricePaidUah ?? 0} ₴`}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="mine-cancel-btn"
                        disabled={cancellingId === booking.id}
                        onClick={() => onCancel(booking)}
                      >
                        {cancellingId === booking.id ? "…" : "Скасувати"}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sheet-desc">Ви ще не записані на жоден клаб.</p>
              )}
            </section>

            {past.length ? (
              <section className="mine-section">
                <h3>Минулі</h3>
                <ul className="mine-list">
                  {past.map((booking) => (
                    <li key={booking.id} className="mine-row is-past">
                      <i className="stripe" style={{ background: booking.club!.color }} />
                      <div className="mine-row-info">
                        <strong>{booking.club!.title}</strong>
                        <span>
                          {formatShortDate(booking.club!.date)} · {booking.club!.startTime}–
                          {booking.club!.endTime}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        )}
      </article>
    </div>
  );
}
