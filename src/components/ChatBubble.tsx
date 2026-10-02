/**
 * One message in a chat (OrderChat with the rider, SupportChat with HQ), so
 * both read the same way: the customer's own messages on the right in green,
 * the other party's on the left in white under their name.
 */
export function ChatBubble({
  mine,
  senderLabel,
  testId,
  children,
}: {
  mine: boolean;
  /** Shown above the other party's messages only — "Kopi Boy Support", the rider's name. */
  senderLabel: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <div data-testid={testId} data-mine={mine} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
      {!mine && (
        <span className="mb-0.5 text-[10px] font-semibold" style={{ color: "var(--kb-ink-soft)" }}>
          {senderLabel}
        </span>
      )}
      <div
        className="max-w-[80%] overflow-hidden rounded-2xl text-sm break-words"
        style={mine ? { background: "var(--kb-green-deep)", color: "white" } : { background: "white", color: "var(--kb-ink)" }}
      >
        {children}
      </div>
    </div>
  );
}
