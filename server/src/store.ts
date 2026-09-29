import { supabase } from "./supabase.js";

export type Registration = {
  id: string;
  type: "club" | "subscription";
  clubId?: string;
  subscriptionId?: string;
  telegramUserId: string;
  createdAt: string;
  reminders: { day: boolean; h3: boolean; h1: boolean };
};

type RegistrationRow = {
  id: string;
  type: "club" | "subscription";
  club_id: string | null;
  subscription_id: string | null;
  telegram_user_id: string;
  created_at: string;
  reminder_day: boolean;
  reminder_h3: boolean;
  reminder_h1: boolean;
};

function fromRow(row: RegistrationRow): Registration {
  return {
    id: row.id,
    type: row.type,
    clubId: row.club_id ?? undefined,
    subscriptionId: row.subscription_id ?? undefined,
    telegramUserId: row.telegram_user_id,
    createdAt: row.created_at,
    reminders: { day: row.reminder_day, h3: row.reminder_h3, h1: row.reminder_h1 },
  };
}

export async function addRegistration(reg: {
  type: "club" | "subscription";
  clubId?: string;
  subscriptionId?: string;
  telegramUserId: string;
}): Promise<Registration> {
  if (!supabase) throw new Error("supabase not configured");
  const { data, error } = await supabase
    .from("registrations")
    .insert({
      type: reg.type,
      club_id: reg.clubId ?? null,
      subscription_id: reg.subscriptionId ?? null,
      telegram_user_id: reg.telegramUserId,
    })
    .select()
    .single();
  if (error) throw error;
  return fromRow(data as RegistrationRow);
}

export async function getClubRegistrations(): Promise<Registration[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("registrations")
    .select("*")
    .eq("type", "club")
    .not("club_id", "is", null);
  if (error) throw error;
  return (data as RegistrationRow[]).map(fromRow);
}

export async function markReminderSent(id: string, key: "day" | "h3" | "h1") {
  if (!supabase) return;
  const column = key === "day" ? "reminder_day" : key === "h3" ? "reminder_h3" : "reminder_h1";
  const { error } = await supabase
    .from("registrations")
    .update({ [column]: true })
    .eq("id", id);
  if (error) throw error;
}
