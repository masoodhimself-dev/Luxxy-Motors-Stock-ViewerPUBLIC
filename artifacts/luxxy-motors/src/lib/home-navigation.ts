type SetLocation = (path: string) => void;

let pendingTarget: string | null = null;

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

export function scrollToHomeTarget(target: string): boolean {
  if (target === 'top') {
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    return true;
  }

  const element = document.getElementById(target);
  if (!element) return false;

  const sectionTop = element.getBoundingClientRect().top + window.scrollY;
  const headerAwareTop = sectionTop - getHeaderHeight();
  const destinationTop = Math.min(Math.max(0, headerAwareTop), getMaxScrollTop());

  window.scrollTo({ top: destinationTop, behavior: scrollBehavior() });
  return true;
}

export function navigateToHomeTarget(
  target: string,
  currentLocation: string,
  setLocation: SetLocation,
) {
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

  if (scrollToHomeTarget(pendingTarget)) {
    pendingTarget = null;
  }
}