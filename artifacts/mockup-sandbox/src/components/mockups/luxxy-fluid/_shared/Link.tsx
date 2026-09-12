import type { AnchorHTMLAttributes, MouseEvent } from 'react';

export function MockLink({
  href,
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    onClick?.(event);
  };

  return <a href={href} onClick={handleClick} {...props} />;
}