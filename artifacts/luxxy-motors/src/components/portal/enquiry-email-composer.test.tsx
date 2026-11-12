import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
const state = vi.hoisted(() => ({
  fetch: vi.fn(),
  close: vi.fn(),
  features: { customerEmails: true },
}));
vi.mock('@/lib/dealer-features', () => ({ useDealerFeatures: () => ({ data: { features: state.features }, enabled: (key: 'customerEmails') => state.features[key], isLoading: false, isError: false }) }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
  getGetDealerSettingsQueryKey: () => ['/api/dealer-settings'],
}));
vi.mock("./enquiry-workspace-tools", () => ({
  useRefreshDesk: () => async () => {},
  workspaceError: (cause: { data?: { error?: string } }) =>
    cause.data?.error || "Could not save this draft.",
}));
import { EnquiryEmailComposer } from "./enquiry-email-composer";

const declarationContent = { subject: 'Your test-drive declaration', message: 'Please read and sign: https://example.test/test-drive-declaration/private-token', appendText: 'Declaration: https://example.test/test-drive-declaration/private-token', link: 'https://example.test/test-drive-declaration/private-token' };

const entry = { id: "enquiry-one", customerName: "Alex", reference: "ENQ-001" };
function context(second = false) {
  return {
    version: 4,
    savedDraft: null,
    email: second ? "jordan@example.test" : "alex@example.test",
    customerName: second ? "Jordan" : "Alex",
    vehicleId: "car-one",
    vehicleTitle: "Ford Fiesta",
    reference: "ENQ-001",
    revision: 2,
    vehicleAvailable: true,
    appointmentAvailable: true,
    defaults: {
      subject: second ? "Jordan’s original subject" : "Original subject",
      message: "Original staff message",
    },
    ready: true,
    templates: [
      {
        id: "vehicle_details",
        label: "Vehicle details",
        subject: "Template subject",
        message: "Template reply",
      },
    ],
    invoices: [
      {
        id: "invoice-one",
        title: "Full invoice",
        number: "INV-001",
        saleId: "sale-one",
        issuedAt: "2026-10-17",
      },
    ],
    photos: [{ id: "photo-one", byte_size: 1024, category: "service_book" }],
    deliveries: [],
  };
}
function mount(
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  const content = (value = entry) => (
    <QueryClientProvider client={client}>
      <EnquiryEmailComposer entry={value} onClose={state.close} />
    </QueryClientProvider>
  );
  return { ...render(content()), content, client };
}
const calls = (suffix: string) =>
  state.fetch.mock.calls.filter(
    (call) => call[0].endsWith(suffix) && call[1]?.method === "POST",
  );
it('keeps the server review and manual send steps in the embedded reply editor', async () => {
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmailComposer inline entry={entry} onClose={state.close} /></QueryClientProvider>);
  await screen.findByRole('textbox', {name:'Message'});
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name:'Send email'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name:'Review email'}));
  await screen.findByRole('region', {name:'Email preview'});
  expect(calls('/email-preview')).toHaveLength(1);
  expect(calls('/email')).toHaveLength(0);
  expect(screen.getByRole('button', {name:'Send email'})).toBeEnabled();
});

it('inserts checked facts once without replacing the initial server wording or sending', async () => {
  const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
  const content = (id:number) => <QueryClientProvider client={client}><EnquiryEmailComposer inline entry={entry} insertion={{id,text:'Checked road quote: £68.60.'}} onClose={state.close} /></QueryClientProvider>;
  const view=render(content(1));
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Original staff message\n\nChecked road quote: £68.60.'));
  fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'Staff edits retained'}});
  view.rerender(content(1));
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Staff edits retained');
  view.rerender(content(2));
  await waitFor(()=>expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Staff edits retained\n\nChecked road quote: £68.60.'));
  expect(calls('/email')).toHaveLength(0);
  expect(calls('/email-draft')).toHaveLength(0);
});

it('blocks a WhatsApp handoff when fresh context no longer matches the checked vehicle revision', async () => {
  let reads=0;
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),revision:++reads===1?2:3}:original(url,options));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmailComposer inline channel="whatsapp" entry={entry} customerPhone="07700900123" onClose={state.close} /></QueryClientProvider>);
  await screen.findByRole('textbox',{name:'Message'});
  fireEvent.click(screen.getByRole('button',{name:'WhatsApp'}));
  expect(await screen.findByText(/This enquiry changed/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(state.fetch.mock.calls.some(c=>String(c[0]).includes('/whatsapp/enquiries'))).toBe(false);
  expect(calls('/email')).toHaveLength(0);
});
beforeEach(() => {
  state.close.mockReset();
  state.features = { customerEmails: true };
  state.fetch.mockReset().mockImplementation(async (url: string) => {
    if (url.endsWith("/email-context")) return context(url.includes("enquiry-two"));
    if (url.endsWith("/email-draft")) return { version: 5 };
    if (url.includes("/photos/")) return new Blob([], { type: "image/jpeg" });
    if (url.endsWith("/email-preview"))
      return {
        to: "alex@example.test",
        subject: "Previewed subject",
        text: "Previewed draft",
        previewHash: "a".repeat(64),
        attachments: [],
      };
    throw new Error(`Unexpected request: ${url}`);
  });
});

it("uses the sharing window recipient for a fresh message without duplicating vehicle details", async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EnquiryEmailComposer entry={entry} initialRecipient=" chosen@example.test " suggestedContent={{ label: "Shared message", subject: "Car photos", message: "Here are the car details and links.", includeVehicle: false }} onClose={state.close} /></QueryClientProvider>);
  expect(await screen.findByRole("textbox", { name: "Customer email" })).toHaveValue("chosen@example.test");
  expect(screen.getByRole("checkbox", { name: "Vehicle details and current price" })).not.toBeChecked();
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Here are the car details and links.");
  expect(calls("/email")).toHaveLength(0);
});

it("preserves a saved recipient and requires explicit approval to replace it", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    const result = await original(url, options);
    return url.endsWith("/email-context") ? { ...result, savedDraft: { version: 4, status: "draft", content: { to: "saved@example.test", subject: "Saved subject", message: "Saved message", includeVehicle: true, includeAppointment: false, photoIds: [], documentIds: [], expectedRevision: 2 } } } : result;
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EnquiryEmailComposer entry={entry} initialRecipient="chosen@example.test" onClose={state.close} /></QueryClientProvider>);
  expect(await screen.findByRole("textbox", { name: "Customer email" })).toHaveValue("saved@example.test");
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Saved message");
  fireEvent.click(screen.getByRole("button", { name: "Use email address chosen@example.test" }));
  expect(screen.getByRole("textbox", { name: "Customer email" })).toHaveValue("chosen@example.test");
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Saved message");
});

it("keeps a saved draft until staff choose the sale update, then locks the saved sale recipient", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    const result = await original(url, options);
    return url.endsWith("/email-context") ? { ...result, savedDraft: { version: 4, status: "draft", content: { to: "previous@example.test", subject: "Saved subject", message: "Previous message", includeVehicle: true, includeAppointment: true, photoIds: ["photo-one"], documentIds: ["invoice-one"], expectedRevision: 2 } } } : result;
  });
  const verifyContext = vi.fn().mockResolvedValue(undefined);
  render(<QueryClientProvider client={new QueryClient()}><EnquiryEmailComposer entry={entry}
    initialRecipient="alex@example.test" fixedRecipient="alex@example.test" verifyContext={verifyContext}
    suggestedContent={{ label: "Customer update", applyLabel: "Use this customer update", subject: "Deposit received", message: "We have received your deposit.", includeVehicle: false }}
    onClose={state.close} /></QueryClientProvider>);
  const recipient = await screen.findByRole("textbox", { name: "Customer email" });
  expect(recipient).toHaveValue("previous@example.test");
  expect(recipient).toHaveAttribute("readonly");
  expect(screen.getByRole("button", { name: "Review email" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Use this customer update" }));
  expect(recipient).toHaveValue("alex@example.test");
  expect(calls("/email-draft")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  await screen.findByRole("region", { name: "Email preview" });
  expect(verifyContext).toHaveBeenCalledOnce();
  expect(JSON.parse(calls("/email-preview")[0][1].body)).toMatchObject({
    to: "alex@example.test", subject: "Deposit received", message: "We have received your deposit.",
    includeVehicle: false, includeAppointment: false, photoIds: [], documentIds: [],
  });
  expect(calls("/email")).toHaveLength(0);
});

it("reviews and approves a sale update without saving over the Inbox draft", async () => {
  const original = state.fetch.getMockImplementation()!;
  const requestId = "00000000-0000-4000-8000-000000000042";
  const saleUpdate = { saleId: "00000000-0000-4000-8000-000000000021", revision: 3, kind: "deposit" as const };
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    if (url.endsWith("/email")) return { delivery: { id: "fixture-delivery", status: "sent", to: "alex@example.test", subject: "Deposit received" } };
    const result = await original(url, options);
    if (url.endsWith("/email-preview")) return { ...result, saleUpdateRequestId: requestId };
    return url.endsWith("/email-context") ? { ...result, savedDraft: { version: 4, status: "draft", content: { to: "previous@example.test", subject: "Saved subject", message: "Keep the Inbox draft", includeVehicle: true, includeAppointment: true, photoIds: ["photo-one"], documentIds: ["invoice-one"], expectedRevision: 2 } } } : result;
  });
  render(<QueryClientProvider client={new QueryClient()}><EnquiryEmailComposer entry={entry}
    initialRecipient="alex@example.test" fixedRecipient="alex@example.test" saleUpdate={saleUpdate}
    suggestedContent={{ label: "Customer update", subject: "Deposit received", message: "We have received your deposit.", includeVehicle: false }}
    onClose={state.close} /></QueryClientProvider>);
  expect(await screen.findByRole("textbox", { name: "Message" })).toHaveValue("We have received your deposit.");
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveAttribute("readonly");
  expect(screen.queryByRole("button", { name: "Save draft" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "WhatsApp" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  await screen.findByRole("region", { name: "Email preview" });
  expect(JSON.parse(calls("/email-preview")[0][1].body)).toMatchObject({ saleUpdate, to: "alex@example.test" });
  expect(calls("/email-draft")).toHaveLength(0);
  expect(calls("/email")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Send email" }));
  await waitFor(() => expect(calls("/email")).toHaveLength(1));
  const approved = JSON.parse(calls("/email")[0][1].body);
  expect(approved).toMatchObject({ saleUpdate, requestId, to: "alex@example.test" });
  expect(approved).not.toHaveProperty("savedDraftVersion");
});

it("reviews a fresh sale-update attempt after confirmed failure and sends only after approval", async () => {
  const original = state.fetch.getMockImplementation()!;
  const requestIds = ["00000000-0000-4000-8000-000000000043", "00000000-0000-4000-8000-000000000044"];
  const saleUpdate = { saleId: "00000000-0000-4000-8000-000000000022", revision: 3, kind: "deposit" as const };
  let previews = 0, sends = 0;
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    if (url.endsWith("/email")) {
      sends++;
      return { delivery: { id: `fixture-${sends}`, status: sends === 1 ? "failed" : "sent",
        to: "alex@example.test", subject: "Deposit received", error: sends === 1 ? "Provider rejected this message." : null } };
    }
    const result = await original(url, options);
    return url.endsWith("/email-preview") ? { ...result, saleUpdateRequestId: requestIds[previews++] } : result;
  });
  render(<QueryClientProvider client={new QueryClient()}><EnquiryEmailComposer entry={entry}
    initialRecipient="alex@example.test" fixedRecipient="alex@example.test" saleUpdate={saleUpdate}
    suggestedContent={{ label: "Customer update", subject: "Deposit received", message: "We have received your deposit.", includeVehicle: false }}
    onClose={state.close} /></QueryClientProvider>);
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  fireEvent.click(await screen.findByRole("button", { name: "Send email" }));
  fireEvent.click(await screen.findByRole("button", { name: "Review and retry" }));
  const send = await screen.findByRole("button", { name: "Send email" });
  expect(calls("/email")).toHaveLength(1);
  fireEvent.click(send);
  await waitFor(() => expect(calls("/email")).toHaveLength(2));
  expect(calls("/email").map(call => JSON.parse(call[1].body).requestId)).toEqual(requestIds);
  expect(calls("/email-draft")).toHaveLength(0);
});

const linkedReplyId = "a45ce3ce-6269-4f57-891b-b8e9fd716fea";
const verifiedReplyAddress = "verified-reply@example.test";

it("uses the verified sender of the linked reply for a fresh message", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) =>
    url.endsWith(`/email-context?enquiryReplyId=${linkedReplyId}`)
      ? { ...context(), replyRecipient: { id: linkedReplyId, from: verifiedReplyAddress, subject: "Re: Still available?" } }
      : original(url, options));
  render(<QueryClientProvider client={new QueryClient()}><EnquiryEmailComposer entry={entry} linkedReply enquiryReplyId={linkedReplyId} onClose={state.close} /></QueryClientProvider>);
  expect(await screen.findByRole("textbox", { name: "Customer email" })).toHaveValue(verifiedReplyAddress);
  expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("Re: Still available?");
  expect(calls("/email-draft")).toHaveLength(0);
  expect(calls("/email")).toHaveLength(0);
});

it("keeps a saved draft until staff select the reply address and binds the review to that reply", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    if (url.endsWith(`/email-context?enquiryReplyId=${linkedReplyId}`)) return {
      ...context(),
      replyRecipient: { id: linkedReplyId, from: verifiedReplyAddress, subject: "Re: Still available?" },
      savedDraft: { version: 4, status: "draft", content: { to: "saved@example.test", subject: "Saved subject", message: "Saved message", includeVehicle: false, includeAppointment: false, photoIds: [], documentIds: [], expectedRevision: 2 } },
    };
    const result = await original(url, options);
    return url.endsWith("/email-preview") ? { ...result, to: verifiedReplyAddress, repliesInInbox: true } : result;
  });
  render(<QueryClientProvider client={new QueryClient()}><EnquiryEmailComposer entry={entry} linkedReply enquiryReplyId={linkedReplyId} onClose={state.close} /></QueryClientProvider>);
  expect(await screen.findByRole("textbox", { name: "Customer email" })).toHaveValue("saved@example.test");
  expect(screen.getByRole("button", { name: "Review email" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Use reply address" }));
  expect(screen.getByRole("textbox", { name: "Customer email" })).toHaveValue(verifiedReplyAddress);
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Saved message");
  expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue("Saved subject");
  expect(calls("/email-draft")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  await screen.findByRole("region", { name: "Email preview" });
  expect(JSON.parse(calls("/email-preview")[0][1].body)).toMatchObject({ enquiryReplyId: linkedReplyId, to: verifiedReplyAddress });
  expect(JSON.parse(calls("/email-draft")[0][1].body).content).not.toHaveProperty("enquiryReplyId");
  expect(calls("/email")).toHaveLength(0);
});

it("does not fall back to the contact address for a stale linked reply", async () => {
  state.fetch.mockResolvedValue({ ...context(), replyRecipient: null });
  render(<QueryClientProvider client={new QueryClient()}><EnquiryEmailComposer entry={entry} linkedReply enquiryReplyId={linkedReplyId} onClose={state.close} /></QueryClientProvider>);
  expect(await screen.findByRole("textbox", { name: "Customer email" })).toHaveValue("");
  expect(screen.getByText(/This link could not select a customer reply/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Review email" })).toBeDisabled();
  expect(calls("/email")).toHaveLength(0);
});

it("links message wording to Settings while the sender is unconfigured", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    const result = await original(url, options);
    return url.endsWith("/email-context") ? { ...result, ready: false } : result;
  });
  mount();
  expect(
    await screen.findByRole("link", {
      name: "Message settings",
    }),
  ).toHaveAttribute("href", "/portal?section=settings&settingsTab=emails");
  expect(calls("/email")).toHaveLength(0);
});

it('prepares a declaration message without saving or sending it automatically', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EnquiryEmailComposer entry={entry} initialContent={declarationContent} onClose={state.close}/></QueryClientProvider>);
  expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue(declarationContent.message);
  expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue(declarationContent.subject);
  expect(screen.getByRole('textbox', { name: 'Customer email' })).toHaveValue('alex@example.test');
  expect(calls('/email')).toHaveLength(0);
  expect(calls('/email-draft')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Add declaration link' })).not.toBeInTheDocument();
});

it('preserves an existing draft and adds the declaration link only when staff request it', async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options: unknown) => {
    const result = await original(url, options);
    return url.endsWith('/email-context') ? { ...result, savedDraft: { version: 4, status: 'draft', source: 'staff', content: { to: 'chosen@example.test', subject: 'Keep my subject', message: 'Keep my staff message', photoIds: [], documentIds: [], includeVehicle: true, includeAppointment: true, expectedRevision: 2 } } } : result;
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EnquiryEmailComposer entry={entry} initialContent={declarationContent} onClose={state.close}/></QueryClientProvider>);
  expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Keep my staff message');
  fireEvent.click(screen.getByRole('button', { name: 'Add declaration link' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(`Keep my staff message\n\n${declarationContent.appendText}`);
  expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('Keep my subject');
  expect(screen.getByRole('textbox', { name: 'Customer email' })).toHaveValue('chosen@example.test');
  expect(calls('/email')).toHaveLength(0);
  expect(calls('/email-draft')).toHaveLength(0);
});

it('keeps unsaved declaration email edits and allows draft saving when its link becomes unusable', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (sendBlockedReason?: string) => <QueryClientProvider client={client}><EnquiryEmailComposer entry={entry} initialContent={declarationContent} sendBlockedReason={sendBlockedReason} onClose={state.close}/></QueryClientProvider>;
  const view = render(content());
  await screen.findByRole('textbox', { name: 'Message' });
  const text = `My unsaved explanation.\n\n${declarationContent.message}`;
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: text } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Subject' }), { target: { value: 'Keep this private visit subject' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Customer email' }), { target: { value: 'chosen@example.test' } });
  view.rerender(content('This declaration link was revoked.'));
  expect(screen.getByText(/This declaration link was revoked/)).toHaveTextContent('Your text is kept here and can be saved as a draft.');
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(text);
  expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue('Keep this private visit subject');
  expect(screen.getByRole('textbox', { name: 'Customer email' })).toHaveValue('chosen@example.test');
  expect(calls('/email-draft')).toHaveLength(0);
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved · not sent');
  expect(JSON.parse(calls('/email-draft')[0][1].body).content).toMatchObject({ message: text, subject: 'Keep this private visit subject', to: 'chosen@example.test' });
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  expect(await screen.findByRole('button', { name: 'Send email' })).toBeDisabled();
  expect(calls('/email')).toHaveLength(0);
  expect(state.close).not.toHaveBeenCalled();
});

it('disables a reviewed send when declaration status changes without losing the prepared message', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = (sendBlockedReason?: string) => <QueryClientProvider client={client}><EnquiryEmailComposer entry={entry} initialContent={declarationContent} sendBlockedReason={sendBlockedReason} onClose={state.close}/></QueryClientProvider>;
  const view = render(content());
  await screen.findByRole('textbox', { name: 'Message' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'An edited message ready for review.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send email' })).toBeEnabled());
  view.rerender(content('The customer has already signed. Check the record before sending.'));
  expect(screen.getByRole('button', { name: 'Send email' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
  expect(calls('/email')).toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue('An edited message ready for review.');
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  expect(state.close).not.toHaveBeenCalled();
});

it.each(["dialog", "compact reply"] as const)("waits for the latest saved draft with cached defaults in the %s", async (surface) => {
  const original = state.fetch.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  state.fetch.mockImplementation((url: string, options?: unknown) =>
    url.endsWith("/email-context")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(url, options),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(["enquiry-email-context", entry.id], context());
  const compact = surface === "compact reply";
  render(
    <QueryClientProvider client={client}>
      <EnquiryEmailComposer
        inline={compact}
        compact={compact}
        entry={entry}
        onClose={state.close}
      />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Loading latest email details…")).toBeInTheDocument();
  expect(
    screen.queryByRole("textbox", { name: "Message" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    finish({
      ...context(),
      version: 8,
      savedDraft: {
        version: 8,
        status: "draft",
        source: "manual",
        updatedAt: "2026-10-17T11:00:00Z",
        content: {
          to: "alex@example.test",
          subject: "A teammate’s saved subject",
          message: "A teammate’s saved reply",
          includeVehicle: true,
          includeAppointment: false,
          photoIds: [],
          documentIds: [],
          expectedRevision: 2,
        },
      },
    });
  });
  const message = await screen.findByRole("textbox", { name: "Message" });
  expect(message).toHaveValue(
    "A teammate’s saved reply",
  );
  fireEvent.change(message, { target: { value: "Staff edited the latest reply" } });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  await screen.findByText("Draft saved · not sent");
  expect(JSON.parse(calls("/email-draft")[0][1].body)).toMatchObject({
    expectedVersion: 8,
    content: {
      subject: "A teammate’s saved subject",
      message: "Staff edited the latest reply",
    },
  });
});

it("inserts checked facts after an identical cached-context refetch becomes ready, preserving default or saved wording", async () => {
  const original = state.fetch.getMockImplementation()!;
  for (const saved of [false, true]) {
    const cached = { ...context(), ...(saved ? { savedDraft: { version: 4, status: "draft", source: "manual", content: { to: "saved@example.test", subject: "Keep the saved subject", message: "Keep the saved staff wording", includeVehicle: true, includeAppointment: false, photoIds: [], documentIds: [], expectedRevision: 2 } } } : {}) };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["enquiry-email-context", entry.id], cached);
    let finish!: (value: unknown) => void;
    state.fetch.mockImplementation((url: string, options?: unknown) => url.endsWith("/email-context") ? new Promise(resolve => { finish = resolve; }) : original(url, options));
    const view = render(<QueryClientProvider client={client}><EnquiryEmailComposer inline entry={entry} insertion={{ id: 70, text: "Estimated delivery: £57.40." }} onClose={state.close} /></QueryClientProvider>);
    expect(screen.getByText("Loading latest email details…")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Message" })).not.toBeInTheDocument();
    await act(async () => { finish(JSON.parse(JSON.stringify(cached))); });
    // TanStack Query retains the same cached object when fresh bytes are structurally equal.
    expect(client.getQueryData(["enquiry-email-context", entry.id])).toBe(cached);
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(`${saved ? "Keep the saved staff wording" : "Original staff message"}\n\nEstimated delivery: £57.40.`));
    expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(saved ? "Keep the saved subject" : "Original subject");
    expect(screen.getByRole("textbox", { name: "Customer email" })).toHaveValue(saved ? "saved@example.test" : "alex@example.test");
    expect(calls("/email-draft")).toHaveLength(0);
    expect(calls("/email-preview")).toHaveLength(0);
    expect(calls("/email")).toHaveLength(0);
    view.unmount();
    client.clear();
  }
});

it("does not overwrite unsaved staff edits when the context refetches", async () => {
  const original = state.fetch.getMockImplementation()!;
  let fresh = context();
  state.fetch.mockImplementation((url: string, options?: unknown) =>
    url.endsWith("/email-context")
      ? Promise.resolve(fresh)
      : original(url, options),
  );
  const view = mount();
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.change(screen.getByRole("textbox", { name: "Message" }), {
    target: { value: "Keep this unsaved staff reply" },
  });
  fresh = {
    ...context(),
    defaults: {
      subject: "New server default",
      message: "New server default reply",
    },
  };
  await act(async () => {
    await view.client.refetchQueries({
      queryKey: ["enquiry-email-context", entry.id],
      exact: true,
    });
  });
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue(
    "Keep this unsaved staff reply",
  );
  expect(screen.getByRole("textbox", { name: "Subject" })).toHaveValue(
    "Original subject",
  );
  expect(calls("/email-draft")).toHaveLength(0);
});

it("labels saving separately from preparing an email preview", async () => {
  const original = state.fetch.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  state.fetch.mockImplementation((url: string, options?: unknown) =>
    url.endsWith("/email-draft")
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(url, options),
  );
  mount();
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(screen.getByRole("button", { name: "Saving draft…" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Review email" })).toBeDisabled();
  expect(screen.queryByText("Preparing preview…")).not.toBeInTheDocument();
  await act(async () => {
    finish({ version: 5 });
  });
  expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
  expect(calls("/email-preview")).toHaveLength(0);
});

it("shows the exact server design before an explicitly requested email send", async () => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options?: unknown) => {
    const result = await original(url, options);
    if (url.endsWith("/email-preview"))
      return {
        ...result,
        html: '<html><body><h1>Approved Test Motors design</h1><p>Original staff message</p><a href="https://dealer.example/car">View car</a></body></html>',
      };
    return result;
  });
  mount();
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  const frame = await screen.findByTitle("Customer email design preview");
  expect(frame.getAttribute("srcdoc")).toContain("Approved Test Motors design");
  expect(frame).toHaveAttribute("sandbox", "");
  expect(calls("/email")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Plain text" }));
  expect(screen.getByText("Previewed draft")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send email" })).toBeEnabled();
  expect(calls("/email")).toHaveLength(0);
});

it.each([
  {
    templateId: "invoice_copy",
    checkbox: /Full invoice.*INV-001/,
    warning: /Choose an invoice to attach/,
  },
  {
    templateId: "service_history",
    checkbox: /Service book.*Photo 1/,
    warning: /Choose at least one service-book photo/,
  },
  {
    templateId: "pre_accident_photos",
    checkbox: /Pre-accident.*Photo 2/,
    warning: /Choose at least one pre-accident photo/,
  },
])(
  "requires the promised attachment for $templateId without blocking an unfinished draft save",
  async ({ templateId, checkbox, warning }) => {
    const original = state.fetch.getMockImplementation()!;
    state.fetch.mockImplementation((url: string, options?: unknown) =>
      url.endsWith("/email-context")
        ? Promise.resolve({
            ...context(),
            photos: [
              ...context().photos,
              { id: "photo-two", byte_size: 1024, category: "pre_accident" },
            ],
            templates: [
              {
                id: templateId,
                label: "Attachment template",
                subject: "Your documents",
                message: "Please find your documents attached.",
              },
            ],
          })
        : original(url, options),
    );
    mount();
    fireEvent.change(
      await screen.findByRole("combobox", { name: "Email template" }),
      { target: { value: templateId } },
    );
    if (templateId !== "invoice_copy") {
      fireEvent.click(screen.getByText(/Service-book & history photos/, { selector: "summary" }));
      await screen.findByRole("checkbox", { name: checkbox });
    }
    expect(screen.getByRole("checkbox", { name: checkbox })).toBeChecked();
    expect(screen.getByRole("button", { name: "Review email" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: checkbox }));
    expect(screen.getByText(warning)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review email" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled();
    fireEvent.submit(
      screen.getByRole("button", { name: "Review email" }).closest("form")!,
    );
    expect(calls("/email-preview")).toHaveLength(0);
    expect(calls("/email")).toHaveLength(0);
    expect(calls("/email-draft")).toHaveLength(0);
  },
);

it("keeps edited emails on Close until staff choose to discard the changes", async () => {
  mount();
  fireEvent.change(await screen.findByRole("textbox", { name: "Message" }), { target: { value: "Please keep this draft" } });
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(state.close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  expect(screen.getByRole("textbox", { name: "Message" })).toHaveValue("Please keep this draft");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(state.close).toHaveBeenCalledWith("draft");
  expect(calls("/email")).toHaveLength(0);
});

it("opens the preview at its heading and leaves private photo requests on demand", async () => {
  mount();
  await screen.findByRole("textbox", { name: "Message" });
  expect(state.fetch.mock.calls.some(call => String(call[0]).includes("/photos/"))).toBe(false);
  const body = document.querySelector(".enquiry-email-scroll")!;
  body.scrollTop = 400;
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  const title = await screen.findByRole("heading", { name: "Review customer email" });
  expect(title).toHaveFocus();
  expect(body.scrollTop).toBe(0);
  expect(calls("/email")).toHaveLength(0);
});

it("disables discard choices during a draft save and removes the warning once the same edits are saved", async () => {
  let finish!: (value: object) => void;
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation((url: string, options?: unknown) => url.endsWith("/email-draft")
    ? new Promise(resolve => { finish = resolve; }) : original(url, options));
  mount();
  fireEvent.change(await screen.findByRole("textbox", { name: "Message" }), { target: { value: "Save this fictional note." } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
  expect(screen.getByRole("button", { name: "Keep editing" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Discard changes" })).toBeDisabled();
  await act(async () => { finish({ version: 5 }); });
  await screen.findByText("Draft saved · not sent");
  expect(screen.queryByRole("button", { name: "Discard changes" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(state.close).toHaveBeenCalledWith("draft");
  expect(calls("/email")).toHaveLength(0);
});

it.each([
  { action: "Close", status: "sent", result: "sent", heading: "Submitted to Resend" },
  { action: "Escape", status: "sent", result: "sent", heading: "Submitted to Resend" },
  { action: "Outside", status: "sent", result: "sent", heading: "Submitted to Resend" },
  { action: "Close", status: "unknown", result: "draft", heading: "Acceptance unconfirmed" },
])("returns $result after $action dismisses a $status email without sending another copy", async ({ action, status, result, heading }) => {
  const original = state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async (url: string, options?: { method?: string }) => url.endsWith("/email") && options?.method === "POST"
    ? { delivery: { id: "accepted-close-fixture", requestId: "close-fixture-request", to: "alex@example.test", subject: "Reviewed reply", status, photoCount: 0, createdAt: "2026-11-02T10:00:00Z", error: null } }
    : original(url, options));
  mount();
  await screen.findByRole("textbox", { name: "Message" });
  fireEvent.click(screen.getByRole("button", { name: "Review email" }));
  fireEvent.click(await screen.findByRole("button", { name: "Send email" }));
  await screen.findByRole("heading", { name: heading });
  await waitFor(() => expect(screen.getByRole("button", { name: "Close" })).toBeEnabled());
  if (action === "Escape") fireEvent.keyDown(document, { key: "Escape" });
  else if (action === "Outside") {
    // Radix defers its document listener until the opening pointer event ends.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    const overlay = document.querySelector("[data-popup-overlay]")!;
    fireEvent.pointerDown(overlay, { button: 0, pointerType: "mouse" });
    fireEvent.click(overlay, { button: 0 });
  }
  else fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(state.close).toHaveBeenCalledExactlyOnceWith(result));
  expect(calls("/email")).toHaveLength(1);
});

it('refreshes a queued email from its journal without making a second send request', async () => {
  const original = state.fetch.getMockImplementation()!;
  let submitted = false, completed = false;
  const delivery = { id: 'delivery-one', requestId: 'approved-request', to: 'alex@example.test', subject: 'Approved reply', status: 'sending', photoCount: 0, documentCount: 0, createdAt: '2026-10-17T10:00:00Z', error: 'The provider is busy. The approved email will retry automatically.', retryAt: '2026-10-17T10:01:00Z', attempts: 1 };
  state.fetch.mockImplementation(async (url: string, options?: {method?: string}) => {
    if (url.endsWith('/email') && options?.method === 'POST') { submitted = true; return {delivery}; }
    if (url.endsWith('/email-context')) return {...context(), deliveries: submitted ? [{...delivery, ...(completed ? {status: 'sent', retryAt: null, error: null} : {})}] : []};
    return original(url, options);
  });
  mount();
  await screen.findByRole('textbox', {name: 'Message'});
  fireEvent.click(screen.getByRole('button', {name: 'Review email'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Send email'}));
  expect(await screen.findByRole('heading', {name: 'Retry scheduled'})).toBeInTheDocument();
  expect(screen.getByText(/The same approved email is queued/)).toBeInTheDocument();
  completed = true;
  fireEvent.click(screen.getByRole('button', {name: 'Refresh saved status'}));
  expect(await screen.findByRole('heading', {name: 'Submitted to Resend'})).toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Send email'})).not.toBeInTheDocument();
  expect(calls('/email')).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', {name: 'Done'}));
  expect(state.close).toHaveBeenCalledWith('sent');
});

it('keeps uncertain email acceptance protected when a saved-status refresh fails', async () => {
  const original = state.fetch.getMockImplementation()!;
  let failStatus = false;
  state.fetch.mockImplementation(async (url: string, options?: {method?: string}) => {
    if (url.endsWith('/email') && options?.method === 'POST') return {delivery: {id: 'unknown-one', requestId: 'uncertain-request', to: 'alex@example.test', subject: 'Approved reply', status: 'unknown', photoCount: 0, createdAt: '2026-10-17T10:00:00Z', error: 'Check Resend before sending another copy.'}};
    if (url.endsWith('/email-context') && failStatus) throw new Error('Fictional read failure');
    return original(url, options);
  });
  mount();
  await screen.findByRole('textbox', {name: 'Message'});
  fireEvent.click(screen.getByRole('button', {name: 'Review email'}));
  fireEvent.click(await screen.findByRole('button', {name: 'Send email'}));
  await screen.findByRole('heading', {name: 'Acceptance unconfirmed'});
  failStatus = true;
  fireEvent.click(screen.getByRole('button', {name: 'Refresh saved status'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not refresh the saved status');
  expect(screen.getByRole('heading', {name: 'Acceptance unconfirmed'})).toBeInTheDocument();
  expect(screen.queryByRole('button', {name: 'Send email'})).not.toBeInTheDocument();
  expect(calls('/email')).toHaveLength(1);
});

it('refreshes an already observed customer email timeline after manual send and saved-status refresh without sending twice', async () => {
  const original = state.fetch.getMockImplementation()!;
  let submitted = false, completed = false;
  const delivery = { id: 'timeline-delivery', requestId: 'timeline-request', to: 'alex@example.test', subject: 'Approved reply', status: 'unknown', photoCount: 0, createdAt: '2026-10-17T10:00:00Z', error: 'Acceptance not yet confirmed.' };
  state.fetch.mockImplementation(async (url: string, options?: { method?: string }) => {
    if (url.endsWith('/email') && options?.method === 'POST') {
      submitted = true;
      return { delivery };
    }
    if (url.endsWith('/email-context')) return { ...context(), deliveries: submitted ? [{ ...delivery, status: completed ? 'sent' : 'unknown' }] : [] };
    return original(url, options);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const journal = new QueryObserver(client, {
    queryKey: ['staff-email-conversation', `enquiry:${entry.id}`],
    staleTime: Infinity,
    queryFn: async () => ({ messages: submitted ? [{ id: delivery.id, status: completed ? 'sent' : 'unknown' }] : [] }),
  });
  const stop = journal.subscribe(() => {});
  try {
    mount(client);
    await screen.findByRole('textbox', { name: 'Message' });
    await waitFor(() => expect(journal.getCurrentResult().data?.messages).toEqual([]));
    fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
    await screen.findByRole('region', { name: 'Email preview' });
    expect(calls('/email')).toHaveLength(0);
    expect(journal.getCurrentResult().data?.messages).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Send email' }));
    await screen.findByRole('heading', { name: 'Acceptance unconfirmed' });
    await waitFor(() => expect(journal.getCurrentResult().data?.messages).toEqual([{ id: delivery.id, status: 'unknown' }]));
    completed = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved status' }));
    await screen.findByRole('heading', { name: 'Submitted to Resend' });
    await waitFor(() => expect(journal.getCurrentResult().data?.messages).toEqual([{ id: delivery.id, status: 'sent' }]));
    expect(calls('/email')).toHaveLength(1);
  } finally { stop(); }
});

it('prepares appointment follow-up wording without sending or including old appointment details', async () => {
  const suggestedContent = { label: 'Appointment follow-up', subject: 'Any questions about the Yaris?', message: 'Hi Alex,\n\nDo you have any questions? Let us know if you would like to discuss a deposit.' };
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EnquiryEmailComposer entry={entry} suggestedContent={suggestedContent} onClose={state.close} /></QueryClientProvider>);
  expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue(suggestedContent.message);
  expect(screen.getByRole('textbox', { name: 'Subject' })).toHaveValue(suggestedContent.subject);
  expect(screen.getByRole('textbox', { name: 'Customer email' })).toHaveValue('alex@example.test');
  expect(screen.getByRole('checkbox', { name: 'Appointment details' })).not.toBeChecked();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});
it('keeps a saved draft until staff explicitly choose follow-up wording', async () => {
  const suggestedContent = { label: 'Appointment follow-up', subject: 'Follow-up subject', message: 'Gentle follow-up wording' };
  state.fetch.mockImplementation(async (url: string) => url.endsWith('/email-context') ? { ...context(), savedDraft: { version: 4, status: 'draft', source: 'staff', content: { to: 'saved@example.test', subject: 'Saved subject', message: 'Keep my existing message', includeVehicle: true, includeAppointment: true, photoIds: ['photo-one'], documentIds: ['invoice-one'], expectedRevision: 2 } } } : {});
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EnquiryEmailComposer entry={entry} suggestedContent={suggestedContent} onClose={state.close} /></QueryClientProvider>);
  expect(await screen.findByRole('textbox', { name: 'Message' })).toHaveValue('Keep my existing message');
  fireEvent.click(screen.getByRole('button', { name: 'Use appointment follow-up wording' }));
  expect(screen.getByRole('textbox', { name: 'Message' })).toHaveValue(suggestedContent.message);
  expect(screen.getByRole('textbox', { name: 'Customer email' })).toHaveValue('saved@example.test');
  expect(screen.getByRole('checkbox', { name: 'Appointment details' })).not.toBeChecked();
  expect(state.fetch.mock.calls.every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

it('uses a supplied stable follow-up request ID across a lost response and retry', async () => {
  const original = state.fetch.getMockImplementation()!;
  let failed = false;
  state.fetch.mockImplementation(async (url: string, options?: {method?: string}) => {
    if (url.endsWith('/email') && options?.method === 'POST') {
      if (!failed) { failed = true; throw new Error('Network went away'); }
      return { delivery: { id: 'stable-delivery', requestId: '00000000-0000-4000-8000-000000000995', to: 'alex@example.test', subject: 'Approved reply', status: 'sent', photoCount: 0, createdAt: '2026-10-17T10:00:00Z' } };
    }
    return original(url, options);
  });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><EnquiryEmailComposer entry={entry} sendRequestId="00000000-0000-4000-8000-000000000995" onClose={state.close} /></QueryClientProvider>);
  await screen.findByRole('textbox', { name: 'Message' });
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Send email' }));
  await screen.findByText(/Retry uses the same email request/);
  fireEvent.click(screen.getByRole('button', { name: 'Check or retry same email' }));
  await screen.findByRole('heading', { name: 'Submitted to Resend' });
  expect(calls('/email')).toHaveLength(2);
  expect(calls('/email').map(call => JSON.parse(call[1].body).requestId)).toEqual(['00000000-0000-4000-8000-000000000995', '00000000-0000-4000-8000-000000000995']);
});

it("opens review-request defaults without reattaching car or appointment facts",async()=>{
  const defaults={subject:'How is your new car?',message:'Leave an honest review: https://g.page/r/example/review'};
  state.fetch.mockImplementation(async(url:string)=>url.endsWith('/email-context')?{...context(),reviewRequest:true,defaults}:context());
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmailComposer entry={entry} onClose={state.close}/></QueryClientProvider>);
  expect(await screen.findByRole('textbox',{name:'Message'})).toHaveValue(defaults.message);
  expect(screen.getByRole('checkbox',{name:'Vehicle details and current price'})).not.toBeChecked();
  expect(screen.getByRole('checkbox',{name:'Appointment details'})).not.toBeChecked();
  expect(state.fetch.mock.calls.every(([url])=>!String(url).endsWith('/email'))).toBe(true);
});


it('allows a manual draft to be saved and reviewed while customer delivery is disabled', async () => {
  state.features = { customerEmails: false };
  mount();
  await screen.findByRole('textbox', { name: 'Message' });
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Keep this staff-written reply for review.' } });
  expect(screen.getByText(/Email sending is switched off by platform/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await screen.findByText('Draft saved · not sent');
  expect(JSON.parse(calls('/email-draft')[0][1].body)).toMatchObject({ expectedVersion: 4, content: { to: 'alex@example.test', message: 'Keep this staff-written reply for review.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Review email' }));
  expect(await screen.findByRole('button', { name: 'Send email' })).toBeDisabled();
  expect(calls('/email')).toHaveLength(0);
});

it('keeps four selected existing stock-photo links and excludes removed upload and video fields', async () => {
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),vehiclePhotos:Array.from({length:5},(_,index)=>({index,url:`https://example.test/car-${index}.jpg`}))}:original(url,options));
  mount();
  await screen.findByRole('textbox',{name:'Message'});
  fireEvent.click(screen.getByText('Car photographs · optional links').closest('summary')!);
  for(let index=1;index<=4;index++)fireEvent.click(screen.getByRole('checkbox',{name:new RegExp(`Photograph ${index}$`)}));
  expect(screen.getByRole('checkbox',{name:/Photograph 5$/})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Review email'}));
  await screen.findByRole('region',{name:'Email preview'});
  const reviewed=JSON.parse(calls('/email-preview')[0][1].body);
  expect(reviewed.vehiclePhotoIndices).toEqual([0,1,2,3]);
  expect(Object.keys(reviewed).sort()).toEqual(['attachVehiclePdf','documentIds','expectedRevision','includeAppointment','includeVehicle','message','photoIds','subject','to','vehiclePhotoIndices'].sort());
  expect(reviewed.attachVehiclePdf).toBe(false);
  expect(calls('/email')).toHaveLength(0);
});

it('requires explicit refresh of a stale saved enquiry before preserving its manual wording and invoice', async()=>{
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),savedDraft:{version:4,status:'draft',source:'manual',content:{to:'alex@example.test',subject:'Saved subject',message:'Keep my reviewed wording',includeVehicle:true,includeAppointment:false,photoIds:[],documentIds:['invoice-one'],expectedRevision:1}}}:original(url,options));
  mount();
  await screen.findByRole('textbox',{name:'Message'});
  expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();
  expect(screen.getByRole('button',{name:'Review email'})).toBeDisabled();
  fireEvent.click(screen.getByRole('button',{name:'Use latest enquiry details'}));
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Keep my reviewed wording');
  expect(screen.getByRole('checkbox',{name:/Full invoice.*INV-001/})).toBeChecked();
  fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
  await screen.findByText('Draft saved · not sent');
  expect(JSON.parse(calls('/email-draft')[0][1].body)).toMatchObject({expectedVersion:4,content:{expectedRevision:2,message:'Keep my reviewed wording',documentIds:['invoice-one']}});
});

it('does not carry unsaved manual edits into a different customer',async()=>{
  const view=mount();
  await screen.findByRole('textbox',{name:'Message'});
  fireEvent.change(screen.getByRole('textbox',{name:'Message'}),{target:{value:'Private first-customer wording'}});
  view.rerender(view.content({id:'enquiry-two',customerName:'Jordan',reference:'ENQ-002'}));
  expect(await screen.findByRole('textbox',{name:'Subject'})).toHaveValue('Jordan’s original subject');
  expect(screen.getByRole('textbox',{name:'Customer email'})).toHaveValue('jordan@example.test');
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Original staff message');
  fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
  await screen.findByText('Draft saved · not sent');
  expect(calls('/email-draft')[0][0]).toBe('/api/staff/enquiries/enquiry-two/email-draft');
});

it('restores a saved template and switches to a manual draft without losing its text',async()=>{
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),savedDraft:{version:4,status:'draft',source:'template',content:{to:'alex@example.test',templateId:'vehicle_details',subject:'Saved template',message:'Keep the saved text',includeVehicle:true,includeAppointment:false,photoIds:[],documentIds:[],expectedRevision:2}}}:original(url,options));
  mount();
  expect(await screen.findByRole('combobox',{name:'Email template'})).toHaveValue('vehicle_details');
  fireEvent.change(screen.getByRole('combobox',{name:'Email template'}),{target:{value:''}});
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Keep the saved text');
  fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
  await screen.findByText('Draft saved · not sent');
  expect(JSON.parse(calls('/email-draft')[0][1].body).content).not.toHaveProperty('templateId');
});

it('keeps an archived price draft protected until staff explicitly starts current wording',async()=>{
 const original=state.fetch.getMockImplementation()!;
 const stockChange={taskId:'00000000-0000-4000-8000-000000000451',revision:3};
 state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),savedDraft:{version:4,status:'draft',source:'manual',content:{to:'alex@example.test',subject:'Archived price',message:'An old reduction of £500',stockChange,includeVehicle:false,includeAppointment:false,photoIds:[],documentIds:[],expectedRevision:2}}}:original(url,options));
 mount();await screen.findByRole('textbox',{name:'Message'});
 expect(screen.getByRole('alert')).toHaveTextContent('archived price-update draft cannot be sent');
 expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'Review email'})).toBeDisabled();
 expect(screen.getByRole('button',{name:'WhatsApp'})).toBeDisabled();
 expect(calls('/email-draft')).toHaveLength(0);expect(calls('/email')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Start a new message'}));
 expect(screen.getByRole('textbox',{name:'Subject'})).toHaveValue('Original subject');
 expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Original staff message');
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await screen.findByText('Draft saved · not sent');
 expect(JSON.parse(calls('/email-draft')[0][1].body).content).not.toHaveProperty('stockChange');
});

it('keeps inline address, subject and template controls collapsed until staff need them', async () => {
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmailComposer inline entry={entry} onClose={state.close}/></QueryClientProvider>);
  expect(await screen.findByRole('textbox', {name:'Message'})).toBeVisible();
  const details=screen.getByText('Edit address, subject or template').closest('details')!;
  expect(details).not.toHaveAttribute('open');
  expect(details.querySelector('summary')).toHaveTextContent('To: alex@example.test');
  expect(screen.getByRole('textbox', {name:'Subject'})).not.toBeVisible();
  expect(screen.getByRole('textbox', {name:'Customer email'})).not.toBeVisible();
  fireEvent.click(details.querySelector('summary')!);
  await waitFor(()=>expect(details).toHaveAttribute('open'));
  expect(screen.getByRole('textbox', {name:'Subject'})).toBeVisible();
  expect(screen.getByRole('textbox', {name:'Customer email'})).toBeVisible();
  expect(screen.getByRole('combobox', {name:'Email template'})).toBeVisible();
  fireEvent.change(screen.getByRole('textbox', {name:'Subject'}), {target:{value:'My concise subject'}});
  expect(screen.getByRole('textbox', {name:'Message'})).toHaveValue('Original staff message');
  expect(calls('/email')).toHaveLength(0);
});

it('keeps message details open in the standalone email window', async () => {
  mount();
  await screen.findByRole('textbox', {name:'Message'});
  expect(screen.getByText('Edit address, subject or template').closest('details')).toHaveAttribute('open');
  expect(screen.getByRole('textbox', {name:'Customer email'})).toBeVisible();
  expect(screen.getByRole('textbox', {name:'Subject'})).toBeVisible();
  expect(screen.getByRole('combobox', {name:'Email template'})).toBeVisible();
});

it('offers the vehicle PDF only when available, with explicit opt-in and no automatic save or send', async () => {
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),vehiclePdfAvailable:true}:original(url,options));
  mount();
  const pdf=await screen.findByRole('checkbox', {name:/^Attach vehicle PDF/});
  expect(pdf).not.toBeChecked();
  expect(screen.getByText('Photos, specifications and recorded vehicle details')).toBeVisible();
  expect(calls('/email-draft')).toHaveLength(0);
  expect(calls('/email-preview')).toHaveLength(0);
  expect(calls('/email')).toHaveLength(0);
  fireEvent.click(pdf);
  expect(pdf).toBeChecked();
  expect(calls('/email-draft')).toHaveLength(0);
  expect(calls('/email')).toHaveLength(0);
});

it('does not offer a vehicle PDF when the server has no printable current car', async () => {
  mount();
  await screen.findByRole('textbox', {name:'Message'});
  expect(screen.queryByRole('checkbox', {name:/^Attach vehicle PDF/})).not.toBeInTheDocument();
});

it('saves an opted-in PDF with the draft and includes it in the server-reviewed preview', async () => {
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>{
    if(url.endsWith('/email-context')) return {...context(),vehiclePdfAvailable:true};
    const result=await original(url,options);
    return url.endsWith('/email-preview')?{...result,attachments:[{id:'vehicle-pdf',filename:'Ford-Fiesta-vehicle-details.pdf',byteSize:82000}]}:result;
  });
  mount();
  fireEvent.click(await screen.findByRole('checkbox', {name:/^Attach vehicle PDF/}));
  fireEvent.click(screen.getByRole('button', {name:'Save draft'}));
  await screen.findByText('Draft saved · not sent');
  expect(JSON.parse(calls('/email-draft')[0][1].body).content).toMatchObject({attachVehiclePdf:true,message:'Original staff message'});
  fireEvent.click(screen.getByRole('button', {name:'Review email'}));
  await screen.findByRole('region', {name:'Email preview'});
  expect(JSON.parse(calls('/email-preview')[0][1].body)).toMatchObject({attachVehiclePdf:true});
  expect(screen.getByText('Ford-Fiesta-vehicle-details.pdf · 81 KB')).toBeVisible();
  expect(screen.getByRole('button', {name:'Send email'})).toBeEnabled();
  expect(calls('/email')).toHaveLength(0);
});

it('requires a fresh review after removing the PDF from an already reviewed message', async () => {
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),vehiclePdfAvailable:true}:original(url,options));
  mount();
  fireEvent.click(await screen.findByRole('checkbox', {name:/^Attach vehicle PDF/}));
  fireEvent.click(screen.getByRole('button', {name:'Review email'}));
  await screen.findByRole('region', {name:'Email preview'});
  expect(JSON.parse(calls('/email-preview')[0][1].body).attachVehiclePdf).toBe(true);
  fireEvent.click(screen.getByRole('button', {name:'Edit message'}));
  fireEvent.click(screen.getByRole('checkbox', {name:/^Attach vehicle PDF/}));
  expect(screen.queryByRole('region', {name:'Email preview'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name:'Send email'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name:'Review email'}));
  await screen.findByRole('region', {name:'Email preview'});
  expect(calls('/email-preview')).toHaveLength(2);
  expect(JSON.parse(calls('/email-preview')[1][1].body).attachVehiclePdf).toBe(false);
  expect(calls('/email')).toHaveLength(0);
});

it('restores a previously opted-in PDF without selecting it for unrelated fresh messages', async () => {
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),vehiclePdfAvailable:true,savedDraft:{version:4,status:'draft',content:{to:'alex@example.test',subject:'Saved subject',message:'Saved message',includeVehicle:true,attachVehiclePdf:true,includeAppointment:false,photoIds:[],documentIds:[],expectedRevision:2}}}:original(url,options));
  mount();
  expect(await screen.findByRole('checkbox', {name:/^Attach vehicle PDF/})).toBeChecked();
  expect(screen.getByRole('textbox', {name:'Message'})).toHaveValue('Saved message');
  expect(calls('/email')).toHaveLength(0);
});

it('never offers PDF attachment or email sending in the WhatsApp editor', async () => {
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),vehiclePdfAvailable:true}:original(url,options));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmailComposer inline channel="whatsapp" entry={entry} customerPhone="07700900123" onClose={state.close}/></QueryClientProvider>);
  await screen.findByRole('textbox', {name:'Message'});
  expect(screen.queryByRole('checkbox', {name:/^Attach vehicle PDF/})).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name:'Save draft'})).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {name:'Review email'})).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name:'WhatsApp'})).toBeEnabled();
  expect(calls('/email')).toHaveLength(0);
  expect(calls('/email-preview')).toHaveLength(0);
});

it('blocks a saved PDF from silently carrying into a WhatsApp handoff', async () => {
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),vehiclePdfAvailable:true,savedDraft:{version:4,status:'draft',content:{to:'alex@example.test',subject:'Saved subject',message:'Saved message',includeVehicle:true,attachVehiclePdf:true,includeAppointment:false,photoIds:[],documentIds:[],expectedRevision:2}}}:original(url,options));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmailComposer inline channel="whatsapp" entry={entry} customerPhone="07700900123" onClose={state.close}/></QueryClientProvider>);
  await screen.findByRole('textbox', {name:'Message'});
  expect(screen.getByRole('button', {name:'WhatsApp'})).toBeDisabled();
  expect(screen.getByText(/Selected email attachments cannot be included in this handoff/)).toBeVisible();
  expect(calls('/email')).toHaveLength(0);
  expect(state.fetch.mock.calls.some(([url])=>String(url).includes('/whatsapp/enquiries'))).toBe(false);
});

it('lets staff remove a saved PDF when the current car is no longer printable', async () => {
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),vehiclePdfAvailable:false,savedDraft:{version:4,status:'draft',content:{to:'alex@example.test',subject:'Saved subject',message:'Keep this staff reply',includeVehicle:true,attachVehiclePdf:true,includeAppointment:false,photoIds:[],documentIds:[],expectedRevision:2}}}:original(url,options));
  mount();
  const pdf=await screen.findByRole('checkbox',{name:/^Attach vehicle PDF/});
  expect(pdf).toBeChecked();
  expect(pdf).toBeEnabled();
  expect(screen.getByText('PDF unavailable for this car. Remove it to continue.')).toBeVisible();
  fireEvent.click(pdf);
  expect(screen.queryByRole('checkbox',{name:/^Attach vehicle PDF/})).not.toBeInTheDocument();
  expect(screen.getByRole('textbox',{name:'Message'})).toHaveValue('Keep this staff reply');
  fireEvent.click(screen.getByRole('button',{name:'Review email'}));
  await screen.findByRole('region',{name:'Email preview'});
  expect(JSON.parse(calls('/email-preview')[0][1].body).attachVehiclePdf).toBe(false);
  expect(calls('/email')).toHaveLength(0);
});

it('compact Inbox keeps templates, PDFs and invoice options inside Attach without changing the message', async () => {
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),vehiclePdfAvailable:true}:original(url,options));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmailComposer inline compact entry={entry} onClose={state.close}/></QueryClientProvider>);
  await screen.findByRole('textbox', {name:'Message'});
  const attach=screen.getByRole('button', {name:'Attach'});
  const tray=document.getElementById(attach.getAttribute('aria-controls')!)!;
  expect(attach).toHaveAttribute('aria-expanded', 'false');
  expect(tray).toHaveAttribute('hidden');
  expect(screen.queryByText('Edit address, subject or template')).not.toBeInTheDocument();
  expect(screen.getByText('To: alex@example.test').closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('button', {name:/Included: Vehicle details · Appointment details/})).toBeVisible();
  fireEvent.click(attach);
  expect(tray).not.toHaveAttribute('hidden');
  expect(screen.getByRole('combobox', {name:'Email template'})).toBeVisible();
  expect(screen.getByRole('checkbox', {name:/^Attach vehicle PDF/})).not.toBeChecked();
  expect(screen.getByRole('checkbox', {name:/Full invoice/})).toBeVisible();
  fireEvent.click(attach);
  expect(tray).toHaveAttribute('hidden');
  expect(screen.getByRole('textbox', {name:'Message'})).toHaveValue('Original staff message');
  expect(calls('/email')).toHaveLength(0);
  expect(calls('/email-draft')).toHaveLength(0);
});

it('compact PDF selection remains visible in the summary and requires the server review before send', async () => {
  const original=state.fetch.getMockImplementation()!;
  state.fetch.mockImplementation(async(url:string,options:unknown)=>url.endsWith('/email-context')?{...context(),vehiclePdfAvailable:true}:original(url,options));
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmailComposer inline compact entry={entry} onClose={state.close}/></QueryClientProvider>);
  await screen.findByRole('textbox', {name:'Message'});
  fireEvent.click(screen.getByRole('button', {name:'Attach'}));
  fireEvent.click(screen.getByRole('checkbox', {name:/^Attach vehicle PDF/}));
  fireEvent.click(screen.getByRole('button', {name:'Attach'}));
  expect(screen.getByRole('button', {name:/Included: Vehicle PDF/})).toBeVisible();
  fireEvent.click(screen.getByRole('button', {name:'Review & send'}));
  await screen.findByRole('region', {name:'Email preview'});
  expect(calls('/email')).toHaveLength(0);
  expect(JSON.parse(calls('/email-preview')[0][1].body)).toMatchObject({attachVehiclePdf:true});
  expect(screen.getByRole('button', {name:'Send email'})).toBeEnabled();
  fireEvent.click(screen.getByRole('button', {name:'Edit message'}));
  expect(screen.getByRole('textbox', {name:'Message'})).toHaveValue('Original staff message');
  expect(screen.getByRole('button', {name:/Included: Vehicle PDF/})).toBeVisible();
});

it('compact editor omits repeated prepare heading but retains the reviewed email title', async () => {
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmailComposer inline compact entry={entry} onClose={state.close}/></QueryClientProvider>);
  await screen.findByRole('textbox', {name:'Message'});
  expect(screen.queryByRole('heading', {name:'Prepare customer email'})).not.toBeInTheDocument();
  expect(screen.queryByText('Alex · Review before sending')).not.toBeInTheDocument();
  expect(screen.getByRole('region', {name:'Customer reply editor'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name:'Review & send'}));
  await screen.findByRole('region', {name:'Email preview'});
  expect(screen.getByRole('heading', {name:'Review customer email'})).toBeInTheDocument();
  expect(calls('/email')).toHaveLength(0);
});

it('compact Inbox gives one short notice when platform email sending is off', async () => {
  state.features = { customerEmails: false };
  render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><EnquiryEmailComposer inline compact entry={entry} onClose={state.close}/></QueryClientProvider>);
  await screen.findByRole('textbox', {name:'Message'});
  expect(screen.getByText('Email sending is off. You can save drafts.')).toBeVisible();
  expect(screen.queryByText(/Email sending is switched off by platform administration/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', {name:'Save draft'})).toBeEnabled();
  expect(calls('/email')).toHaveLength(0);
});
