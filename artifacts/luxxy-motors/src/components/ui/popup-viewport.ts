/** Fit a text-entry popup above the software keyboard without changing its idle layout. */
export function watchPopupViewport(content: HTMLElement) {
  // This form already owns keyboard positioning and field visibility.
  if (content.classList.contains('quick-enquiry-dialog')) return () => {};
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  let frame = 0;
  let lastField: HTMLElement | null = null;
  let lastHeight = 0;
  const update = () => {
    const active = document.activeElement;
    const textInput = active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement && ['text', 'email', 'tel', 'search', 'number', 'url', 'password'].includes(active.type));
    const keyboard = textInput && content.contains(active) && viewport.scale === 1 &&
      window.innerHeight - viewport.height > 100;
    if (keyboard) {
      const revealField = lastField !== active || lastHeight !== viewport.height;
      content.dataset.popupKeyboard = 'true';
      content.style.setProperty('--popup-viewport-height', `${viewport.height}px`);
      content.style.setProperty('--popup-viewport-top', `${viewport.offsetTop}px`);
      // Resizing a flex panel can clip a field that was visible before the
      // keyboard opened. Reveal it inside its scroll body after applying bounds.
      if (revealField) active.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
      lastField = active;
      lastHeight = viewport.height;
    } else {
      lastField = null;
      lastHeight = 0;
      delete content.dataset.popupKeyboard;
      content.style.removeProperty('--popup-viewport-height');
      content.style.removeProperty('--popup-viewport-top');
    }
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(update);
  };
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  update();
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener('resize', schedule);
    viewport.removeEventListener('scroll', schedule);
    document.removeEventListener('focusin', schedule);
    document.removeEventListener('focusout', schedule);
    delete content.dataset.popupKeyboard;
    content.style.removeProperty('--popup-viewport-height');
    content.style.removeProperty('--popup-viewport-top');
  };
}
