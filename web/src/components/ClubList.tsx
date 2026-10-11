import { Club } from "../data/clubs";

type Props = {
  clubs: Club[];
  onOpen: (club: Club) => void;
};

export function ClubList({ clubs, onOpen }: Props) {
  if (!clubs.length) {
    return (
      <div className="empty-day">
        <p>тут пусто</p>
        <span>обирай інший день</span>
      </div>
    );
  }

  return (
    <ul className="club-list">
      {clubs.map((club) => {
        const left = club.seats - club.taken;
        const full = left <= 0;
        return (
          <li key={club.id}>
            {/* "колір під колір клабу": in her design the card is outlined
                in the club's own colour rather than carrying a stripe. */}
            <button
              type="button"
              className="club-card"
              style={{ borderColor: club.color }}
              onClick={() => onOpen(club)}
            >
              <div className="club-body">
                <div className="club-top">
                  <strong>{club.title}</strong>
                  <em>{club.priceUah} грн</em>
                </div>
                <p>
                  {club.startTime}–{club.endTime} · {club.teacher} · {club.level}
                </p>
                <div className="club-meta">
                  <span className={full ? "full" : "seats"}>
                    {full ? "все, місць нема" : `${left} місць`}
                  </span>
                </div>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
