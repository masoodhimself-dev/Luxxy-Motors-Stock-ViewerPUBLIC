import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ ai: { enabled: true, remaining: 10, busy: false, error: '', run: vi.fn() } }));
vi.mock('@/lib/ai-assistance', () => ({ useAiAssistance: () => state.ai }));
import { AiFeatureExplanation } from './ai-feature-explanation';

beforeEach(() => { state.ai.run.mockReset().mockResolvedValue(null); });

it('does not show an old explanation under a newly selected feature', async () => {
  let resolve!: (reply: { answer: string }) => void;
  state.ai.run.mockImplementation(() => new Promise(done => { resolve = done; }));
  render(<AiFeatureExplanation vehicleId="ford" features={['Heated seats', 'Parking sensors']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Explain a feature' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain this feature' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Feature' }), { target: { value: 'Parking sensors' } });
  await act(async () => resolve({ answer: 'A late explanation of heated seats' }));
  expect(screen.queryByText('A late explanation of heated seats')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Feature' })).toHaveValue('Parking sensors');
});

it('ignores a response after dismissal and keeps the explanation sheet closed for another car', async () => {
  let resolve!: (reply: { answer: string }) => void;
  state.ai.run.mockImplementation(() => new Promise(done => { resolve = done; }));
  const view = render(<AiFeatureExplanation vehicleId="ford" features={['Heated seats']} />);
  fireEvent.click(screen.getByRole('button', { name: 'Explain a feature' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain this feature' }));
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await act(async () => resolve({ answer: 'A late explanation from a closed sheet' }));
  fireEvent.click(screen.getByRole('button', { name: 'Explain a feature' }));
  expect(screen.queryByText('A late explanation from a closed sheet')).not.toBeInTheDocument();
  view.rerender(<AiFeatureExplanation vehicleId="volvo" features={['Parking sensors']} />);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
