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
  /** Short clip from the teacher, shown only in the expanded sheet. */
  videoUrl: string | null;
};
