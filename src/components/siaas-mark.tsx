// Original paths from siaas-public-site/src/components/siaas-mark.tsx.
export function SiaasMark() {
  return (
    <svg
      className="siaas-loading-mark"
      viewBox="0 0 120 92"
      width="120"
      height="92"
      aria-hidden="true"
      focusable="false"
    >
      <path
        className="siaas-loading-hand"
        d="M12 62 C31 43 43 43 59 54 C70 61 80 62 91 53"
      />
      <path className="siaas-loading-hand" d="M52 73 C68 80 82 77 108 53" />
      <path
        className="siaas-loading-star"
        d="M61 5 C64 18 69 23 82 26 C69 29 64 34 61 47 C58 34 53 29 40 26 C53 23 58 18 61 5Z"
      />
      <path
        className="siaas-loading-star siaas-loading-star-opposite"
        d="M91 20 C93 27 96 30 103 32 C96 34 93 37 91 44 C89 37 86 34 79 32 C86 30 89 27 91 20Z"
      />
    </svg>
  );
}
