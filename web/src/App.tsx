import { useEffect, useMemo, useState } from "react";
import { clubs as seed, type Club } from "./data/clubs";
import { subscriptions, type Subscription } from "./data/subscriptions";
import { Calendar } from "./components/Calendar";
import { ClubList } from "./components/ClubList";
import { ClubSheet } from "./components/ClubSheet";
import { PaymentSuccessSheet } from "./components/PaymentSuccessSheet";
import { SubscriptionsSheet } from "./components/SubscriptionsSheet";
import { ThemeToggle } from "./components/ThemeToggle";
import { postJSON } from "./lib/api";
import { formatDayTitle, isoDate, monthTitle } from "./lib/dates";
import { getTelegramUserId } from "./lib/telegram";
import { usePresence } from "./lib/usePresence";

type SuccessInfo = { title: string; subtitle: string; priceUah: number };

export function App() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(
    isoDate(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const [open, setOpen] = useState<Club | null>(null);
  const [subsOpen, setSubsOpen] = useState(false);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);

  const [shownClub, setShownClub] = useState<Club | null>(null);
  useEffect(() => {
    if (open) setShownClub(open);
  }, [open]);
  const [shownSuccess, setShownSuccess] = useState<SuccessInfo | null>(null);
  useEffect(() => {
    if (success) setShownSuccess(success);
  }, [success]);
  const clubPresence = usePresence(!!open);
  const subsPresence = usePresence(subsOpen);
  const successPresence = usePresence(!!success);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const dayClubs = useMemo(
    () => seed.filter((c) => c.date === selected).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [selected],
  );

  const onPay = (club: Club) => {
    setOpen(null);
    const telegramUserId = getTelegramUserId();
    if (telegramUserId) {
      postJSON("/registrations", { clubId: club.id, telegramUserId }).catch((err) =>
        console.warn("registration failed", err),
      );
    }
    setSuccess({
      title: club.title,
      subtitle: `${club.date} · ${club.startTime}–${club.endTime} · ${club.teacher}`,
      priceUah: club.priceUah,
    });
  };

  const onBuySub = (sub: Subscription) => {
    setSubsOpen(false);
    const telegramUserId = getTelegramUserId();
    if (telegramUserId) {
      postJSON("/subscriptions/purchase", { subscriptionId: sub.id, telegramUserId }).catch((err) =>
        console.warn("subscription purchase failed", err),
      );
    }
    setSuccess({ title: sub.title, subtitle: sub.sessions, priceUah: sub.priceUah });
  };

  const onOpenSubscriptions = () => {
    setOpen(null);
    setSubsOpen(true);
  };

  return (
    <main className="app">
      <header className="top">
        <div className="top-row">
          <p className="eyebrow">English School</p>
          <ThemeToggle />
        </div>
        <h1>Календар клабів</h1>
        <div className="month-nav">
          <button type="button" onClick={() => shiftMonth(-1)} aria-label="Попередній місяць">
            ‹
          </button>
          <span>{monthTitle(year, month)}</span>
          <button type="button" onClick={() => shiftMonth(1)} aria-label="Наступний місяць">
            ›
          </button>
        </div>
      </header>

      <Calendar
        year={year}
        month={month}
        selected={selected}
        clubs={seed}
        onSelect={setSelected}
      />

      <section className="day-block">
        <div key={selected} className="day-content">
          <h2>{formatDayTitle(selected)}</h2>
          <ClubList clubs={dayClubs} onOpen={setOpen} />
        </div>
      </section>

      {clubPresence.rendered && shownClub ? (
        <ClubSheet
          club={shownClub}
          closing={clubPresence.closing}
          onClose={() => setOpen(null)}
          onPay={onPay}
          onOpenSubscriptions={onOpenSubscriptions}
          minSubPrice={Math.min(...subscriptions.map((s) => s.priceUah))}
        />
      ) : null}
      {subsPresence.rendered ? (
        <SubscriptionsSheet
          subscriptions={subscriptions}
          closing={subsPresence.closing}
          onClose={() => setSubsOpen(false)}
          onBuy={onBuySub}
        />
      ) : null}
      {successPresence.rendered && shownSuccess ? (
        <PaymentSuccessSheet
          title={shownSuccess.title}
          subtitle={shownSuccess.subtitle}
          priceUah={shownSuccess.priceUah}
          closing={successPresence.closing}
          onClose={() => setSuccess(null)}
        />
      ) : null}
    </main>
  );
}
