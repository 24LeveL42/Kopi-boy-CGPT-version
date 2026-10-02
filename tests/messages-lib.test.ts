import { describe, it, expect } from "vitest";
import {
  mergeMessages,
  normalizeMessageBody,
  orderChatPhotoPath,
  validateOrderChatPhoto,
  MESSAGE_BODY_MAX_LENGTH,
  ORDER_CHAT_PHOTO_MAX_BYTES,
} from "@/lib/messages";
import { makeMessage } from "./helpers/fake-messages-supabase";

describe("mergeMessages", () => {
  it("unions by id and sorts oldest first", () => {
    const a = makeMessage({ id: "a", created_at: "2026-09-20T10:00:00.000Z" });
    const b = makeMessage({ id: "b", created_at: "2026-09-20T11:00:00.000Z" });
    const c = makeMessage({ id: "c", created_at: "2026-09-20T09:00:00.000Z" });
    expect(mergeMessages([a, c], [b]).map((m) => m.id)).toEqual(["c", "a", "b"]);
  });

  it("de-duplicates a row that arrives both via fetch and live", () => {
    const row = makeMessage({ id: "a" });
    expect(mergeMessages([row], [row])).toHaveLength(1);
  });
});

describe("normalizeMessageBody", () => {
  it("trims whitespace", () => {
    expect(normalizeMessageBody("  hi there  ")).toBe("hi there");
  });

  it("rejects empty or whitespace-only text", () => {
    expect(normalizeMessageBody("")).toBeNull();
    expect(normalizeMessageBody("   ")).toBeNull();
  });

  it("rejects text over the body check constraint's limit", () => {
    expect(normalizeMessageBody("a".repeat(MESSAGE_BODY_MAX_LENGTH))).toBe("a".repeat(MESSAGE_BODY_MAX_LENGTH));
    expect(normalizeMessageBody("a".repeat(MESSAGE_BODY_MAX_LENGTH + 1))).toBeNull();
  });

  it("allows an empty body alongside a photo", () => {
    expect(normalizeMessageBody("   ", true)).toBe("");
    expect(normalizeMessageBody("a".repeat(MESSAGE_BODY_MAX_LENGTH + 1), true)).toBeNull();
  });
});

describe("validateOrderChatPhoto", () => {
  it("accepts the bucket's image types up to 5 MB", () => {
    expect(validateOrderChatPhoto({ type: "image/jpeg", size: ORDER_CHAT_PHOTO_MAX_BYTES })).toBeNull();
    expect(validateOrderChatPhoto({ type: "image/heic", size: 1 })).toBeNull();
  });

  it("rejects other types and oversized files", () => {
    expect(validateOrderChatPhoto({ type: "application/pdf", size: 1 })).toMatch(/JPEG, PNG, WebP or HEIC/);
    expect(validateOrderChatPhoto({ type: "image/png", size: ORDER_CHAT_PHOTO_MAX_BYTES + 1 })).toMatch(/over 5 MB/);
  });
});

describe("orderChatPhotoPath", () => {
  it("builds <order>/<user>/<id>.<ext> with a lower-cased extension", () => {
    expect(orderChatPhotoPath("o", "u", "Door.JPEG", "id")).toBe("o/u/id.jpeg");
  });

  it("falls back to jpg when the name has no usable extension", () => {
    expect(orderChatPhotoPath("o", "u", "photo", "id")).toBe("o/u/id.jpg");
  });
});
