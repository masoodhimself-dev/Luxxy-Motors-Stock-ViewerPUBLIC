import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { LucideIcon } from '@/components/icons';
import './settings-tabs.css';

export type SettingsTab = { id: string; label: string; icon?: LucideIcon };

/** Arrow keys move focus; Enter/Space activates, so leaving a dirty editor is deliberate. */
export function SettingsTabs({ idPrefix, label, value, items, onValueChange }: {
  idPrefix: string;
  label: string;
  value: string;
  items: readonly SettingsTab[];
  onValueChange: (value: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const hasSelection = items.some(item => item.id === value);
  useEffect(() => {
    const strip = root.current;
    if (!strip) return;
    const revealSelection = () => {
      const active = strip.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!active || strip.scrollWidth <= strip.clientWidth) return;
      const bounds = strip.getBoundingClientRect(), selected = active.getBoundingClientRect();
      if (selected.left < bounds.left) strip.scrollLeft -= bounds.left - selected.left + 5;
      else if (selected.right > bounds.right) strip.scrollLeft += selected.right - bounds.right + 5;
    };
    revealSelection();
    // Keep the active tab visible when a phone or tablet changes orientation.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(revealSelection);
    observer?.observe(strip);
    window.addEventListener('resize', revealSelection);
    return () => { observer?.disconnect(); window.removeEventListener('resize', revealSelection); };
  }, [value]);
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    const target = root.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next];
    target?.focus({ preventScroll: true });
    target?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }
  return <div ref={root} className="settings-tabs" role="tablist" aria-label={label} aria-orientation="horizontal">
    {items.map(({ id, label: title, icon: Icon }, index) => <button
      key={id} type="button" role="tab" id={`${idPrefix}-tab-${id}`}
      aria-controls={value === id ? `${idPrefix}-panel-${id}` : undefined} aria-selected={value === id}
      tabIndex={value === id || (!hasSelection && index === 0) ? 0 : -1}
      onKeyDown={event => move(event, index)} onClick={() => onValueChange(id)}
    >{Icon && <Icon size={17} aria-hidden="true" />}<span>{title}</span></button>)}
  </div>;
}
