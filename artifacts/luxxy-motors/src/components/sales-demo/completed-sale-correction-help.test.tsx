import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { CompletedSaleCorrectionHelp } from "./completed-sale-correction-help";

it("explains the limits of correcting a completed sale and recording a refund", () => {
  render(<CompletedSaleCorrectionHelp />);
  expect(screen.getByText("Need to correct an issued sale?").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText(/cannot currently be changed here/i)).toHaveTextContent(/accountant/i);
  expect(screen.getByText(/recording a refund does not send money/i)).toHaveTextContent(/changes no payments or documents/i);
});

it('records a note and reference only when staff save, then shows confirmation', async () => {
  const onRecord = vi.fn().mockResolvedValue(undefined);
  render(<CompletedSaleCorrectionHelp canRecord instructions="Ask Sue before sending anything." onRecord={onRecord} />);
  expect(screen.getByText(/Ask Sue before sending/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save correction note', hidden: true })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: ' Customer name was incorrect ' } });
  fireEvent.change(screen.getByLabelText('Accountant or paperwork reference (optional)'), { target: { value: ' REF-12 ' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save correction note', hidden: true }));
  await waitFor(() => expect(onRecord).toHaveBeenCalledWith({ description: 'Customer name was incorrect', reference: 'REF-12' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Correction note saved');
  expect(screen.getByLabelText('What happened?')).toHaveValue('');
});

it('keeps unsaved text if saving fails and shows the existing history', async () => {
  render(<CompletedSaleCorrectionHelp canRecord onRecord={vi.fn().mockRejectedValue(new Error('Please reload the sale.'))} corrections={[{ id:'1', description:'Incorrect surname', reference:'ACC-1', recordedAt:'2026-10-27T10:00:00Z', recordedBy:'Manager' }]} />);
  expect(screen.getByText('Incorrect surname')).toBeInTheDocument();
  expect(screen.getByText('Reference: ACC-1')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Correct address' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save correction note', hidden: true }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Please reload the sale.');
  expect(screen.getByLabelText('What happened?')).toHaveValue('Correct address');
});

it('does not offer recording without sales permissions and reports missing dealership instructions', () => {
  render(<CompletedSaleCorrectionHelp instructionsError />);
  expect(screen.queryByLabelText('What happened?')).not.toBeInTheDocument();
  expect(screen.getByRole('alert', { hidden: true })).toHaveTextContent('could not be loaded');
});

it('retries a failed note without clearing or duplicating its contents', async () => {
  const save = vi.fn().mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce(undefined);
  render(<CompletedSaleCorrectionHelp canRecord onRecord={save} />);
  fireEvent.change(screen.getByLabelText('What happened?'), { target: { value: 'Agreed discount discussed with accountant' } });
  fireEvent.change(screen.getByLabelText('Accountant or paperwork reference (optional)'), { target: { value: 'REF-42' } });
  const button = screen.getByRole('button', { name: 'Save correction note', hidden: true });
  fireEvent.click(button);
  expect(await screen.findByRole('alert')).toHaveTextContent('Network error');
  fireEvent.click(button);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Correction note saved'));
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
});

it('requires a nonblank note, enforces field limits and blocks edits during another sale action', () => {
  render(<CompletedSaleCorrectionHelp canRecord disabled onRecord={async () => {}} />);
  const note = screen.getByLabelText('What happened?');
  expect(note).toHaveAttribute('required');
  expect(note).toHaveAttribute('maxlength', '2000');
  expect(screen.getByLabelText('Accountant or paperwork reference (optional)')).toHaveAttribute('maxlength', '200');
  fireEvent.change(note, { target: { value: 'Details' } });
  expect(screen.getByRole('button', { name: 'Save correction note', hidden: true })).toBeDisabled();
});

it('allows staff to retry fetching dealership instructions', () => {
  const retry = vi.fn();
  render(<CompletedSaleCorrectionHelp instructionsError onRetryInstructions={retry} />);
  fireEvent.click(screen.getByRole('button', { name: 'Retry instructions', hidden: true }));
  expect(retry).toHaveBeenCalledOnce();
});

it('explains deposit invoice protection without claiming the incomplete sale price is locked', () => {
  render(<CompletedSaleCorrectionHelp completed={false} />);
  expect(screen.getByText(/original issued invoice is kept unchanged/i)).toBeInTheDocument();
  expect(screen.queryByText(/completed sale cannot currently be changed/i)).not.toBeInTheDocument();
});
