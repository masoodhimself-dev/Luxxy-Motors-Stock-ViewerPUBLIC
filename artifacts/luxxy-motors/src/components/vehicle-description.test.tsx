import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it } from "vitest";
import { VehicleDescription } from "./vehicle-description";

it("preserves the full advert and connects the expand control to its content", () => {
  const paragraphs = ["Original vehicle description. ".repeat(15), "Second paragraph with supplied details."];
  const { container } = render(<VehicleDescription paragraphs={paragraphs} />);
  const expand = screen.getByRole("button", { name: "Read full description" });
  const content = document.getElementById(expand.getAttribute("aria-controls")!)!;
  expect(expand).toHaveAttribute("aria-expanded", "false");
  expect([...content.querySelectorAll("p")].map(p => p.textContent)).toEqual(paragraphs);
  fireEvent.click(expand);
  expect(screen.getByRole("button", { name: "Show less" })).toHaveAttribute("aria-expanded", "true");
  expect(container.querySelector('[data-expanded="true"]')).toBe(content);
  fireEvent.click(screen.getByRole("button", { name: "Show less" }));
  expect(content).toHaveAttribute("data-expanded", "false");
});
it("does not add an unnecessary control to a short description", () => {
  render(<VehicleDescription paragraphs={["A short supplied description."]} />);
  expect(screen.getByText("A short supplied description.")).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});
