import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, buttonVariants } from '../button';
import { Phone } from '@/components/icons';

describe('Balanced buttons in the existing application', () => {
  it('preserves real link semantics and its destination', () => {
    render(<Button asChild variant="outline"><a href="/stock"><Phone aria-hidden="true" />Browse stock</a></Button>);
    expect(screen.getByRole('link', {name: 'Browse stock'})).toHaveAttribute('href', '/stock');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('preserves state attributes supplied by existing Radix controls', () => {
    render(<Button data-state="open">Quick actions</Button>);
    expect(screen.getByRole('button')).toHaveAttribute('data-state', 'open');
  });
  it('keeps native form submission and forwards the ref', () => {
    const submit = vi.fn(e => e.preventDefault());
    const ref = {current: null as HTMLButtonElement | null};
    render(<form onSubmit={submit}><Button ref={ref} type="submit">Save</Button></form>);
    fireEvent.click(screen.getByRole('button'));
    expect(submit).toHaveBeenCalledOnce();
    expect(ref.current).toBe(screen.getByRole('button'));
  });
  it('blocks repeat activation and form submission while loading', () => {
    const click = vi.fn(); const submit = vi.fn(e => e.preventDefault());
    render(<form onSubmit={submit}><Button type="submit" status="loading" onClick={click}>Save</Button></form>);
    const button = screen.getByRole('button', {name: 'Working…'});
    fireEvent.click(button); fireEvent.click(button);
    expect(click).not.toHaveBeenCalled(); expect(submit).not.toHaveBeenCalled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });
  it('announces completion without replacing a fixed-width label stack', () => {
    const {rerender} = render(<Button status="idle">Save changes</Button>);
    rerender(<Button status="success">Save changes</Button>);
    expect(screen.getByRole('button', {name:'Complete'})).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Complete');
    expect(document.querySelector('.db-label-idle')).toHaveTextContent('Save changes');
  });
  it('keeps theme utility classes and compact/icon geometry markers', () => {
    expect(buttonVariants({variant:'accent'})).toContain('bg-accent');
    expect(buttonVariants({variant:'destructive'})).toContain('bg-destructive');
    expect(buttonVariants({size:'sm'})).toContain('db-btn--compact');
    expect(buttonVariants({size:'icon'})).toContain('db-btn--icon');
  });
  it('honours disabled native and aria-disabled actions', () => {
    const click = vi.fn();
    render(<Button aria-disabled="true" onClick={click}>Reset demo</Button>);
    fireEvent.click(screen.getByRole('button')); expect(click).not.toHaveBeenCalled();
  });
});
