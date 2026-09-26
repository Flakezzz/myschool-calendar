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

export const clubs: Club[] = [
  {
    id: "1",
    title: "Drama Club",
    description: "Рольові ігри, діалоги та міні-вистави англійською.",
    date: "2026-09-25",
    startTime: "16:00",
    endTime: "17:30",
    teacher: "Ms. Anna",
    level: "A2–B1",
    seats: 12,
    taken: 8,
    priceUah: 350,
    color: "#E85D4C",
  },
  {
    id: "2",
    title: "Movie Talk",
    description: "Короткі сцени з фільмів, словник і обговорення.",
    date: "2026-09-25",
    startTime: "18:00",
    endTime: "19:00",
    teacher: "Mr. James",
    level: "B1+",
    seats: 10,
    taken: 10,
    priceUah: 300,
    color: "#3BA99C",
  },
  {
    id: "3",
    title: "Kids Speaking",
    description: "Ігри та speaking для дітей 7–10 років.",
    date: "2026-09-27",
    startTime: "11:00",
    endTime: "12:00",
    teacher: "Ms. Oksana",
    level: "Kids",
    seats: 8,
    taken: 3,
    priceUah: 280,
    color: "#E8B86D",
  },
  {
    id: "4",
    title: "Exam Boost",
    description: "Speaking для підготовки до іспитів.",
    date: "2026-09-30",
    startTime: "17:00",
    endTime: "18:30",
    teacher: "Ms. Anna",
    level: "B2",
    seats: 6,
    taken: 2,
    priceUah: 450,
    color: "#1B4D6E",
  },
];
