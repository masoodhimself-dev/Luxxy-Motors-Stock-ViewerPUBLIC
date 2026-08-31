type SetLocation = (path: string) => void;

let pendingTarget: string | null = null;

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 'auto'
    : 'smooth';
}

export function scrollToHomeTarget(target: string): boolean {
  if (target === 'top') {
    window.scrollTo({ top: 0, behavior: scrollBehavior() });
    return true;
  }

  const element = document.getElementById(target);
  if (!element) return false;

  element.scrollIntoView({
    behavior: scrollBehavior(),
    block: 'start',
  });
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