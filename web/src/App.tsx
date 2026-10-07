import { useEffect, useMemo, useRef, useState } from "react";
import { type Club } from "./data/clubs";
import { type Subscription } from "./data/subscriptions";
import { AdminPanel } from "./components/AdminPanel";
import { Calendar } from "./components/Calendar";
import { ClubForm } from "./components/ClubForm";
import { ClubList } from "./components/ClubList";
import { ClubRegistrationsSheet } from "./components/ClubRegistrationsSheet";
import { ClubSheet } from "./components/ClubSheet";
import { FaqSheet } from "./components/FaqSheet";
import { TicketIcon } from "./components/Icons";
import { MyBookingsSheet } from "./components/MyBookingsSheet";
import { PaymentSuccessSheet } from "./components/PaymentSuccessSheet";
import { SubscriptionsSheet } from "./components/SubscriptionsSheet";
import { ThemeToggle } from "./components/ThemeToggle";
import {
  ApiError,
  bookClub,
  buySubscription,
  cancelBooking,
  deleteClub,
  fetchClubRegistrations,
  fetchIsAdmin,
  fetchMine,
  nextPass,
  saveClub,
  type ClubRegistration,
  type Mine,
  type MyBooking,
} from "./lib/api";
import { formatDayTitle, formatShortDate, isoDate, monthTitle } from "./lib/dates";
import { fetchClubs, fetchSubscriptions } from "./lib/supabase";
import {
  confirmCancelBooking,
  confirmDialog,
  getStartParam,
  getTelegramUserId,
  isFallbackAdmin,
  shareClub,
} from "./lib/telegram";
import { useBodyScrollLock } from "./lib/useBodyScrollLock";
import { usePresence } from "./lib/usePresence";

type SuccessInfo = {
  heading?: string;
  title: string;
  subtitle: string;
  calm?: string;
  note?: string;
  priceUah?: number;
  failed?: boolean;
  renewPass?: boolean;
};

const EMPTY_MINE: Mine = { bookings: [], passes: [] };

// The database raises these on purpose; everything else is unexpected.
const ERROR_TEXT: Record<string, string> = {
  already_booked: "ти вже тут записаний",
  club_full: "місця щойно закінчились",
  club_not_found: "цього клаба більше немає",
  club_already_started: "клаб уже почався, скасувати не вийде",
  booking_not_found: "не знайшли такого запису",
  subscription_not_found: "такого абона більше немає",
  already_has_pass: "в тебе вже є активний абон, новий можна взяти як цей скінчиться",
  unauthorized: "відкрий через телеграм",
  forbidden: "немає доступу",
  admin_session_expired: "Сесія адміна застаріла. Закрийте застосунок і відкрийте знову.",
};

function errorText(err: unknown): string {
  const code = err instanceof ApiError ? err.code : "";
  return ERROR_TEXT[code] ?? "щось пішло не так, спробуй за хвилинку";
}

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
    meetingUrl: null,
    videoUrl: null,
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
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Outside Telegram there's no verified identity, so nothing can be booked
  // — the app stays browsable as a demo.
  const inTelegram = !!getTelegramUserId();

  const [mine, setMine] = useState<Mine>(EMPTY_MINE);
  const [mineLoading, setMineLoading] = useState(inTelegram);
  const [mineError, setMineError] = useState<string | null>(null);
  const [bookingsOpen, setBookingsOpen] = useState(false);
  const [faqOpen, setFaqOpen] = useState(false);
  const [busyClubId, setBusyClubId] = useState<string | null>(null);
  const [busySubId, setBusySubId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const reloadClubs = () =>
    fetchClubs()
      .then(setClubs)
      .catch((err) => console.error("failed to load clubs", err));

  const reloadMine = async () => {
    if (!inTelegram) return;
    setMineLoading(true);
    try {
      setMine(await fetchMine());
      setMineError(null);
    } catch (err) {
      console.error("failed to load bookings", err);
      setMineError(errorText(err));
    } finally {
      setMineLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([
      fetchClubs().then(setClubs),
      fetchSubscriptions().then(setSubscriptions),
    ])
      .catch((err) => console.error("failed to load data", err))
      .finally(() => setLoading(false));

    // Asks the server only about this user, so the admin list is never
    // published. On failure, fall back to the build-time list so the admin
    // button doesn't vanish because of one flaky request.
    if (inTelegram) {
      fetchIsAdmin()
        .then(setIsAdmin)
        .catch((err) => {
          console.warn("admin check failed, using build-time list", err);
          setIsAdmin(isFallbackAdmin());
        });
    }

    reloadMine();
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
  const bookingsPresence = usePresence(bookingsOpen);
  const faqPresence = usePresence(faqOpen);

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

  const [regsClub, setRegsClub] = useState<Club | null>(null);
  const [regs, setRegs] = useState<ClubRegistration[]>([]);
  const [regsLoading, setRegsLoading] = useState(false);
  const [regsError, setRegsError] = useState<string | null>(null);
  const [shownRegsClub, setShownRegsClub] = useState<Club | null>(null);
  useEffect(() => {
    if (regsClub) setShownRegsClub(regsClub);
  }, [regsClub]);
  const regsPresence = usePresence(!!regsClub);

  useBodyScrollLock(
    clubPresence.rendered ||
      subsPresence.rendered ||
      successPresence.rendered ||
      bookingsPresence.rendered ||
      faqPresence.rendered ||
      adminPresence.rendered ||
      formPresence.rendered ||
      regsPresence.rendered,
  );

  const shiftMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  };

  const dayClubs = useMemo(
    () => clubs.filter((c) => c.date === selected).sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [clubs, selected],
  );

  const bookingByClubId = useMemo(() => {
    const map = new Map<string, MyBooking>();
    for (const booking of mine.bookings) {
      if (booking.club) map.set(booking.club.id, booking);
    }
    return map;
  }, [mine.bookings]);

  // Days the person already holds a booking on — the calendar outlines them.
  const bookedDates = useMemo(() => {
    const dates = new Set<string>();
    for (const booking of mine.bookings) {
      if (booking.club) dates.add(booking.club.date);
    }
    return dates;
  }, [mine.bookings]);

  const usablePass = useMemo(() => nextPass(mine.passes), [mine.passes]);

  // A shared link (t.me/<bot>?startapp=<clubId>) must open straight on that
  // club, so wait for the clubs to arrive and then jump to it once.
  const startParamHandled = useRef(false);
  useEffect(() => {
    if (startParamHandled.current || clubs.length === 0) return;
    startParamHandled.current = true;
    const clubId = getStartParam();
    if (!clubId) return;
    const club = clubs.find((c) => c.id === clubId);
    if (!club) return;
    setSelected(club.date);
    setOpen(club);
  }, [clubs]);

  const onShare = async (club: Club) => {
    const result = await shareClub(club.id, club.title);
    if (result === "shared") return;
    setSuccess({
      heading: result === "copied" ? "посилання скопійовано" : "не вдалося поділитись",
      title: club.title,
      subtitle:
        result === "copied"
          ? "кидай другу — відкриється саме цей клаб"
          : "спробуй ще раз або скопіюй посилання вручну",
      failed: result !== "copied",
    });
  };

  const demoNotice = (title: string) => {
    setOpen(null);
    setSubsOpen(false);
    setSuccess({
      heading: "демо-режим",
      title,
      subtitle: "відкрий у телеграмі, щоб записатись",
      failed: true,
    });
  };

  const onPay = async (club: Club) => {
    if (!inTelegram) return demoNotice(club.title);

    setBusyClubId(club.id);
    try {
      const result = await bookClub(club.id);
      setOpen(null);
      setSuccess({
        heading: result.paidWith === "subscription" ? "записали за абоном" : "санчізес",
        title: club.title,
        subtitle: `${formatShortDate(club.date)} · ${club.startTime}–${club.endTime} · ${club.teacher}`,
        calm: "не переживай, лінк на зустріч прийде за годину до уроку",
        priceUah: result.paidWith === "subscription" ? undefined : result.pricePaidUah,
        note:
          result.paidWith === "subscription" && result.sessionsLeft !== null
            ? result.sessionsLeft === 0
              ? "це було останнє за абоном"
              : `лишилось ${result.sessionsLeft} відвідувань`
            : undefined,
        renewPass: result.paidWith === "subscription" && result.sessionsLeft === 0,
      });
    } catch (err) {
      // The database enforces capacity and the one-booking-per-club rule, so
      // this is a real rejection — never show a success screen for a booking
      // that didn't happen.
      setOpen(null);
      setSuccess({ title: club.title, subtitle: errorText(err), failed: true });
    } finally {
      setBusyClubId(null);
      await Promise.all([reloadClubs(), reloadMine()]);
    }
  };

  const onCancelBooking = async (registrationId: string, title: string) => {
    const confirmed = await confirmCancelBooking(`точно не йдеш на «${title}»?`);
    if (!confirmed) return;

    setCancellingId(registrationId);
    try {
      // The server decides whether the session came back: inside 24 hours it
      // burns, so never promise a refund the database did not make.
      const { sessionBurned } = await cancelBooking(registrationId);
      setOpen(null);
      setSuccess({
        heading: "окей, скасували",
        title,
        subtitle: sessionBurned
          ? "місце звільнили, але відвідування згоріло — скасування день у день не повертається"
          : "місце звільнили, відвідування повернули на абон",
      });
    } catch (err) {
      setSuccess({ heading: "не вдалося скасувати", title, subtitle: errorText(err), failed: true });
    } finally {
      setCancellingId(null);
      await Promise.all([reloadClubs(), reloadMine()]);
    }
  };

  const onBuySub = async (sub: Subscription) => {
    if (!inTelegram) return demoNotice(sub.title);

    setBusySubId(sub.id);
    try {
      await buySubscription(sub.id);
      setSubsOpen(false);
      setSuccess({
        title: sub.title,
        subtitle: sub.sessions,
        priceUah: sub.priceUah,
        note: "абон активний — наступні клаби безкоштовні",
      });
    } catch (err) {
      setSubsOpen(false);
      setSuccess({ title: sub.title, subtitle: errorText(err), failed: true });
    } finally {
      setBusySubId(null);
      await reloadMine();
    }
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
      await Promise.all([reloadClubs(), reloadMine()]);
    } catch (err) {
      setAdminError(errorText(err));
    }
  };

  const onShowRegistrations = async (club: Club) => {
    setRegs([]);
    setRegsError(null);
    setRegsLoading(true);
    setRegsClub(club);
    try {
      setRegs(await fetchClubRegistrations(club.id));
    } catch (err) {
      setRegsError(errorText(err));
    } finally {
      setRegsLoading(false);
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
      setAdminError(errorText(err));
    } finally {
      setAdminSaving(false);
    }
  };

  return (
    <main className="app">
      <header className="top">
        <div className="top-row">
          <p className="eyebrow">MySchool</p>
          <div className="top-row-actions">
            {isAdmin ? (
              <button
                type="button"
                className="theme-btn admin-btn"
                onClick={() => setAdminOpen(true)}
                aria-label="Адмін-панель"
              >
                ⚙
              </button>
            ) : null}
            {inTelegram ? (
              <button
                type="button"
                className="theme-btn"
                onClick={() => setBookingsOpen(true)}
                aria-label="Мої клаби"
              >
                <TicketIcon width={20} height={20} />
                {mine.bookings.length ? <i className="badge-dot" /> : null}
              </button>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
        <h1>Clubs</h1>
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
        bookedDates={bookedDates}
        onSelect={setSelected}
      />

      <section className="day-block">
        <div key={selected} className="day-content">
          <h2>{formatDayTitle(selected)}</h2>
          {loading ? (
            <div className="empty-day">
              <p>завантажуємо…</p>
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
          bookedRegistrationId={bookingByClubId.get(shownClub.id)?.id ?? null}
          pass={usablePass}
          busy={busyClubId === shownClub.id || cancellingId !== null}
          onClose={() => setOpen(null)}
          onPay={onPay}
          onCancel={(registrationId) => onCancelBooking(registrationId, shownClub.title)}
          onOpenSubscriptions={onOpenSubscriptions}
          onShare={onShare}
          minSubPrice={subscriptions.length ? Math.min(...subscriptions.map((s) => s.priceUah)) : 0}
        />
      ) : null}
      {subsPresence.rendered ? (
        <SubscriptionsSheet
          subscriptions={subscriptions}
          activePass={usablePass}
          busyId={busySubId}
          closing={subsPresence.closing}
          onClose={() => setSubsOpen(false)}
          onBuy={onBuySub}
        />
      ) : null}
      {bookingsPresence.rendered ? (
        <MyBookingsSheet
          bookings={mine.bookings}
          passes={mine.passes}
          loading={mineLoading}
          error={mineError}
          cancellingId={cancellingId}
          closing={bookingsPresence.closing}
          onOpenFaq={() => setFaqOpen(true)}
          onClose={() => setBookingsOpen(false)}
          onCancel={(booking) => onCancelBooking(booking.id, booking.club?.title ?? "")}
        />
      ) : null}
      {faqPresence.rendered ? (
        <FaqSheet closing={faqPresence.closing} onClose={() => setFaqOpen(false)} />
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
          onShowRegistrations={onShowRegistrations}
        />
      ) : null}
      {regsPresence.rendered && shownRegsClub ? (
        <ClubRegistrationsSheet
          club={shownRegsClub}
          registrations={regs}
          loading={regsLoading}
          error={regsError}
          closing={regsPresence.closing}
          onClose={() => setRegsClub(null)}
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
      {successPresence.rendered && shownSuccess ? (
        <PaymentSuccessSheet
          heading={shownSuccess.heading}
          title={shownSuccess.title}
          subtitle={shownSuccess.subtitle}
          note={shownSuccess.note}
          calm={shownSuccess.calm}
          priceUah={shownSuccess.priceUah}
          failed={shownSuccess.failed}
          onRenew={
            shownSuccess.renewPass
              ? () => {
                  setSuccess(null);
                  setSubsOpen(true);
                }
              : undefined
          }
          renewHint={
            subscriptions.length
              ? `від ${Math.min(...subscriptions.map((s) => s.priceUah))} грн`
              : undefined
          }
          closing={successPresence.closing}
          onClose={() => setSuccess(null)}
        />
      ) : null}
    </main>
  );
}
