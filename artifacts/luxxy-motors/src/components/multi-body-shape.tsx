/** Original side profiles drawn for Multi-Choice. The link supplies the label. */
export function MultiBodyShape({ type }: { type: string }) {
  const key = type.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const shape = /suv|4x4/.test(key)
    ? 'M4 23V17L9 14 15 6H41L49 14 59 16 61 23H54M43 23H21M10 23H4M15 14H44M28 7V14'
    : /mpv|people/.test(key)
      ? 'M3 23V13L11 5H43L53 14 61 17V23H54M43 23H21M10 23H3M11 13H49M28 6V14'
      : /estate/.test(key)
        ? 'M3 23V15L10 9H39L48 15 59 17 61 23H54M43 23H21M10 23H3M11 15H44M27 10V15'
        : /saloon|sedan/.test(key)
          ? 'M3 23 5 17 15 15 23 8H39L47 15 58 17 61 23H54M43 23H21M10 23H3M19 15H43M31 9V15'
          : /convert/.test(key)
            ? 'M3 23 5 17 17 16 24 10 28 16H48L59 18 61 23H54M43 23H21M10 23H3M32 16V13M44 16V13'
            : /coupe/.test(key)
              ? 'M3 23 6 17 16 15 27 8H37L49 16 59 18 61 23H54M43 23H21M10 23H3M21 15H44M33 9V15'
              : 'M4 23V16L12 13 19 6H36L45 14 58 17 61 23H54M43 23H21M10 23H4M15 14H41M28 7V14';
  return <svg width="64" height="34" viewBox="0 0 64 34" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={shape} /><circle cx="16" cy="23" r="5" /><circle cx="49" cy="23" r="5" /><path d="M5 19h4m48 0h3" strokeWidth="1.7" /></svg>;
}
