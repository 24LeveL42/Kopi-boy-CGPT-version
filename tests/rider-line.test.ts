import { describe, it, expect } from "vitest";
import { pickLineTarget } from "@/lib/rider-line";

describe("pickLineTarget", () => {
  const dropoff = { lat: 1.3521, lng: 103.8198 };

  it("has no line before pickup", () => {
    expect(pickLineTarget(false, dropoff)).toBeNull();
  });

  it("points at the customer's drop-off after pickup", () => {
    expect(pickLineTarget(true, dropoff)).toEqual([1.3521, 103.8198]);
  });

  it("accepts numeric strings (Postgres numeric)", () => {
    expect(pickLineTarget(true, { lat: "1.352100", lng: "103.819800" })).toEqual([1.3521, 103.8198]);
  });

  it.each([
    ["no dropoff", null],
    ["undefined dropoff", undefined],
    ["null lat", { lat: null, lng: 103.8 }],
    ["missing lng", { lat: 1.35, lng: undefined }],
    ["empty string", { lat: "", lng: "" }],
    ["not a number", { lat: "abc", lng: 103.8 }],
    ["out of range", { lat: 91, lng: 103.8 }],
    ["0,0", { lat: 0, lng: 0 }],
  ])("has no line when coordinates are missing or bad: %s", (_label, d) => {
    expect(pickLineTarget(true, d as never)).toBeNull();
  });
});
