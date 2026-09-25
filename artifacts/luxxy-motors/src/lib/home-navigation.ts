type SetLocation = (path: string) => void;

let pendingTarget: string | null = null;

const homeTargetFocusIds: Record<string, string> = {
  top: 'home-heading',
  stock: 'vehicle-results-heading',
  about: 'about-heading',
  warranty: 'warranty-heading',
  'part-exchange': 'part-exchange-heading',
  delivery: 'delivery-heading',
};

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

function getHeaderHeight(): number {
  const header = document.querySelector<HTMLElement>('[data-site-header]');
  if (header) return header.getBoundingClientRect().height;

  const configuredHeight = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--site-header-height'),
  );
  return Number.isFinite(configuredHeight) ? configuredHeight : 0;
}

function getMaxScrollTop(): number {
  return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
}

function getScrollSpacer(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-home-scroll-spacer]');
}

export function scrollToHomeTarget(target: string): boolean {
  if (target === 'top') {
    const spacer = getScrollSpacer();
    if (spacer) spacer.style.height = '0px';
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    return true;
  }

  const element = document.getElementById(target);
  if (!element) return false;

  const spacer = getScrollSpacer();
  if (spacer) spacer.style.height = '0px';

  const sectionTop = element.getBoundingClientRect().top + window.scrollY;
  const headerAwareTop = sectionTop - getHeaderHeight();
  const scrollSpaceNeeded = Math.max(0, headerAwareTop - getMaxScrollTop());
  if (spacer && scrollSpaceNeeded > 0) {
    spacer.style.height = `${Math.ceil(scrollSpaceNeeded)}px`;
  }

  const destinationTop = Math.min(Math.max(0, headerAwareTop), getMaxScrollTop());

  window.scrollTo({ top: destinationTop, behavior: scrollBehavior() });
  return true;
}

export function focusHomeTarget(target: string): boolean {
  const element = document.getElementById(target);
  if (!element) return false;

  element.focus({ preventScroll: true });
  return document.activeElement === element;
}

export function navigateToHomeTarget(
  target: string,
  currentLocation: string,
  setLocation: SetLocation,
) {
  if (target === 'stock' || target === 'vehicle-results') {
    pendingTarget = null;
    if (currentLocation !== '/stock') setLocation('/stock');
    else scrollToHomeTarget('stock');
    return;
  }
  pendingTarget = target;

  if (currentLocation !== '/') {
    setLocation('/');
    return;
  }

  requestAnimationFrame(() => {
    if (pendingTarget === target && scrollToHomeTarget(target)) {
      pendingTarget = null;
    }
  });
}

export function flushPendingHomeTarget() {
  if (!pendingTarget) return;

  const target = pendingTarget;
  if (scrollToHomeTarget(target)) {
    const focusTarget = homeTargetFocusIds[target];
    if (focusTarget) {
      focusHomeTarget(focusTarget);
    }
    pendingTarget = null;
  }
}

export function hasPendingHomeTarget() {
  return pendingTarget !== null;
}
