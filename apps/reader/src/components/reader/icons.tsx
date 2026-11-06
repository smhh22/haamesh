/**
 * Inline SVG icons for the reader chrome. Stroke-based, sized by the CSS
 * (1em square) and colored by `currentColor`, so they inherit the theme and
 * keep logical-direction styling out of the markup.
 */
import type { JSX } from 'react';

interface IconProps {
  /** Additional accessible name when the wrapping button has none. */
  className?: string;
}

const base = (path: JSX.Element, { className }: IconProps): JSX.Element => (
  <svg
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    {path}
  </svg>
);

export const ContentsIcon = (props: IconProps): JSX.Element =>
  base(
    <>
      <path d="M5.5 3.5h8" />
      <path d="M5.5 8h8" />
      <path d="M5.5 12.5h8" />
      <path d="M2.5 3.5h.01" />
      <path d="M2.5 8h.01" />
      <path d="M2.5 12.5h.01" />
    </>,
    props,
  );

export const NotesIcon = (props: IconProps): JSX.Element =>
  base(
    <>
      <path d="M11.5 2.5l2 2-7.5 7.5-2.7.7.7-2.7z" />
      <path d="M3 14h10" />
    </>,
    props,
  );

export const SearchIcon = (props: IconProps): JSX.Element =>
  base(
    <>
      <circle cx="7" cy="7" r="4" />
      <path d="M10.5 10.5L13.5 13.5" />
    </>,
    props,
  );

export const BookmarkIcon = (props: IconProps): JSX.Element =>
  base(<path d="M4.5 2.5h7v11l-3.5-2.5-3.5 2.5z" />, props);

export const SettingsIcon = (props: IconProps): JSX.Element =>
  base(
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
    </>,
    props,
  );

export const ChevronLeftIcon = (props: IconProps): JSX.Element =>
  base(<path d="M10 3.5L5.5 8l4.5 4.5" />, props);

export const ChevronRightIcon = (props: IconProps): JSX.Element =>
  base(<path d="M6 3.5L10.5 8 6 12.5" />, props);

export const PlayIcon = (props: IconProps): JSX.Element =>
  base(<path d="M5 3.5l8 4.5-8 4.5z" fill="currentColor" stroke="none" />, props);

export const PauseIcon = (props: IconProps): JSX.Element =>
  base(
    <>
      <path d="M5.5 3.5v9" strokeWidth="2.5" />
      <path d="M10.5 3.5v9" strokeWidth="2.5" />
    </>,
    props,
  );
