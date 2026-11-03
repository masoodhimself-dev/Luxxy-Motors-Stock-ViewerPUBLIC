const expressionCharacters = new Set("^$.*+?()[]{}|" + String.fromCharCode(92));

/** Treat names and addresses as literal text, even with regex punctuation. */
export function replaceLiteralIgnoreCase(
  value: string,
  secret: string,
  replacement: string,
) {
  if (!secret) return value;
  const quoted = Array.from(secret, (character) =>
    expressionCharacters.has(character)
      ? String.fromCharCode(92) + character
      : character,
  ).join("");
  return value.replace(new RegExp(quoted, "giu"), () => replacement);
}
