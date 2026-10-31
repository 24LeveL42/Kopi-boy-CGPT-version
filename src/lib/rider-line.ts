/** A map point as Leaflet takes it: [lat, lng]. */
export type LatLngTuple = [number, number];

function coordinate(value: unknown, limit: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

/**
 * Where the tracking map's dashed line goes. Only after pickup, and only to
 * the customer's own drop-off (orders.customer_lat / customer_lng, which
 * Postgres numeric can hand back as strings). Before pickup, or when the
 * order has no saved coordinates (older orders), there is no line. Kitchen
 * coordinates are never an input here, rounded or exact.
 */
export function pickLineTarget(
  pickedUp: boolean,
  dropoff: { lat: unknown; lng: unknown } | null | undefined
): LatLngTuple | null {
  if (!pickedUp || !dropoff) return null;
  const lat = coordinate(dropoff.lat, 90);
  const lng = coordinate(dropoff.lng, 180);
  if (lat === null || lng === null) return null;
  // 0,0 is what a broken geocode looks like, not a Singapore address.
  if (lat === 0 && lng === 0) return null;
  return [lat, lng];
}
