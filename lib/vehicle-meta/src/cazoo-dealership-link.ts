export function cazooDealershipLink(input: string) {
  const value = input.trim();
  if (value.length > 2048 || /[\\\s]/.test(value)) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !['cazoo.co.uk', 'www.cazoo.co.uk'].includes(url.hostname)) return null;

    const match = /^\/dealers\/([a-z0-9]+(?:-[a-z0-9]+)*)-([0-9]{1,16})\/?$/.exec(url.pathname);
    if (!match) return null;

    return {
      sourceUrl: `https://www.cazoo.co.uk/dealers/${match[1]}-${match[2]}/`,
      retailerId: `cazoo-${match[2]}`,
    };
  } catch {
    return null;
  }
}
