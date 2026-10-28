import { beforeEach, describe, expect, it } from "vitest";
import {
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
