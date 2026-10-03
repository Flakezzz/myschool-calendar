import type { SVGProps } from "react";

export function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M12 2.75h0a1.5 1.5 0 0 1 1.5 1.5v.3a1.5 1.5 0 0 0 2.25 1.3l.26-.15a1.5 1.5 0 0 1 2.05.55l.3.52a1.5 1.5 0 0 1-.55 2.05l-.26.15a1.5 1.5 0 0 0 0 2.6l.26.15a1.5 1.5 0 0 1 .55 2.05l-.3.52a1.5 1.5 0 0 1-2.05.55l-.26-.15a1.5 1.5 0 0 0-2.25 1.3v.3a1.5 1.5 0 0 1-1.5 1.5h-.6a1.5 1.5 0 0 1-1.5-1.5v-.3a1.5 1.5 0 0 0-2.25-1.3l-.26.15a1.5 1.5 0 0 1-2.05-.55l-.3-.52a1.5 1.5 0 0 1 .55-2.05l.26-.15a1.5 1.5 0 0 0 0-2.6l-.26-.15a1.5 1.5 0 0 1-.55-2.05l.3-.52a1.5 1.5 0 0 1 2.05-.55l.26.15A1.5 1.5 0 0 0 9.9 4.55v-.3a1.5 1.5 0 0 1 1.5-1.5h.6Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TicketIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path
        d="M3.5 8.5V6.75c0-.69.56-1.25 1.25-1.25h14.5c.69 0 1.25.56 1.25 1.25V8.5a2.25 2.25 0 0 0 0 7v1.75c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25V15.5a2.25 2.25 0 0 0 0-7Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 9v1.5M12 13.5V15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function PeopleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="9.5" cy="8.5" r="3" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.75 19c0-2.9 2.58-5.25 5.75-5.25S15.25 16.1 15.25 19"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M16 6.3a3 3 0 0 1 0 5.9M17.5 13.9c1.7.8 2.75 2.4 2.75 4.1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
