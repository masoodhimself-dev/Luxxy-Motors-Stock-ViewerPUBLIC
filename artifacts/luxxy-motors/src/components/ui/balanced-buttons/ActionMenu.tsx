'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton, IconSlot, type ButtonProps, type ButtonSize, type ButtonVariant } from './Button';

type MenuItemBase = { id: string; label: string; icon?: React.ReactNode; disabled?: boolean; destructive?: boolean };
export type ActionMenuItem =
  | (MenuItemBase & { onSelect: () => void; href?: never; target?: never; rel?: never })
  | (MenuItemBase & { href: string; onSelect?: never; target?: React.HTMLAttributeAnchorTarget; rel?: string })
  | { id: string; separator: true };
export interface ActionMenuProps {
  label: string;
  /** Short visible text when the accessible label needs more context. */
  triggerText?: string;
  items: readonly ActionMenuItem[];
  /** Optional supplied solid icon. Without one, the trigger is a text button. */
  icon?: React.ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}
const useLayout = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;
const TOKEN_NAMES = ['text', 'surface', 'soft', 'border', 'action-bg', 'action-text', 'action-hover',
  'action-pressed', 'selected-bg', 'selected-border', 'danger-bg', 'danger-text', 'danger-hover',
  'danger-pressed', 'disabled-bg', 'disabled-text', 'disabled-border', 'focus', 'font-size',
  'font-size-prominent', 'font-weight', 'menu-font-weight', 'menu-z-index', 'shadow', 'menu-shadow', 'icon-accent-opacity'];

export function ActionMenu({ label, triggerText = label, items, icon, variant = 'secondary', size = 'standard', disabled, className = '', onOpenChange }: ActionMenuProps) {
  const id = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const [open, setOpen] = React.useState(false);
  const [style, setStyle] = React.useState<React.CSSProperties>({ visibility: 'hidden' });
  const firstFocus = React.useRef<'first' | 'last'>('first');
  const typeahead = React.useRef({ text: '', time: 0 });
  const close = React.useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  }, []);
  React.useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);
  React.useEffect(() => { if (disabled) close(); }, [disabled, close]);
  const enabled = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
  useLayout(() => {
    if (!open || !trigger.current || !menu.current) return;
    const reposition = () => {
      const button = trigger.current!;
      const rect = button.getBoundingClientRect();
      const computed = getComputedStyle(button);
      const inherited: Record<string, string> = {};
      for (const name of TOKEN_NAMES) {
        const value = computed.getPropertyValue(`--db-${name}`).trim();
        if (value) inherited[`--db-${name}`] = value;
      }
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(264, viewportWidth - 16);
      const naturalHeight = menu.current!.scrollHeight + 2;
      const below = Math.max(44, viewportHeight - rect.bottom - 16);
      const above = Math.max(44, rect.top - 16);
      const flip = naturalHeight > below && above > below;
      const height = Math.min(naturalHeight, flip ? above : below);
      setStyle({ ...inherited, position: 'fixed', width,
        left: Math.min(Math.max(8, rect.right - width), viewportWidth - width - 8),
        top: flip ? Math.max(8, rect.top - height - 8) : Math.min(rect.bottom + 8, viewportHeight - height - 8),
        maxHeight: flip ? above : below, visibility: 'visible',
        fontFamily: computed.fontFamily, fontSize: computed.fontSize, fontWeight: computed.fontWeight,
        lineHeight: computed.lineHeight, direction: computed.direction as React.CSSProperties['direction'] });
    };
    reposition();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    const focusOutside = (event: FocusEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) close();
    };
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', focusOutside, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', focusOutside, true);
    };
  }, [open, close]);
  useLayout(() => {
    if (!open || style.visibility !== 'visible') return;
    const controls = enabled();
    (firstFocus.current === 'last' ? controls.at(-1) : controls[0])?.focus({ preventScroll: true });
    if (!controls.length) menu.current?.focus();
  }, [open, style.visibility]);
  function onMenuKeyDown(event: React.KeyboardEvent) {
    const controls = enabled();
    const index = controls.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab') {
      // Return to the trigger before the browser performs normal sequential navigation.
      trigger.current?.focus(); close(); return;
    }
    const movements: Record<string, number> = {
      ArrowDown: (index + 1) % controls.length,
      ArrowUp: (index - 1 + controls.length) % controls.length,
      Home: 0, End: controls.length - 1
    };
    if (event.key in movements) {
      event.preventDefault(); controls[movements[event.key]]?.focus(); return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
      event.preventDefault();
      const now = Date.now();
      typeahead.current.text = now - typeahead.current.time > 700 ? event.key : typeahead.current.text + event.key;
      typeahead.current.time = now;
      const text = typeahead.current.text.toLocaleLowerCase();
      const query = new Set(text).size === 1 ? text[0] : text;
      const ordered = [...controls.slice(index + 1), ...controls.slice(0, index + 1)];
      ordered.find(control => control.textContent?.trim().toLocaleLowerCase().startsWith(query))?.focus();
    }
  }
  const triggerProps: ButtonProps = {
    id: `${id}-trigger`, variant, size, disabled, 'aria-label': label,
    'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? `${id}-menu` : undefined,
    className: `db-menu-trigger ${className}`,
    onClick: () => { firstFocus.current = 'first'; setOpen(value => !value); },
    onKeyDown: event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); firstFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true);
      }
    }
  };
  // A native modal's top layer must contain its menu. Otherwise portal to body.
  const portalTarget = trigger.current?.closest('dialog[open]') ?? (typeof document === 'undefined' ? null : document.body);
  return <>
    {icon != null ? <IconButton {...triggerProps} ref={trigger} label={label} icon={icon} />
      : <Button {...triggerProps} ref={trigger}>{triggerText}</Button>}
    {open && portalTarget && createPortal(<div ref={menu} id={`${id}-menu`} role="menu" tabIndex={-1}
      aria-labelledby={`${id}-trigger`} className="db-menu" style={style} onKeyDown={onMenuKeyDown}>
      {items.map(item => 'separator' in item
        ? <div key={item.id} role="separator" className="db-menu-separator" />
        : item.href !== undefined
          ? <a key={item.id} role="menuitem" tabIndex={-1} href={item.disabled ? undefined : item.href}
            target={item.target} rel={item.rel ?? (item.target === '_blank' ? 'noopener noreferrer' : undefined)}
            aria-disabled={item.disabled || undefined} className="db-menu-item" data-destructive={item.destructive || undefined}
            onClick={event => { if (item.disabled) { event.preventDefault(); return; } close(true); }}>
            {item.icon && <IconSlot>{item.icon}</IconSlot>}<span>{item.label}</span></a>
          : <button key={item.id} type="button" role="menuitem" tabIndex={-1}
            aria-disabled={item.disabled || undefined} className="db-menu-item" data-destructive={item.destructive || undefined}
            onClick={() => { if (item.disabled) return; close(true); item.onSelect(); }}>
            {item.icon && <IconSlot>{item.icon}</IconSlot>}<span>{item.label}</span></button>)}
    </div>, portalTarget)}
  </>;
}

export interface SplitButtonProps {
  action: ButtonProps;
  menuLabel: string;
  menuText?: string;
  items: readonly ActionMenuItem[];
  menuIcon?: React.ReactNode;
  className?: string;
}
export function SplitButton({ action, menuLabel, menuText = 'Options', items, menuIcon, className = '' }: SplitButtonProps) {
  return <span className={`db-split ${className}`}>
    <Button {...action} />
    <ActionMenu label={menuLabel} triggerText={menuText} items={items} icon={menuIcon} size={action.size} variant={action.variant}
      disabled={action.disabled || action.status === 'loading' || action['aria-disabled'] === true || action['aria-disabled'] === 'true'} />
  </span>;
}
