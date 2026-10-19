/** Original approved flag geometry. Decorative within a named plate. No SVG IDs. */
export function UnionFlag() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" aria-hidden="true" focusable="false">
      <path fill="#012169" d="M0 0h60v30H0z" />
      <path stroke="#fff" strokeWidth="6" d="m0 0 60 30M60 0 0 30" />
      <path fill="#C8102E" d="M0 0h4l26 13v2ZM60 0v2L34 15h-4ZM60 30h-4L30 17v-2ZM0 30v-2L26 15h4Z" />
      <path stroke="#fff" strokeWidth="10" d="M30 0v30M0 15h60" />
      <path stroke="#C8102E" strokeWidth="6" d="M30 0v30M0 15h60" />
    </svg>
  );
}
