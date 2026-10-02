import { describe, expect, it } from "vitest";
import { followUpIso, followUpLocal } from "./enquiry-follow-up";

describe("staff follow-up UK times", () => {
  it("stores winter and summer appointments as UTC", () => {
    expect(followUpIso("2027-01-05T10:00")).toBe("2027-01-05T10:00:00.000Z");
    expect(followUpIso("2027-07-05T10:00")).toBe("2027-07-05T09:00:00.000Z");
    expect(followUpLocal("2027-07-05T09:00:00.000Z")).toBe("2027-07-05T10:00");
  });
  it("rejects malformed dates and the missing spring clock-change hour", () => {
    expect(followUpIso("")).toBeNull();
    expect(followUpIso("2027-03-28T01:30")).toBeNull();
    expect(followUpIso("2027-02-30T10:00")).toBeNull();
  });
});
