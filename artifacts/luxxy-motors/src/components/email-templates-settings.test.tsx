import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi, afterEach } from "vitest";
import { EmailTemplatesSettings } from "./email-templates-settings";
afterEach(() => vi.unstubAllGlobals());
function show() {
  let data = {
    revision: 4,
    templates: [
      {
        id: "enquiry_acknowledgement",
        label: "Enquiry reply",
        category: "Enquiries",
        subject: "Your enquiry",
        body: "Hello {{customer_name}}",
        headline: "Hello",
      },
    ],
    variables: ["customer_name"],
  };
  const writes: any[] = [];
  const fetch = vi.fn(async (_input, init) => {
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body);
      writes.push(body);
      data = {
        ...data,
        revision: 5,
        templates: data.templates.map((item) => ({
          ...item,
          subject: body.subject,
          body: body.body,
        })),
      };
    }
    return Response.json(data);
  });
  vi.stubGlobal("fetch", fetch);
  render(<EmailTemplatesSettings />);
  return { writes, fetch };
}
it("keeps plain reusable wording without email design or spare branding", async () => {
  const { fetch } = show();
  await screen.findByLabelText("Subject");
  expect(screen.queryByText("Email branding")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Phone" }),
  ).not.toBeInTheDocument();
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("saves only the selected wording with the expected revision and no delivery request", async () => {
  const { writes, fetch } = show();
  fireEvent.change(await screen.findByLabelText("Subject"), {
    target: { value: "We received your enquiry" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save wording" }));
  await screen.findByText(
    "Wording saved for future emails. No message was sent.",
  );
  expect(writes).toEqual([
    {
      id: "enquiry_acknowledgement",
      expectedRevision: 4,
      subject: "We received your enquiry",
      body: "Hello {{customer_name}}",
      headline: "Hello",
    },
  ]);
  expect(
    fetch.mock.calls.every(([url]) => url === "/api/email-templates"),
  ).toBe(true);
});
it("marks an edited message dirty until staff explicitly discard it", async () => {
  show();
  fireEvent.change(await screen.findByLabelText("Message"), {
    target: { value: "Custom wording" },
  });
  expect(
    screen.getByRole("region", { name: "Email message wording" }),
  ).toHaveAttribute("data-settings-dirty", "true");
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "Reload saved wording" }));
  expect(confirm).toHaveBeenCalled();
  expect(screen.getByLabelText("Message")).toHaveValue("Custom wording");
  confirm.mockRestore();
});
