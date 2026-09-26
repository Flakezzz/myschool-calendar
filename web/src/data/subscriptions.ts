export type Subscription = {
  id: string;
  title: string;
  sessions: string;
  description: string;
  priceUah: number;
};

export const subscriptions: Subscription[] = [
  {
    id: "sub-4",
    title: "4 клаби",
    sessions: "4 відвідування / 30 днів",
    description: "Підходить, якщо ходите на клаби раз на тиждень.",
    priceUah: 1200,
  },
  {
    id: "sub-8",
    title: "8 клабів",
    sessions: "8 відвідувань / 30 днів",
    description: "Оптимальний варіант для двох клабів на тиждень.",
    priceUah: 2200,
  },
  {
    id: "sub-unlim",
    title: "Безліміт",
    sessions: "Необмежено / 30 днів",
    description: "Відвідуйте будь-яку кількість клабів без обмежень.",
    priceUah: 3500,
  },
];
