import { useMemo, useState } from "react";
import { clubs as seed, type Club } from "./data/clubs";
import { subscriptions, type Subscription } from "./data/subscriptions";
import { Calendar } from "./components/Calendar";
import { ClubList } from "./components/ClubList";
import { ClubSheet } from "./components/ClubSheet";
import { SubscriptionsSheet } from "./components/SubscriptionsSheet";
import { formatDayTitle, isoDate, monthTitle } from "./lib/dates";

export function App() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState(
    isoDate(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const [open, setOpen] = useState<Club | null>(null);
  const [subsOpen, setSubsOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
    setNotice(
      `Оплата через Monobank буде підключена далі. Клаб «${club.title}» — ${club.priceUah} ₴.`,
    );
  };

  const onBuySub = (sub: Subscription) => {
    setSubsOpen(false);
    setNotice(
      `Оплата через Monobank буде підключена далі. Абонемент «${sub.title}» — ${sub.priceUah} ₴.`,
    );
  };

  return (
    <main className="app">
      <header className="top">
        <div className="top-row">
          <p className="eyebrow">English School</p>
          <button type="button" className="subs-btn" onClick={() => setSubsOpen(true)}>
            Абонементи
          </button>
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
        <h2>{formatDayTitle(selected)}</h2>
        <ClubList clubs={dayClubs} onOpen={setOpen} />
      </section>

      {open ? <ClubSheet club={open} onClose={() => setOpen(null)} onPay={onPay} /> : null}
      {subsOpen ? (
        <SubscriptionsSheet
          subscriptions={subscriptions}
          onClose={() => setSubsOpen(false)}
          onBuy={onBuySub}
        />
      ) : null}
      {notice ? (
        <div className="toast" role="status">
          {notice}
          <button type="button" onClick={() => setNotice(null)}>
            OK
          </button>
        </div>
      ) : null}
    </main>
  );
}
