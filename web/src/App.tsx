import { useEffect, useMemo, useState } from "react";
import { type Club } from "./data/clubs";
import { type Subscription } from "./data/subscriptions";
import { AdminPanel } from "./components/AdminPanel";
import { Calendar } from "./components/Calendar";
import { ClubForm } from "./components/ClubForm";
import { ClubList } from "./components/ClubList";
import { ClubSheet } from "./components/ClubSheet";
import { PaymentSuccessSheet } from "./components/PaymentSuccessSheet";
import { SubscriptionsSheet } from "./components/SubscriptionsSheet";
import { ThemeToggle } from "./components/ThemeToggle";
import { deleteClub, saveClub } from "./lib/adminApi";
import { formatDayTitle, isoDate, monthTitle } from "./lib/dates";
import { fetchClubs, fetchSubscriptions, purchaseSubscription, registerForClub } from "./lib/supabase";
import { confirmDialog, getTelegramUserId, isAdmin } from "./lib/telegram";
import { useBodyScrollLock } from "./lib/useBodyScrollLock";
import { usePresence } from "./lib/usePresence";

type SuccessInfo = { title: string; subtitle: string; priceUah: number };

function blankClub(): Club {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    title: "",
    description: "",
    date: isoDate(now.getFullYear(), now.getMonth(), now.getDate()),
    startTime: "10:00",
    endTime: "11:00",
    teacher: "",
    level: "",
    seats: 10,
    taken: 0,
    priceUah: 0,
    color: "#E85D4C",
  };
}

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

  const [clubs, setClubs] = useState<Club[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);

  const reloadClubs = () => fetchClubs().then(setClubs).catch((err) => console.error("failed to load clubs", err));

  useEffect(() => {
    Promise.all([
      fetchClubs().then(setClubs),
      fetchSubscriptions().then(setSubscriptions),
    ])
      .catch((err) => console.error("failed to load data", err))
      .finally(() => setLoading(false));
  }, []);

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

  const [adminOpen, setAdminOpen] = useState(false);
  const [editingClub, setEditingClub] = useState<Club | null>(null);
  const [editingIsNew, setEditingIsNew] = useState(false);
  const [adminSaving, setAdminSaving] = useState(false);
  const [adminError, setAdminError] = useState<string | null>(null);
  const adminPresence = usePresence(adminOpen);
  const [shownEditingClub, setShownEditingClub] = useState<Club | null>(null);
  useEffect(() => {
    if (editingClub) setShownEditingClub(editingClub);
  }, [editingClub]);
  const formPresence = usePresence(!!editingClub);

  useBodyScrollLock(clubPresence.rendered || subsPresence.rendered || successPresence.rendered || adminPresence.rendered || formPresence.rendered);

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const dayClubs = useMemo(
    () => clubs.filter((c) => c.date === selected).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [clubs, selected],
  );

  const onPay = (club: Club) => {
    setOpen(null);
    const telegramUserId = getTelegramUserId();
    if (telegramUserId) {
      registerForClub(club.id, telegramUserId)
        .then(reloadClubs)
        .catch((err) => console.warn("registration failed", err));
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
      purchaseSubscription(sub.id, telegramUserId).catch((err) =>
        console.warn("subscription purchase failed", err),
      );
    }
    setSuccess({ title: sub.title, subtitle: sub.sessions, priceUah: sub.priceUah });
  };

  const onOpenSubscriptions = () => {
    setOpen(null);
    setSubsOpen(true);
  };

  const onAdminAddNew = () => {
    setAdminError(null);
    setEditingIsNew(true);
    setEditingClub(blankClub());
  };

  const onAdminEdit = (club: Club) => {
    setAdminError(null);
    setEditingIsNew(false);
    setEditingClub(club);
  };

  const onAdminDelete = async (club: Club) => {
    const warning = club.taken > 0 ? ` Разом із ним буде видалено ${club.taken} записів.` : "";
    const confirmed = await confirmDialog(`Видалити «${club.title}»?${warning}`);
    if (!confirmed) return;
    setAdminError(null);
    try {
      await deleteClub(club.id);
      await reloadClubs();
    } catch (err) {
      setAdminError(String(err));
    }
  };

  const onSaveClub = async (club: Club) => {
    setAdminSaving(true);
    setAdminError(null);
    try {
      await saveClub(club);
      setEditingClub(null);
      await reloadClubs();
    } catch (err) {
      setAdminError(String(err));
    } finally {
      setAdminSaving(false);
    }
  };

  return (
    <main className="app">
      <header className="top">
        <div className="top-row">
          <p className="eyebrow">English School</p>
          <div className="top-row-actions">
            {isAdmin() ? (
              <button
                type="button"
                className="theme-btn admin-btn"
                onClick={() => setAdminOpen(true)}
                aria-label="Адмін-панель"
              >
                ⚙
              </button>
            ) : null}
            <ThemeToggle />
          </div>
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
        clubs={clubs}
        onSelect={setSelected}
      />

      <section className="day-block">
        <div key={selected} className="day-content">
          <h2>{formatDayTitle(selected)}</h2>
          {loading ? (
            <div className="empty-day">
              <p>Завантаження…</p>
            </div>
          ) : (
            <ClubList clubs={dayClubs} onOpen={setOpen} />
          )}
        </div>
      </section>

      {clubPresence.rendered && shownClub ? (
        <ClubSheet
          club={shownClub}
          closing={clubPresence.closing}
          onClose={() => setOpen(null)}
          onPay={onPay}
          onOpenSubscriptions={onOpenSubscriptions}
          minSubPrice={subscriptions.length ? Math.min(...subscriptions.map((s) => s.priceUah)) : 0}
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
      {adminPresence.rendered ? (
        <AdminPanel
          clubs={clubs}
          closing={adminPresence.closing}
          error={adminError}
          onClose={() => setAdminOpen(false)}
          onAddNew={onAdminAddNew}
          onEdit={onAdminEdit}
          onDelete={onAdminDelete}
        />
      ) : null}
      {formPresence.rendered && shownEditingClub ? (
        <ClubForm
          initial={shownEditingClub}
          isNew={editingIsNew}
          closing={formPresence.closing}
          saving={adminSaving}
          error={adminError}
          onClose={() => setEditingClub(null)}
          onSave={onSaveClub}
        />
      ) : null}
    </main>
  );
}
