/**
 * Straight-line distance + delivery fee estimate — no external mapping API.
 * Shared by the marketplace cards (kitchen distance) and checkout (delivery
 * fee estimate), both of which need the same Haversine math against a
 * customer coordinate captured via the browser's Geolocation API.
 */

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two lat/lng points, in kilometres. */
export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/**
 * Locked formula (docs/feature-001.md: delivery fee is distance-based, 100%
 * to the rider): $3 base for the first 2km, +$0.60/km after that, $3
 * minimum, rounded to the nearest $0.50. This is an estimate the app shows —
 * the cook and rider agree the real fee directly, off-platform.
 */
export function estimateDeliveryFee(distanceKm: number): number {
  const extraKm = Math.max(0, distanceKm - 2);
  const raw = Math.max(3, 3 + extraKm * 0.6);
  return Math.round(raw / 0.5) * 0.5;
}
