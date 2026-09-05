export function isWritableFormControl(target: EventTarget | null) {
  if (
    !(target instanceof HTMLInputElement) &&
    !(target instanceof HTMLTextAreaElement) &&
    !(target instanceof HTMLSelectElement)
  ) {
    return false;
  }

  if (!target.closest('form') || target.disabled) return false;

  return !(
    target instanceof HTMLInputElement &&
    ['button', 'submit', 'reset', 'hidden'].includes(target.type)
  );
}