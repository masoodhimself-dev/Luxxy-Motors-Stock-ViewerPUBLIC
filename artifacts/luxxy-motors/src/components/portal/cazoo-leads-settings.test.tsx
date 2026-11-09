import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CazooLeadsSettings } from "./cazoo-leads-settings";

const endpoint = "/api/staff/cazoo-leads";
const receiptId = "e1e07107-188f-4655-9774-41efb288815f";
const clients: QueryClient[] = [];

function show(transport: typeof fetch) {
  vi.stubGlobal("fetch", transport);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  render(<QueryClientProvider client={client}><CazooLeadsSettings /></QueryClientProvider>);
  const details = screen.getByText("Cazoo enquiries").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
}

afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});

it("saves an explicit destination only after the owner submits, and can switch forwarding off", async () => {
  let forwarding = { enabled: false, recipient: null as string | null, canManage: true };
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url) === endpoint + "/forwarding" && init?.method === "PUT") {
      forwarding = { ...JSON.parse(String(init.body)), canManage: true };
      return Response.json(forwarding);
    }
    expect(String(url)).toBe(endpoint);
    return Response.json({ enabled: true, mailbox: "leads@example.test", receipts: [], forwarding });
  });
  show(transport);
  const form = within(await screen.findByRole("form", { name: "Cazoo enquiry forwarding" }));
  const toggle = form.getByRole("switch", { name: "Forward new Cazoo enquiries" });
  const save = form.getByRole("button", { name: "Save forwarding" });
  expect(toggle).not.toBeChecked();
  fireEvent.click(toggle);
  expect(save).toBeDisabled();
  fireEvent.change(form.getByLabelText("Destination email"), { target: { value: "owner@example.test" } });
  expect(transport).toHaveBeenCalledTimes(1);
  fireEvent.click(save);
  expect(await form.findByRole("status")).toHaveTextContent("Forwarding turned on.");
  expect(transport).toHaveBeenLastCalledWith(endpoint + "/forwarding", expect.objectContaining({
    method: "PUT", body: JSON.stringify({ enabled: true, recipient: "owner@example.test" }),
  }));
  fireEvent.click(toggle);
  expect(form.queryByLabelText("Destination email")).not.toBeInTheDocument();
  fireEvent.click(save);
  expect(await form.findByRole("status")).toHaveTextContent("Forwarding turned off.");
  expect(transport).toHaveBeenLastCalledWith(endpoint + "/forwarding", expect.objectContaining({
    method: "PUT", body: JSON.stringify({ enabled: false, recipient: null }),
  }));
});

it("lets an owner forward an existing receipt without retrying import or replacing its draft", async () => {
  let queued = false;
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url) === endpoint + "/" + receiptId + "/forward" && init?.method === "POST") {
      queued = true;
      return Response.json({ queued: true, alreadyQueued: false });
    }
    expect(String(url)).toBe(endpoint);
    return Response.json({
      enabled: true, mailbox: "leads@example.test",
      forwarding: { enabled: true, recipient: "owner@example.test", canManage: true },
      receipts: [{
        id: receiptId, status: "imported", subject: "Fictional Cazoo enquiry",
        receivedAt: "2026-11-09T05:42:00Z", draftStatus: "ready",
        canForward: !queued, forwardStatus: queued ? "pending" : null,
      }],
    });
  });
  show(transport);
  fireEvent.click(await screen.findByRole("button", { name: "Forward to owner" }));
  expect(await screen.findByText("Forwarding queued.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Forward to owner" })).not.toBeInTheDocument();
  expect(screen.getByText("AI draft ready — review before sending.")).toBeVisible();
  expect(transport.mock.calls.filter(([, init]) => init?.method === "POST").map(([url]) => url))
    .toEqual([endpoint + "/" + receiptId + "/forward"]);
});

it("does not show forwarding controls or the owner's address to other staff", async () => {
  show(vi.fn(async () => Response.json({
    enabled: true, mailbox: "leads@example.test",
    forwarding: { enabled: true, recipient: "owner@example.test", canManage: false },
    receipts: [{
      id: receiptId, status: "imported", subject: "Fictional Cazoo enquiry",
      receivedAt: "2026-11-09T05:42:00Z", draftStatus: "ready",
      canForward: true, forwardStatus: "cancelled",
    }],
  })));
  expect(await screen.findByText("Forwarding stopped.")).toBeVisible();
  expect(screen.queryByRole("form", { name: "Cazoo enquiry forwarding" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Forward to owner" })).not.toBeInTheDocument();
  expect(screen.queryByDisplayValue("owner@example.test")).not.toBeInTheDocument();
});
