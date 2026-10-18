-- KOPI BOY — public.quote_delivery (delivery distance + fee)
--
-- Live definition, copied from the Supabase database on 2026-10-18.
-- Safe to run again: it's CREATE OR REPLACE, so it only (re)defines the
-- function and touches no data.
--
-- Used by the Customer app's checkout quote and placeOrder()
-- (src/lib/delivery-quote.ts), which match on the raised error names:
-- invalid_delivery_type, invalid_location, kitchen_location_missing.

CREATE OR REPLACE FUNCTION public.quote_delivery(p_kitchen_id uuid, p_lat double precision, p_lng double precision, p_type text DEFAULT 'normal'::text)
 RETURNS TABLE(distance_km numeric, delivery_fee numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  k_lat double precision;
  k_lng double precision;
  straight_km double precision;
  road_km numeric;
  base_fee numeric;
begin
  if p_type is null or p_type not in ('normal', 'express') then
    raise exception 'invalid_delivery_type';
  end if;
  if p_lat is null or p_lng is null
     or p_lat not between 1.1 and 1.5 or p_lng not between 103.5 and 104.1 then
    raise exception 'invalid_location';
  end if;

  select ka.latitude::double precision, ka.longitude::double precision
    into k_lat, k_lng
  from public.kitchen_addresses ka
  where ka.kitchen_id = p_kitchen_id;

  if k_lat is null or k_lng is null then
    raise exception 'kitchen_location_missing';
  end if;

  straight_km := 6371 * 2 * asin(sqrt(
    power(sin(radians(p_lat - k_lat) / 2), 2)
    + cos(radians(k_lat)) * cos(radians(p_lat))
      * power(sin(radians(p_lng - k_lng) / 2), 2)
  ));

  -- straight line x 1.3 approximates road distance; 1 decimal
  road_km := round((straight_km * 1.3)::numeric, 1);
  base_fee := case when p_type = 'express' then 4.00 else 2.80 end;

  distance_km := road_km;
  -- base covers the first 2 km, then S$0.50 per km; rounded to 10 cents
  delivery_fee := round((base_fee + 0.50 * greatest(0::numeric, road_km - 2)) * 10) / 10;
  return next;
end;
$function$;

-- Read-only check of the live definition, its grants and its owner (to
-- compare with this file later):
--
-- select
--   p.oid::regprocedure as signature,
--   pg_get_userbyid(p.proowner) as owner,
--   p.prosecdef as security_definer,
--   p.proacl as grants,
--   pg_get_functiondef(p.oid) as definition
-- from pg_proc p
-- join pg_namespace n on n.oid = p.pronamespace
-- where n.nspname = 'public' and p.proname = 'quote_delivery';
