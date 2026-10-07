import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
  // Dragging the handle upward opens the card to its full content, which is
  // where the long description and the teacher's clip live. A plain tap
  // toggles it too, so it works without a touch screen.
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(false);
  const dragFrom = useRef<number | null>(null);
  const sheetRef = useRef<HTMLElement | null>(null);
  const lastHeight = useRef(0);

  const [showVideo, setShowVideo] = useState(false);
  useEffect(() => {
    if (!expanded) {
      setShowVideo(false);
      return;
    }
    const t = setTimeout(() => setShowVideo(true), 320);
    return () => clearTimeout(t);
  }, [expanded]);

  // Growing the card by animating its height makes the browser re-lay-out
  // everything inside on every frame — with a YouTube embed in there that
  // drops frames on a phone. So the height is applied at once and the card
  // is pushed back down by the difference, then slid to zero: the layout
  // happens once and only a composited transform animates.
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el) return;
    const cap = Math.round(window.innerHeight * 0.94);

    el.style.transition = "none";
    el.style.height = "auto";
    const natural = Math.min(el.scrollHeight, cap);
    el.style.height = `${natural}px`;

    const previous = lastHeight.current;
    lastHeight.current = natural;
    // Nothing to slide from on the first layout — the sheet has its own
    // entrance animation for that.
    if (previous === 0 || previous === natural) {
      el.style.transform = "";
      return;
    }

    el.style.transform = `translateY(${natural - previous}px)`;
    void el.offsetHeight;
    el.style.transition = "transform 300ms cubic-bezier(0.16, 1, 0.3, 1)";
    el.style.transform = "translateY(0)";
  }, [expanded, club.id]);

  useEffect(() => {
    const onResize = () => {
      const el = sheetRef.current;
      if (!el) return;
      el.style.transition = "none";
      el.style.height = "auto";
      const natural = Math.min(el.scrollHeight, Math.round(window.innerHeight * 0.94));
      el.style.height = `${natural}px`;
      lastHeight.current = natural;
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // The drag writes straight to the element. Going through React state here
  // meant re-rendering the whole card — embed included — on every pointer
  // move, which is exactly what felt sticky under the finger.
  const onDragStart = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragFrom.current = e.clientY;
    const el = sheetRef.current;
    if (el) {
      el.style.transition = "none";
      el.classList.add("is-dragging");
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragFrom.current === null) return;
    const el = sheetRef.current;
    if (!el) return;
    const dy = e.clientY - dragFrom.current;
    // Follow the finger, but never further up than a small overshoot.
    const clamped = expandedRef.current ? Math.max(dy, 0) : Math.max(Math.min(dy, 120), -80);
    el.style.transform = `translateY(${clamped}px)`;
  };

  const onDragEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    const from = dragFrom.current;
    dragFrom.current = null;
    const el = sheetRef.current;
    if (el) {
      el.classList.remove("is-dragging");
      el.style.transition = "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)";
      el.style.transform = "translateY(0)";
    }
    if (from === null) return;
    const dy = e.clientY - from;
    const wasExpanded = expandedRef.current;
    let next = wasExpanded;
    if (dy < -40) next = true;
    else if (dy > 60) {
      if (!wasExpanded) {
        onClose();
        return;
      }
      next = false;
    } else next = !wasExpanded;
    expandedRef.current = next;
    setExpanded(next);
  };

  const left = club.seats - club.taken;
  const full = left <= 0;
  const booked = !!bookedRegistrationId;
  const sessionsLeft = pass ? passSessionsLeft(pass) : null;

  return (
    <div className={`sheet-backdrop${closing ? " closing" : ""}`} onClick={onClose} role="presentation">
      <article
        ref={sheetRef}
        className={`sheet club-sheet${expanded ? " expanded" : ""}${closing ? " closing" : ""}`}
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
        <dl className="facts">
          <div>
            <dt>час</dt>
            <dd>
              {club.startTime}–{club.endTime}
            </dd>
          </div>
          <div>
            <dt>тічер</dt>
            <dd>{club.teacher}</dd>
          </div>
          <div>
            <dt>рівень</dt>
            <dd>{club.level}</dd>
          </div>
          <div>
            <dt>місця</dt>
            <dd>
              {club.taken}/{club.seats}
            </dd>
          </div>
        </dl>

        {expanded && club.videoUrl ? (
          <div className="club-video">
            {showVideo ? <ClubVideo url={club.videoUrl} title={club.title} /> : null}
          </div>
        ) : null}

        {booked ? (
          <p className="sheet-note is-booked">ти в ділі ✓</p>
        ) : pass ? (
          <p className="sheet-note">
            в тебе абон «{pass.title}»:{" "}
            {sessionsLeft === null ? "безліміт" : `лишилось ${sessionsLeft}`} — цей клаб
            безкоштовний
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
              <span>{busy ? "скасовуємо…" : "не піду"}</span>
            </button>
          ) : (
            <button className="pay-btn primary" type="button" disabled={full || busy} onClick={() => onPay(club)}>
              {full ? (
                <span>все, місць нема</span>
              ) : (
                <>
                  <span>{busy ? "записуємо…" : "го"}</span>
                  <em>{pass ? "за абоном" : `${club.priceUah} грн`}</em>
                </>
              )}
            </button>
          )}
          <button className="pay-btn secondary" type="button" onClick={onOpenSubscriptions}>
            <span>абонемент</span>
            <em>від {minSubPrice} грн</em>
          </button>
        </div>
      </article>
    </div>
  );
}
