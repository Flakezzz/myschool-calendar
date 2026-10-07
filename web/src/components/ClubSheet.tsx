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

/** The card is this much taller than it looks: the extra sits below the
 * screen so lifting the card never uncovers the backdrop. Keep in step with
 * --sheet-skirt in the stylesheet. */
const SKIRT = 140;

  // Both heights are worked out once, while the card is still closed and
  // nothing is moving. Measuring costs a forced re-layout, and doing that on
  // every toggle — with a YouTube embed already inside — is what made the
  // card lag. Afterwards a toggle is one number and a slide, no measuring.
  const heights = useRef({ collapsed: 0, expanded: 0 });

  const measureBoth = () => {
    const el = sheetRef.current;
    if (!el) return;
    const cap = Math.round(window.innerHeight * 0.94) + SKIRT;
    const wasExpanded = el.classList.contains("expanded");

    el.style.transition = "none";
    el.classList.remove("expanded");
    el.style.height = "auto";
    const collapsed = el.scrollHeight;

    el.classList.add("expanded");
    el.style.height = "auto";
    const expandedHeight = Math.min(el.scrollHeight, cap);

    if (!wasExpanded) el.classList.remove("expanded");
    heights.current = { collapsed, expanded: expandedHeight };
    const target = wasExpanded ? expandedHeight : collapsed;
    el.style.height = `${target}px`;
    lastHeight.current = target;
  };

  useLayoutEffect(measureBoth, [club.id]);

  useEffect(() => {
    window.addEventListener("resize", measureBoth);
    return () => window.removeEventListener("resize", measureBoth);
  }, []);

  // Growing by animating height re-lays-out everything inside on every frame.
  // Instead the height is applied in one write and the card is pushed back
  // down by the difference, then slid to zero: one layout, then a composited
  // transform the GPU can carry.
  useLayoutEffect(() => {
    const el = sheetRef.current;
    if (!el || heights.current.expanded === 0) return;
    const target = expanded ? heights.current.expanded : heights.current.collapsed;
    const previous = lastHeight.current;
    lastHeight.current = target;
    if (previous === 0 || previous === target) return;

    el.style.transition = "none";
    el.style.height = `${target}px`;
    // Shrinking lifts the card; going up further than the hidden tail would
    // show the backdrop underneath, so the slide starts no higher than that.
    const shift = Math.max(target - previous, -SKIRT);
    el.style.transform = `translateY(${shift}px)`;
    void el.offsetHeight;
    el.style.transition = "transform 300ms cubic-bezier(0.16, 1, 0.3, 1)";
    el.style.transform = "translateY(0)";
  }, [expanded]);

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

        {club.videoUrl ? (
          <div className="club-video">
            <ClubVideo url={club.videoUrl} title={club.title} />
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
