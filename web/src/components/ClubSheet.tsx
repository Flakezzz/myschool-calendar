import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Club } from "../data/clubs";
import { ShareIcon } from "./Icons";
import { ClubVideo } from "./ClubVideo";
import { passSessionsLeft, type MyPass } from "../lib/api";

type Props = {
  club: Club;
  closing: boolean;
  /** Set when the current user already has a booking for this club. */
  bookedRegistrationId: string | null;
  /** The pass this booking would spend, if the user has one with sessions left. */
  pass: MyPass | null;
  busy: boolean;
  onClose: () => void;
  onPay: (club: Club) => void;
  onCancel: (registrationId: string) => void;
  onOpenSubscriptions: () => void;
  onShare: (club: Club) => void;
  minSubPrice: number;
};

export function ClubSheet({
  club,
  closing,
  bookedRegistrationId,
  pass,
  busy,
  onClose,
  onPay,
  onCancel,
  onOpenSubscriptions,
  onShare,
  minSubPrice,
}: Props) {
  // Dragging the handle upward opens the sheet full height, which is where
  // the long description and the teacher's clip live. A plain tap toggles it
  // too, so it works without a touch screen.
  const [expanded, setExpanded] = useState(false);
  const [dragY, setDragY] = useState(0);
  const dragFrom = useRef<number | null>(null);

  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragFrom.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragFrom.current === null) return;
    const dy = e.clientY - dragFrom.current;
    // Follow the finger, but never further up than a small overshoot.
    setDragY(expanded ? Math.max(dy, 0) : Math.max(Math.min(dy, 120), -80));
  };

  const onDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    setDragY(0);
    if (from === null) return;
    const dy = e.clientY - from;
    if (dy < -40) setExpanded(true);
    else if (dy > 60) (expanded ? setExpanded(false) : onClose());
    else setExpanded((v) => !v);
  };

  const left = club.seats - club.taken;
  const full = left <= 0;
  const booked = !!bookedRegistrationId;
  const sessionsLeft = pass ? passSessionsLeft(pass) : null;

  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article
        className={`sheet club-sheet${expanded ? " expanded" : ""}${closing ? " closing" : ""}`}
        style={dragY ? { transform: `translateY(${dragY}px)` } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="sheet-grab"
          role="presentation"
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          <div className="sheet-handle" />
        </div>
        <header>
          <h2>{club.title}</h2>
          <div className="sheet-head-actions">
            <button
              className="icon-btn"
              type="button"
              onClick={() => onShare(club)}
              aria-label="Поділитись клабом"
            >
              <ShareIcon width={18} height={18} />
            </button>
            <button className="icon-btn" type="button" onClick={onClose} aria-label="Закрити">
              ✕
            </button>
          </div>
        </header>
        <p className={`sheet-desc${expanded ? " is-full" : ""}`}>{club.description}</p>

        {expanded && club.videoUrl ? <ClubVideo url={club.videoUrl} title={club.title} /> : null}
        <dl className="facts">
          <div>
            <dt>Час</dt>
            <dd>
              {club.startTime}–{club.endTime}
            </dd>
          </div>
          <div>
            <dt>Викладач</dt>
            <dd>{club.teacher}</dd>
          </div>
          <div>
            <dt>Рівень</dt>
            <dd>{club.level}</dd>
          </div>
          <div>
            <dt>Місця</dt>
            <dd>
              {club.taken}/{club.seats}
            </dd>
          </div>
        </dl>

        {booked ? (
          <p className="sheet-note is-booked">✓ Ви записані на цей клаб</p>
        ) : pass ? (
          <p className="sheet-note">
            Ваш абонемент «{pass.title}»:{" "}
            {sessionsLeft === null ? "безліміт" : `залишилось ${sessionsLeft}`} — цей запис буде
            безкоштовним.
          </p>
        ) : null}

        <div className="sheet-actions">
          {booked ? (
            <button
              className="pay-btn danger"
              type="button"
              disabled={busy}
              onClick={() => onCancel(bookedRegistrationId!)}
            >
              <span>{busy ? "Скасовуємо…" : "Скасувати запис"}</span>
            </button>
          ) : (
            <button className="pay-btn primary" type="button" disabled={full || busy} onClick={() => onPay(club)}>
              {full ? (
                <span>Немає місць</span>
              ) : (
                <>
                  <span>{busy ? "Записуємо…" : "Записатись"}</span>
                  <em>{pass ? "за абонементом" : `${club.priceUah} ₴`}</em>
                </>
              )}
            </button>
          )}
          <button className="pay-btn secondary" type="button" onClick={onOpenSubscriptions}>
            <span>Абонемент</span>
            <em>від {minSubPrice} ₴</em>
          </button>
        </div>
      </article>
    </div>
  );
}
