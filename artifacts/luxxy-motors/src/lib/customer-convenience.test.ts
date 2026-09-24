import { beforeEach, describe, expect, it } from "vitest";
import {
  recentVehicles,
  rememberVehicle,
  clearRecentVehicles,
  parseShortlist,
  vehicleAvailability,
} from "./customer-convenience";
import {
  readEnquiryDraft,
  saveEnquiryDraft,
  discardEnquiryDraft,
  type EnquiryDraft,
} from "./enquiry-draft";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
describe("customer convenience storage", () => {
  it("deduplicates recent cars and bounds history to eight", () => {
    for (let i = 0; i < 12; i++) rememberVehicle(String(i));
    rememberVehicle("7");
    expect(recentVehicles()).toEqual([
      "7",
      "11",
      "10",
      "9",
      "8",
      "6",
      "5",
      "4",
    ]);
    clearRecentVehicles();
    expect(recentVehicles()).toEqual([]);
  });
  it("ignores corrupt, expired and future history", () => {
    localStorage.setItem(
      "luxxy.recent-vehicles.v1",
      JSON.stringify([
        { id: "old", at: 1 },
        { id: "future", at: Date.now() + 60000 },
        { id: "valid", at: Date.now() },
      ]),
    );
    expect(recentVehicles()).toEqual(["valid"]);
  });
  it("bounds and validates shared vehicle references", () => {
    expect(parseShortlist("")).toBeNull();
    expect(
      parseShortlist("?cars=preview-1,preview-1,../bad,preview-2"),
    ).toEqual(["preview-1", "preview-2"]);
    expect(
      parseShortlist(
        "?cars=" + Array.from({ length: 20 }, (_, i) => String(i)).join(","),
      ),
    ).toHaveLength(12);
  });
  it("uses distinct public availability labels", () => {
    expect(vehicleAvailability("reserved")).toBe("Reserved");
    expect(vehicleAvailability("sold")).toBe("Sold");
    expect(vehicleAvailability("archived")).toBe("No longer available");
  });
  it("restores and discards valid drafts, and expires personal details", () => {
    const draft: EnquiryDraft = {
      customerName: "Test",
      email: "test@example.test",
      phone: "",
      message: "Hello",
      preferredContact: "email",
      hasPartExchange: false,
      exchange: { registration: "", mileage: "", notes: "" },
    };
    saveEnquiryDraft("test", draft);
    expect(readEnquiryDraft("test")).toEqual(draft);
    sessionStorage.setItem(
      "test",
      JSON.stringify({ savedAt: Date.now() - 31 * 60000, data: draft }),
    );
    expect(readEnquiryDraft("test")).toBeNull();
    expect(sessionStorage.getItem("test")).toBeNull();
    saveEnquiryDraft("test", draft);
    discardEnquiryDraft("test");
    expect(readEnquiryDraft("test")).toBeNull();
  });
});
