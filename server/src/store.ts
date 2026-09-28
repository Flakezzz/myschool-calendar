import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_FILE = path.join(__dirname, "..", "data", "registrations.json");

export type Registration = {
  id: string;
  type: "club" | "subscription";
  clubId?: string;
  subscriptionId?: string;
  telegramUserId: string;
  createdAt: string;
  reminders: { day: boolean; h3: boolean; h1: boolean };
};

function load(): Registration[] {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function save(list: Registration[]) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(list, null, 2));
}

export function addRegistration(
  reg: Pick<Registration, "type" | "clubId" | "subscriptionId" | "telegramUserId">,
): Registration {
  const list = load();
  const full: Registration = {
    ...reg,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    reminders: { day: false, h3: false, h1: false },
  };
  list.push(full);
  save(list);
  return full;
}

export function getClubRegistrations(): Registration[] {
  return load().filter((r) => r.type === "club" && r.clubId);
}

export function markReminderSent(id: string, key: "day" | "h3" | "h1") {
  const list = load();
  const reg = list.find((r) => r.id === id);
  if (reg) {
    reg.reminders[key] = true;
    save(list);
  }
}
