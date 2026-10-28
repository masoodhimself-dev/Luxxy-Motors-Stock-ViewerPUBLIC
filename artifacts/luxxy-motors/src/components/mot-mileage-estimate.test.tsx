import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MotMileageEstimate } from "./mot-mileage-estimate";
const state = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
const reply = (registration = "AB12CDE", mileage = 65000) => ({
  status: "estimated",
  registration,
  vehicle: { make: "FORD", model: "FOCUS" },
  estimate: { mileage },
});
function Form({ initialMileage = "" }: { initialMileage?: string }) {
  const [plate, setPlate] = useState("AB12 CDE"),
    [mileage, setMileage] = useState(initialMileage);
  return (
    <>
      <label>
        Registration
        <input value={plate} onChange={(e) => setPlate(e.target.value)} />
      </label>
      <label>
        Mileage
        <input value={mileage} onChange={(e) => setMileage(e.target.value)} />
      </label>
      <MotMileageEstimate
        registration={plate}
        mileage={mileage}
        onEstimate={setMileage}
      />
    </>
  );
}
const settle = async () => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(850);
  });
};
beforeEach(() => {
  vi.useFakeTimers();
  state.fetch.mockReset();
  state.fetch.mockResolvedValue(reply());
});
afterEach(() => vi.useRealTimers());
it("debounces one request and fills a clearly labelled estimate with the matching make/model", async () => {
  render(<Form />);
  expect(state.fetch).not.toHaveBeenCalled();
  await settle();
  expect(state.fetch).toHaveBeenCalledTimes(1);
  expect(state.fetch.mock.calls[0][0]).toContain("registration=AB12CDE");
  expect(screen.getByLabelText("Mileage")).toHaveValue("65000");
  expect(screen.getByRole("status")).toHaveTextContent(
    "FORD FOCUS · Estimated 65,000",
  );
  fireEvent.change(screen.getByLabelText("Mileage"), {
    target: { value: "65123" },
  });
  await settle();
  expect(screen.getByLabelText("Mileage")).toHaveValue("65123");
  expect(screen.queryByRole("status")).toBeNull();
  expect(state.fetch).toHaveBeenCalledTimes(1);
});
it("keeps restored or manually entered mileage without requesting an estimate", async () => {
  render(<Form initialMileage="72500" />);
  await settle();
  expect(state.fetch).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Mileage")).toHaveValue("72500");
});
it("never overwrites manual input entered while the lookup is pending", async () => {
  let resolve!: (r: unknown) => void;
  state.fetch.mockReturnValue(new Promise((r) => (resolve = r)));
  render(<Form />);
  await settle();
  fireEvent.change(screen.getByLabelText("Mileage"), {
    target: { value: "65555" },
  });
  await act(async () => resolve(reply()));
  expect(screen.getByLabelText("Mileage")).toHaveValue("65555");
});
it("clears only its own old estimate when the registration changes and ignores late responses", async () => {
  render(<Form />);
  await settle();
  state.fetch.mockResolvedValue(reply("CD34EFG", 85000));
  fireEvent.change(screen.getByLabelText("Registration"), {
    target: { value: "CD34 EFG" },
  });
  expect(screen.getByLabelText("Mileage")).toHaveValue("");
  await settle();
  expect(screen.getByLabelText("Mileage")).toHaveValue("85000");
  expect(state.fetch).toHaveBeenCalledTimes(2);
});
it("ignores a late result for a previous registration", async () => {
  let resolve!: (r: unknown) => void;
  state.fetch.mockReturnValueOnce(new Promise((r) => (resolve = r)));
  render(<Form />);
  await settle();
  fireEvent.change(screen.getByLabelText("Registration"), {
    target: { value: "CD34 EFG" },
  });
  state.fetch.mockResolvedValue(reply("CD34EFG", 85000));
  await act(async () => resolve(reply()));
  expect(screen.getByLabelText("Mileage")).toHaveValue("");
  await settle();
  expect(screen.getByLabelText("Mileage")).toHaveValue("85000");
});
it.each(["unavailable", "failure", "mismatch"])(
  "leaves manual entry available on %s",
  async (mode) => {
    if (mode === "failure") state.fetch.mockRejectedValue(new Error("timeout"));
    else if (mode === "mismatch")
      state.fetch.mockResolvedValue(reply("CD34EFG"));
    else
      state.fetch.mockResolvedValue({
        status: "unavailable",
        registration: "AB12CDE",
        vehicle: { make: "FORD", model: "FOCUS" },
      });
    render(<Form />);
    await settle();
    expect(screen.getByLabelText("Mileage")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent(
      /enter your current odometer reading/,
    );
  },
);
it("does not look up incomplete registrations or keep timers running after unmount", async () => {
  const { unmount } = render(<Form />);
  fireEvent.change(screen.getByLabelText("Registration"), {
    target: { value: "AB" },
  });
  await settle();
  expect(state.fetch).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Registration"), {
    target: { value: "AB12 CDE" },
  });
  unmount();
  await settle();
  expect(state.fetch).not.toHaveBeenCalled();
});
