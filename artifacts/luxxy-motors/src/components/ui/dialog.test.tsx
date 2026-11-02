import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from './dialog';

afterEach(() => vi.unstubAllGlobals());

function Example({ locked = false, onEscape = vi.fn(), onOpenAutoFocus }: {
  locked?: boolean;
  onEscape?: (event: KeyboardEvent) => void;
  onOpenAutoFocus?: (event: Event) => void;
}) {
  const [open, setOpen] = useState(false);
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger>Open details</DialogTrigger>
    <DialogContent closeDisabled={locked} onEscapeKeyDown={onEscape} onOpenAutoFocus={onOpenAutoFocus}>
      <DialogTitle>Customer details</DialogTitle>
      <DialogDescription>Check these details before saving.</DialogDescription>
      <label>Name<input /></label>
    </DialogContent>
  </Dialog>;
}

it('locks the close button and Escape while a request is in progress, then permits closing', async () => {
  const onEscape = vi.fn();
  const view = render(<Example locked onEscape={onEscape} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
  expect(await screen.findByRole('dialog')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(onEscape).toHaveBeenCalledOnce();
  expect(screen.getByRole('dialog')).toBeVisible();
  view.rerender(<Example onEscape={onEscape} />);
  fireEvent.keyDown(document, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Open details' })).toHaveFocus());
});

it('starts a phone dialog at its heading rather than opening the keyboard', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  render(<Example />);
  fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Customer details' })).toHaveFocus());
  expect(screen.getByRole('textbox', { name: 'Name' })).not.toHaveFocus();
});

it('respects a caller’s chosen initial focus and preserves its Escape guard', async () => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
  const initialFocus = vi.fn((event: Event) => { event.preventDefault(); screen.getByRole('textbox').focus(); });
  const guard = vi.fn((event: KeyboardEvent) => event.preventDefault());
  render(<Example onOpenAutoFocus={initialFocus} onEscape={guard} />);
  fireEvent.click(screen.getByRole('button', { name: 'Open details' }));
  await waitFor(() => expect(screen.getByRole('textbox')).toHaveFocus());
  expect(initialFocus).toHaveBeenCalledOnce();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(guard).toHaveBeenCalledOnce();
  expect(screen.getByRole('dialog')).toBeVisible();
});

it('returns focus to an ordinary opener when a controlled dialog has no DialogTrigger', async () => {
  function Controlled() {
    const [open, setOpen] = useState(false);
    return <><button onClick={() => setOpen(true)}>Record payment</button>
      <Dialog open={open} onOpenChange={setOpen}><DialogContent>
        <DialogTitle>Payment details</DialogTitle><DialogDescription>Check the payment.</DialogDescription>
        <label>Amount<input /></label>
      </DialogContent></Dialog></>;
  }
  render(<Controlled />);
  const opener = screen.getByRole('button', { name: 'Record payment' });
  opener.focus();
  fireEvent.click(opener);
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
});
