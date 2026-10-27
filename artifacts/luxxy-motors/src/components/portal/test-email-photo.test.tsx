import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { customFetch } from '@workspace/api-client-react';
import { TestEmailButton } from './test-email';

vi.mock('@workspace/api-client-react', async original => ({...await original<object>(),customFetch:vi.fn()}));

it('shows the photo attachment before the staff member sends the test message',async()=>{
  vi.mocked(customFetch).mockResolvedValue({to:'test@example.org',from:'Dealer <dealer@example.org>',subject:'TEST',text:'Hello',html:'<html><body>Branded layout</body></html>',previewId:'preview-1',photos:['TEST-photo-1.jpg']} as never);
  render(<TestEmailButton sessionId="test-session" enquiryId="test-enquiry" templateId="service_history" photos={['data:image/jpeg;base64,example']}/>);
  fireEvent.click(screen.getByRole('button',{name:'Preview test email'}));
  expect(await screen.findByText('Photos attached: TEST-photo-1.jpg')).toBeVisible();
  expect(screen.getByText('Dealer <dealer@example.org>')).toBeVisible();
  const frame=screen.getByTitle('Test email layout');expect(frame).toHaveAttribute('sandbox','');expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");expect(frame.getAttribute('srcdoc')).toContain('Branded layout');
  const [path,options]=vi.mocked(customFetch).mock.calls[0];
  expect(path).toBe('/api/sales-test/sessions/test-session/email-preview');
  expect(JSON.parse(String(options?.body))).toMatchObject({enquiryId:'test-enquiry',templateId:'service_history',photos:['data:image/jpeg;base64,example']});
  expect(vi.mocked(customFetch)).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button',{name:'Send test email'})).toBeEnabled();
});
