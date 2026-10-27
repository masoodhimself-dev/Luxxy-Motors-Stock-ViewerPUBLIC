import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { Enquiry } from "@workspace/api-client-react";
import { CustomerHistory } from "./enquiry-workspace-tools";

const contact = {
  customerName: "Alex Customer",
  email: "alex@example.test",
  phone: "07700900123",
};
const entry = (extra: Partial<Enquiry> = {}) =>
  ({
    id: "enquiry-a",
    reference: "ENQ-ORIGINAL",
    ...contact,
    vehicleTitle: "Original Ford Fiesta",
    message: "Keep this original question.",
    appointmentAt: "2030-10-05T09:00:00.000Z",
    type: "viewing",
    status: "new",
    createdAt: "2026-10-01T09:00:00.000Z",
    ...extra,
  }) as Enquiry;

it("shows household contact matches as review candidates and never reuses their details on the first click", () => {
  const original = entry({
    customerName: "Jamie Customer",
    email: "jamie@example.test",
  });
  const before = JSON.stringify(original),
    onReuse = vi.fn();
  render(
    <CustomerHistory
      contact={contact}
      enquiries={[original]}
      onReuse={onReuse}
    />,
  );
  expect(screen.getByText("Same phone · Review needed")).toBeVisible();
  expect(screen.getByText("Email addresses differ.")).toBeVisible();
  expect(
    screen.getByText(/Names differ; this contact may be shared/),
  ).toBeVisible();
  expect(screen.getByText("Original Ford Fiesta")).toBeVisible();
  expect(document.body).not.toHaveTextContent("ENQ-ORIGINAL");
  expect(screen.getByText("Keep this original question.")).toBeVisible();
  expect(screen.getByText(/^Appointment:/)).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Review Jamie Customer’s details" }),
  );
  expect(onReuse).not.toHaveBeenCalled();
  const review = within(
    screen.getByRole("group", {
      name: "Review contact details for Jamie Customer",
    }),
  );
  expect(review.getByText(/On this form: Alex Customer/)).toHaveTextContent(
    "alex@example.test",
  );
  expect(review.getByText(/From Original Ford Fiesta/)).toHaveTextContent(
    "jamie@example.test",
  );
  fireEvent.click(review.getByRole("button", { name: "Keep current details" }));
  expect(onReuse).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Review Jamie Customer’s details" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Use reviewed details" }));
  expect(onReuse).toHaveBeenCalledExactlyOnceWith({
    customerName: "Jamie Customer",
    phone: "07700900123",
    email: "jamie@example.test",
  });
  expect(JSON.stringify(original)).toBe(before);
});

it("invalidates an open contact review when the form changes and leaves original appointments intact", () => {
  const original = entry({ phone: "07700900999" }),
    onReuse = vi.fn();
  const { rerender } = render(
    <CustomerHistory
      contact={contact}
      enquiries={[original]}
      onReuse={onReuse}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Review Alex Customer’s details" }),
  );
  expect(
    screen.getByRole("button", { name: "Use reviewed details" }),
  ).toBeVisible();
  rerender(
    <CustomerHistory
      contact={{ ...contact, phone: "07700900888" }}
      enquiries={[original]}
      onReuse={onReuse}
    />,
  );
  expect(
    screen.queryByRole("button", { name: "Use reviewed details" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Review Alex Customer’s details" }),
  ).toBeVisible();
  expect(original.appointmentAt).toBe("2030-10-05T09:00:00.000Z");
  expect(onReuse).not.toHaveBeenCalled();
});

it("offers an exact international enquiry contact for explicit form reuse and excludes name-only records", () => {
  const original = entry({
    id: "international-enquiry",
    email: "",
    phone: "0033 6 12 34 56 78",
    vehicleTitle: "Original Honda Civic",
  });
  const onReuse = vi.fn();
  render(
    <CustomerHistory
      contact={{ ...contact, phone: "+33 6 12 34 56 78" }}
      enquiries={[
        original,
        entry({ email: "other@example.test", phone: "07700900999" }),
      ]}
      onReuse={onReuse}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Customer history · 1 record" }),
  ).toBeVisible();
  expect(screen.getByText("Same phone")).toBeVisible();
  expect(screen.queryByText(/ENQ-ORIGINAL/)).not.toBeInTheDocument();
  expect(onReuse).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", { name: "Use Alex Customer’s details" }),
  );
  expect(onReuse).toHaveBeenCalledExactlyOnceWith({
    customerName: contact.customerName,
    phone: original.phone,
    email: "",
  });
});

it("expands recent matching records without nesting or duplicating the history", () => {
  const originals = Array.from({ length: 5 }, (_, index) =>
    entry({
      id: `original-${index}`,
      vehicleTitle: `Car ${index}`,
      createdAt: `2026-10-0${index + 1}T09:00:00Z`,
    }),
  );
  render(<CustomerHistory contact={contact} enquiries={originals} compact />);
  const disclosure = screen
    .getByText("Customer history · 5 records", { selector: "summary" })
    .closest("details")!;
  disclosure.open = true;
  fireEvent(disclosure, new Event("toggle"));
  expect(screen.getAllByRole("article")).toHaveLength(3);
  expect(screen.getAllByRole("article")[0]).toHaveTextContent("Car 4");
  fireEvent.click(screen.getByRole("button", { name: "View all 5 records" }));
  expect(screen.getAllByRole("article")).toHaveLength(5);
  expect(
    screen.getAllByRole("heading", { name: "Customer history · 5 records" }),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Show recent records" }));
  expect(screen.getAllByRole("article")).toHaveLength(3);
});
