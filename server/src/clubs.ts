import { supabase } from "./supabase.js";

export type Club = {
  id: string;
  title: string;
  description: string;
  date: string;
  startTime: string;
  endTime: string;
  teacher: string;
  level: string;
  seats: number;
  taken: number;
  priceUah: number;
  color: string;
};

type ClubRow = {
  id: string;
  title: string;
  description: string;
  date: string;
  start_time: string;
  end_time: string;
  teacher: string;
  level: string;
  seats: number;
  taken: number;
  price_uah: number;
  color: string;
};

function fromRow(row: ClubRow): Club {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    date: row.date,
    startTime: row.start_time.slice(0, 5),
    endTime: row.end_time.slice(0, 5),
    teacher: row.teacher,
    level: row.level,
    seats: row.seats,
    taken: row.taken,
    priceUah: row.price_uah,
    color: row.color,
  };
}

export async function getClubs(): Promise<Club[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.from("clubs").select("*").order("date");
  if (error) throw error;
  return (data as ClubRow[]).map(fromRow);
}

export async function getClub(id: string): Promise<Club | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("clubs").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data ? fromRow(data as ClubRow) : null;
}
