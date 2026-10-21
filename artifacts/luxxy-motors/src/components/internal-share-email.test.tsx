import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ api: vi.fn(), composer: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: (...args: unknown[]) => state.api(...args) }));
vi.mock("@/components/portal/enquiry-email-composer", () => ({ EnquiryEmailComposer: (props: any) => {
  state.composer(props);
  return <section aria-label="Internal email composer"><h2>{props.suggestedContent.subject}</h2><input aria-label="Prepared recipient" value={props.initialRecipient} readOnly/><pre>{props.suggestedContent.message}</pre></section>;
} }));
import { InternalShareEmail } from "./internal-share-email";
const message = "Your invoice is ready.\n\nView the saved invoice:\nhttps://dealer.test/phone-share#private-token";
const customer = { id: "enquiry", customerName: "Alex", phone: "07700 900123", email: "alex@example.test" };
const writes = () => state.api.mock.calls.filter(([, options]) => options?.method === "POST");
beforeEach(() => {
  state.composer.mockReset();
  state.api.mockReset().mockImplementation(async (path: string) => path.includes("/enquiries?") ? { enquiries: [customer], canCreate: true } : { enquiry: customer, customerEmail: "alex@example.test" });
});

it("opens the reviewed internal email composer with the exact message and document links, without sending", async () => {
  const view = render(<InternalShareEmail open onOpenChange={() => {}} enquiryId="enquiry" customerPhone="07700 900123" grantId="pack" subject="Your invoice" message={message}/>);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Customer email" })).toHaveValue("alex@example.test"));
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue to email" })).toBeEnabled());
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Continue to email" }));
  expect(await screen.findByRole("region", { name: "Internal email composer" })).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Prepared recipient" })).toHaveValue("alex@example.test");
  expect(view.container.querySelector("pre")?.textContent).toBe(message);
  expect(state.composer.mock.calls.at(-1)![0]).toMatchObject({ entry: { id: "enquiry", customerName: "Alex" }, suggestedContent: { subject: "Your invoice", message, includeVehicle: false, templateId: "enquiry_message" } });
  expect(JSON.parse(writes()[0][1].body)).toMatchObject({ enquiryId: "enquiry", phone: "07700 900123", email: "alex@example.test", grantId: "pack" });
  expect(view.container.querySelector('a[href^="mailto:"]')).toBeNull();
  expect(state.api.mock.calls.some(([path]) => path.endsWith("/email") || path.endsWith("/confirm-whatsapp"))).toBe(false);
  await state.composer.mock.calls.at(-1)![0].verifyContext();
  expect(writes()).toHaveLength(2);
  expect(writes()[1][1].body).toBe(writes()[0][1].body);
});

it("requires an existing customer to be chosen before preparing a video email", async () => {
  render(<InternalShareEmail open onOpenChange={() => {}} vehicleId="car" subject="Your car video" message="Watch your car: https://dealer.test/vehicle/car?video=1"/>);
  await screen.findByRole("option", { name: "Alex" });
  expect(screen.getByRole("button", { name: "Continue to email" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox", { name: "Save against enquiry" }), { target: { value: "enquiry" } });
  expect(screen.getByRole("textbox", { name: "Customer email" })).toHaveValue("alex@example.test");
  fireEvent.click(screen.getByRole("button", { name: "Continue to email" }));
  await screen.findByRole("region", { name: "Internal email composer" });
  expect(JSON.parse(writes()[0][1].body)).toMatchObject({ enquiryId: "enquiry", vehicleId: "car" });
  expect(JSON.parse(writes()[0][1].body)).not.toHaveProperty("newCustomer");
});

it("only creates an email-only customer enquiry after an explicit preparation action", async () => {
  render(<InternalShareEmail open onOpenChange={() => {}} subject="Your car video" message="Watch the car."/>);
  fireEvent.click(await screen.findByRole("checkbox", { name: "Create a new enquiry instead" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Customer name" }), { target: { value: "New customer" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Customer email" }), { target: { value: "new@example.test" } });
  expect(writes()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Continue to email" }));
  await screen.findByRole("region", { name: "Internal email composer" });
  expect(JSON.parse(writes()[0][1].body)).toMatchObject({ newCustomer: { name: "New customer", email: "new@example.test" }, email: "new@example.test" });
  expect(JSON.parse(writes()[0][1].body)).not.toHaveProperty("phone");
  expect(state.api.mock.calls.some(([path]) => path.endsWith("/confirm-whatsapp"))).toBe(false);
});

it("retries uncertain recipient preparation with the same request and keeps fields locked", async () => {
  const original = state.api.getMockImplementation()!;
  let attempts = 0;
  state.api.mockImplementation(async (path: string) => { if (path.endsWith("/email-enquiry") && ++attempts === 1) throw new Error("Lost response"); return original(path); });
  render(<InternalShareEmail open onOpenChange={() => {}} enquiryId="enquiry" subject="Your invoice" message={message}/>);
  await waitFor(() => expect(screen.getByRole("button", { name: "Continue to email" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Continue to email" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("no email or WhatsApp message was sent");
  expect(screen.getByRole("textbox", { name: "Customer email" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Retry email preparation" }));
  await screen.findByRole("region", { name: "Internal email composer" });
  expect(writes()).toHaveLength(2);
  expect(writes()[0][1].body).toBe(writes()[1][1].body);
});

it("does not prepare an email containing an expired attachment link", async () => {
  render(<InternalShareEmail open onOpenChange={() => {}} enquiryId="enquiry" subject="Your invoice" message={message} expiresAt="2020-01-01T00:00:00Z"/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("sharing link has expired");
  expect(screen.getByRole("button", { name: "Continue to email" })).toBeDisabled();
  expect(writes()).toHaveLength(0);
});

it("rechecks protected signing links before opening an internal email draft", async () => {
  const check=vi.fn().mockRejectedValue({status:409,data:{error:"This declaration has already been signed. Review the booking."}});
  render(<InternalShareEmail open onOpenChange={() => {}} enquiryId="enquiry" subject="Your declaration" message="Please sign this private link." verifyBeforePrepare={check}/>);
  await waitFor(()=>expect(screen.getByRole("button",{name:"Continue to email"})).toBeEnabled());
  fireEvent.click(screen.getByRole("button",{name:"Continue to email"}));
  expect(await screen.findByRole("alert")).toHaveTextContent("already been signed");
  expect(check).toHaveBeenCalledOnce();
  expect(writes()).toHaveLength(0);
  expect(state.composer).not.toHaveBeenCalled();
});
