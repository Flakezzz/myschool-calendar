type Props = {
  url: string;
  title: string;
};

/** YouTube links have to become an embed; anything else is treated as a file. */
function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.endsWith("youtube.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      if (u.pathname.startsWith("/shorts/")) return u.pathname.split("/")[2] ?? null;
      if (u.pathname.startsWith("/embed/")) return u.pathname.split("/")[2] ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

/** The player only. Its box is drawn by the sheet from the moment the card
 * starts growing, so the final height is known before the animation runs and
 * the heavy player can be mounted afterwards without changing the layout. */
export function ClubVideo({ url, title }: Props) {
  const id = youtubeId(url);
  return id ? (
    <iframe
      // enablejsapi lets the sheet pause it when the card is collapsed;
      // without it the video would keep playing out of sight.
      src={`https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1`}
      title={`Відео: ${title}`}
      allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
      allowFullScreen
      loading="lazy"
    />
  ) : (
    <video src={url} controls playsInline preload="metadata" />
  );
}
