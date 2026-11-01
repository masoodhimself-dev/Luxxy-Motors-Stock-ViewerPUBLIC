import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ fetch: vi.fn(), motLoad: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  customFetch: (...args: unknown[]) => state.fetch(...args),
}));
vi.mock("@/lib/dealer-settings-context", () => ({
  useDealerSettings: () => ({
    settings: {
      delivery: { enabled: true },
      deliveryPricing: { enabled: true, basePrice: "0", pricePerMile: "1" },
      address: { postcode: "HA2 7LU" },
    },
  }),
}));
vi.mock("./vehicle-dialog-vehicle", () => ({
  useVehicleDialogTheme: () => ({}),
}));
vi.mock("./delivery-estimator", () => ({
  DeliveryEstimator: ({
    onEnquire,
  }: {
    onEnquire?: (message: string) => void;
  }) => (
    <div>
      Delivery estimate content
      <button onClick={() => onEnquire?.("Delivery enquiry")}>
        Include estimate in my enquiry
      </button>
    </div>
  ),
}));
vi.mock("./mot-history", async () => {
  const React = await import("react");
  return {
    MotHistoryPanel: () => {
      React.useEffect(() => {
        state.motLoad();
      }, []);
      return <div>MOT history content</div>;
    },
  };
});
// Keep an opened dialog mounted after close, as Radix does during CSS exit.
vi.mock("./ui/dialog", async () => {
  const React = await import("react");
  const Context = React.createContext({ open: false, close: () => {} });
  return {
    Dialog: ({
      open,
      onOpenChange,
      children,
    }: {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      children: React.ReactNode;
    }) => (
      <Context.Provider value={{ open, close: () => onOpenChange(false) }}>
        {children}
      </Context.Provider>
    ),
    DialogContent: ({ children, onCloseAutoFocus }: { children: React.ReactNode; onCloseAutoFocus?:(event: Event)=>void }) => {
      const context = React.useContext(Context),
        wasOpen = React.useRef(false);
      if (context.open) wasOpen.current = true;
      return wasOpen.current ? (
        <div role="dialog" data-state={context.open ? "open" : "closed"}>
          {children}
          <button onClick={context.close}>Close</button>
          {!context.open && <button onClick={()=>onCloseAutoFocus?.(new Event("closeAutoFocus", {cancelable:true}))}>Finish close animation</button>}
        </div>
      ) : null;
    },
    DialogTitle: ({ children }: { children: React.ReactNode }) => (
      <h2>{children}</h2>
    ),
    DialogHeader: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    DialogDescription: ({ children }: { children: React.ReactNode }) => (
      <p>{children}</p>
    ),
  };
});
import { VehicleQuickChecks } from "./vehicle-quick-checks";

function Checks({ onEnquire }: { onEnquire?: (message: string) => void }) {
  return (
    <VehicleQuickChecks vehicleId="car-a" onEnquire={onEnquire}>
      {({ motAction, deliveryAction }) => (
        <>
          {motAction}
          {deliveryAction}
        </>
      )}
    </VehicleQuickChecks>
  );
}

beforeEach(() => {
  state.fetch.mockReset();
  state.fetch.mockResolvedValue({ status: "uncached" });
  state.motLoad.mockReset();
});

it("retains delivery content during the include action's exit without mounting the MOT tool", async () => {
  const onEnquire = vi.fn();
  render(<Checks onEnquire={onEnquire} />);
  fireEvent.click(screen.getByRole("button", { name: "Delivery estimate" }));
  expect(
    screen.getByRole("heading", { name: "Delivery estimate" }),
  ).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Include estimate in my enquiry" }),
  );
  expect(onEnquire).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "closed");
  expect(
    screen.getByRole("heading", { name: "Delivery estimate" }),
  ).toBeVisible();
  expect(screen.getByText("Delivery estimate content")).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "MOT history" }),
  ).not.toBeInTheDocument();
  expect(state.motLoad).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Finish close animation"}));
  await waitFor(()=>expect(onEnquire).toHaveBeenCalledExactlyOnceWith("Delivery enquiry"));
  await waitFor(() => expect(state.fetch).toHaveBeenCalledTimes(1));
  expect(state.fetch.mock.calls[0][0]).toContain("cacheOnly=true");
});

it("retains the existing MOT content during close without a new MOT load", () => {
  render(<Checks />);
  fireEvent.click(screen.getByRole("button", { name: "MOT history" }));
  expect(state.motLoad).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(screen.getByRole("dialog")).toHaveAttribute("data-state", "closed");
  expect(screen.getByRole("heading", { name: "MOT history" })).toBeVisible();
  expect(screen.getByText("MOT history content")).toBeVisible();
  expect(state.motLoad).toHaveBeenCalledOnce();
});


it("hands the enquiry over after close without taking focus back from the message form", async () => {
  const onEnquire=vi.fn(()=>screen.getByLabelText("Enquiry message").focus());
  render(<><Checks onEnquire={onEnquire}/><label>Enquiry message<input/></label></>);
  const trigger=screen.getByRole("button",{name:"Delivery estimate"});trigger.focus();fireEvent.click(trigger);fireEvent.click(screen.getByRole("button",{name:"Include estimate in my enquiry"}));
  expect(onEnquire).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Finish close animation"}));
  await waitFor(()=>expect(screen.getByLabelText("Enquiry message")).toHaveFocus());expect(onEnquire).toHaveBeenCalledOnce();expect(trigger).not.toHaveFocus();
});
