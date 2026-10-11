import { passSessionsLeft, type MyBooking, type MyPass } from "../lib/api";
import { formatShortDate, formatTimestampDate, hasStarted } from "../lib/dates";
import { QuestionIcon } from "./Icons";

type Props = {
  bookings: MyBooking[];
  passes: MyPass[];
  loading: boolean;
  error: string | null;
  closing: boolean;
  onClose: () => void;
  /** Tapping a row opens that club's card, where "не піду" lives now. */
  onOpenClub: (booking: MyBooking) => void;
  onOpenFaq: () => void;
};

export function MyBookingsSheet({
  bookings,
  passes,
  loading,
  error,
  closing,
  onClose,
  onOpenClub,
  onOpenFaq,
}: Props) {
  // Only what is still ahead: the client asked for the "вже минули" list to
  // go, so a finished club simply drops off this screen.
  const upcoming = bookings
    .filter((b) => b.club && !hasStarted(b.club.date, b.club.startTime))
    .sort((a, b) => (a.club!.date + a.club!.startTime).localeCompare(b.club!.date + b.club!.startTime));

  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article className={`sheet${closing ? " closing" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <header>
          <h2>Мої клаби</h2>
          <div className="sheet-head-actions">
            <button
              className="icon-btn faq-btn"
              type="button"
              onClick={onOpenFaq}
              aria-label="Часті питання"
            >
              <QuestionIcon width={18} height={18} />
            </button>
            <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрити">
              ✕
            </button>
          </div>
        </header>

        {error ? <p className="form-error">{error}</p> : null}

        {loading ? (
          <p className="sheet-desc">завантажуємо…</p>
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
                          <em>
                            {left === null ? "безліміт" : `${left} з ${pass.sessionsTotal}`}
                          </em>
                        </div>
                        <p className="pass-meta">діє до {formatTimestampDate(pass.expiresAt)}</p>
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
                    <li key={booking.id}>
                      <button
                        type="button"
                        className="mine-row"
                        onClick={() => onOpenClub(booking)}
                      >
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
                              : `${booking.pricePaidUah ?? 0} грн`}
                          </span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="sheet-desc">ще нікуди не записався, саме час</p>
              )}
            </section>

          </>
        )}
      </article>
    </div>
  );
}
