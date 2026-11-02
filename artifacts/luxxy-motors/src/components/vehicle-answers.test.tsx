import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import type { Car } from '@/lib/stock-context';

const state = vi.hoisted(() => ({
  profile: 'multi-choice' as string | undefined,
  ai: { enabled: false, remaining: 10, busy: false, error: '', run: vi.fn() },
}));
vi.mock('@/lib/ai-assistance', () => ({ useAiAssistance: () => state.ai }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: {}, isLoading: false, isError: false }) }));
vi.mock('@/lib/dealer-answers', () => ({ withDealerAnswers: (answers: unknown[]) => [...answers, { id: 'dealer-hours', question: 'What are your opening hours?', answer: 'Monday to Saturday: 10 am–6 pm', source: 'dealer' }] }));
import { VehicleAnswers } from './vehicle-answers';

const vehicle: Car = {
  id: 'volvo', advertId: 'volvo', title: null, variant: null, trim: null,
  make: 'Volvo', model: 'V90', year: 2021, mileage: 92000, price: 15500, currency: 'GBP', priceType: null, mileageText: null,
  registration: null, registrationBand: null, plate: null, vrm: null, vrmVerified: null,
  fuel: null, transmission: null, bodyType: null, engineSize: null, engineCC: null, doors: null, seats: null, colour: null,
  emissionClass: null, drivetrain: null, owners: null, writeOffCategory: null, advertUrl: null,
  dealerName: null, dealerLocation: null, imageCount: null, heroImage: null, images: [], specifications: null, sourceExtras: null,
  description: 'One owner from new. Full service history. Two keys. Heated seats. MOT until July 2027. Six months warranty included. Nationwide delivery available.',
};
const askTeam = vi.fn();
function Answers() {
  const [open, setOpen] = useState(true);
  return <VehicleAnswers car={vehicle} open={open} onOpenChange={setOpen} onAskTeam={askTeam} onReturnFocus={() => {}} />;
}
beforeEach(() => {
  state.profile = 'multi-choice';
  state.ai.enabled = false;
  state.ai.remaining = 10;
  state.ai.busy = false;
  state.ai.error = '';
  state.ai.run.mockReset().mockResolvedValue(null);
  askTeam.mockReset();
});

it('keeps the direct team enquiry handoff without sending a message', async () => {
  render(<Answers />);
  fireEvent.click(screen.getByRole('button', { name: 'Ask our team' }));
  await waitFor(() => expect(askTeam).toHaveBeenCalledOnce());
  expect(state.ai.run).not.toHaveBeenCalled();
  expect(askTeam).toHaveBeenCalledWith(undefined);
});

it('hands the complete trimmed question to the team only after the customer chooses to', async () => {
  render(<Answers />);
  expect(screen.getByRole('dialog', { name: 'Quick answers' })).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', { name: 'Search these answers' }), { target: { value: '  Can you show me the rear seats and boot?  ' } });
  expect(askTeam).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ask our team' }));
  await waitFor(() => expect(askTeam).toHaveBeenCalledWith('Can you show me the rear seats and boot?'));
  expect(state.ai.run).not.toHaveBeenCalled();
});

it('does not carry a question over when the vehicle dialog is remounted for another car', () => {
  const { rerender } = render(<VehicleAnswers key="first" car={vehicle} open onOpenChange={vi.fn()} onAskTeam={askTeam} onReturnFocus={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search these answers' }), { target: { value: 'Question about the first car' } });
  rerender(<VehicleAnswers key="second" car={{ ...vehicle, id: 'second' }} open onOpenChange={vi.fn()} onAskTeam={askTeam} onReturnFocus={vi.fn()} />);
  expect(screen.getByRole('textbox', { name: 'Search these answers' })).toHaveValue('');
  expect(askTeam).not.toHaveBeenCalled();
});

it('cancels a queued team handoff when its vehicle is unmounted before focus restoration', async () => {
  vi.useFakeTimers();
  try {
    const view = render(<Answers />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Search these answers' }), { target: { value: 'A question for the old vehicle' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask our team' }));
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(askTeam).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

it('ignores a late AI answer when the customer has changed their question', async () => {
  let resolve!: (value: { answer: string }) => void;
  const reply = new Promise<{ answer: string }>(done => { resolve = done; });
  state.ai.enabled = true;
  state.ai.run.mockImplementation((kind: string) => kind === 'faqs' ? Promise.resolve(null) : reply);
  render(<Answers />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search these answers' }), { target: { value: 'Are both keys included?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ask AI' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search these answers' }), { target: { value: 'Can I collect on Saturday?' } });
  await act(async () => resolve({ answer: 'A late answer to the key question' }));
  expect(screen.queryByText('A late answer to the key question')).not.toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Search these answers' })).toHaveValue('Can I collect on Saturday?');
});

it('does not reuse generated answers or unfinished searches for a different car', async () => {
  let resolve!: (value: { questions: { question: string; answer: string }[] }) => void;
  state.ai.enabled = true;
  state.ai.run.mockImplementationOnce(() => new Promise(done => { resolve = done; })).mockResolvedValue(null);
  const view = render(<VehicleAnswers car={vehicle} open onOpenChange={vi.fn()} onAskTeam={askTeam} onReturnFocus={vi.fn()} />);
  fireEvent.change(screen.getByRole('textbox', { name: 'Search these answers' }), { target: { value: 'A question about the Volvo' } });
  view.rerender(<VehicleAnswers car={{ ...vehicle, id: 'ford', make: 'Ford', model: 'Focus' }} open onOpenChange={vi.fn()} onAskTeam={askTeam} onReturnFocus={vi.fn()} />);
  await act(async () => resolve({ questions: [{ question: 'Only for the old Volvo?', answer: 'Old car’s answer' }] }));
  expect(screen.getByRole('textbox', { name: 'Search these answers' })).toHaveValue('');
  expect(screen.queryByText('Only for the old Volvo?')).not.toBeInTheDocument();
  expect(state.ai.run).toHaveBeenLastCalledWith('faqs', { vehicleId: 'ford' });
});

it('lets a customer ask their typed AI question with Enter', async () => {
  state.ai.enabled = true;
  state.ai.run.mockImplementation((kind: string) => Promise.resolve(kind === 'question' ? { answer: 'You can ask about collection.' } : null));
  render(<Answers />);
  const search = screen.getByRole('textbox', { name: 'Search these answers' });
  fireEvent.change(search, { target: { value: '  Collection details?  ' } });
  fireEvent.keyDown(search, { key: 'Enter' });
  await screen.findByText('You can ask about collection.');
  expect(state.ai.run).toHaveBeenLastCalledWith('question', { vehicleId: 'volvo', text: 'Collection details?' });
});
