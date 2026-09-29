import { supabase } from "./supabase.js";

export type Subscription = {
  id: string;
  title: string;
  sessions: string;
  description: string;
  priceUah: number;
};

type SubscriptionRow = {
  id: string;
  title: string;
  sessions: string;
  description: string;
  price_uah: number;
};

function fromRow(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    title: row.title,
    sessions: row.sessions,
    description: row.description,
    priceUah: row.price_uah,
  };
}

export async function getSubscriptions(): Promise<Subscription[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("subscriptions").select("*").order("price_uah");
  if (error) throw error;
  return (data as SubscriptionRow[]).map(fromRow);
}

export async function getSubscription(id: string): Promise<Subscription | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("subscriptions").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as SubscriptionRow) : null;
}
