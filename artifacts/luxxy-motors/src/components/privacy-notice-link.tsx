export function PrivacyNoticeLink({ url, className = 'underline underline-offset-4' }: {
  url?: string | null;
  className?: string;
}) {
  const href = url?.trim();
  if (!href || /[\s\u0000-\u001f\u007f\\]/.test(href)) return null;
  if (!/^\/(?!\/)/.test(href)) {
    try {
      const destination = new URL(href);
      if (!['http:', 'https:'].includes(destination.protocol) || destination.username || destination.password) return null;
    } catch {
      return null;
    }
  }
  return <a className={className} href={href}>Privacy policy</a>;
}
