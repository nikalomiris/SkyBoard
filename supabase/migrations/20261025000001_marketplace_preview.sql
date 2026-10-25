-- Public, asset-free preview of the first pages so buyers can look before buying.
-- Images and PDFs are stripped client-side; full pages stay private until purchase.
alter table public.marketplace_listings
    add column preview_pages jsonb not null default '[]'::jsonb
    check (jsonb_typeof(preview_pages) = 'array' and jsonb_array_length(preview_pages) <= 3);

drop function if exists public.publish_marketplace_listing(uuid, uuid, text, text, integer, text, text, text, text[], jsonb, jsonb);

create or replace function public.publish_marketplace_listing(
    p_listing_id uuid,
    p_version_id uuid,
    p_title text,
    p_description text,
    p_price_cents integer,
    p_cover text,
    p_cover_image text,
    p_color text,
    p_tags text[],
    p_card_deck jsonb,
    p_pages jsonb,
    p_preview jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user uuid := auth.uid();
    v_existing public.marketplace_listings;
    v_version integer;
    v_name text;
begin
    if v_user is null then raise exception 'Authentication required.'; end if;
    if p_title is null or btrim(p_title) = '' then raise exception 'A title is required.'; end if;
    if p_price_cents is null or p_price_cents < 0 or p_price_cents > 100000 then raise exception 'Invalid price.'; end if;
    if p_preview is not null and (jsonb_typeof(p_preview) <> 'array' or jsonb_array_length(p_preview) > 3) then raise exception 'Invalid preview.'; end if;
    if p_pages is null or jsonb_typeof(p_pages) <> 'array' or jsonb_array_length(p_pages) not between 1 and 100 then
        raise exception 'A listing needs between 1 and 100 pages.';
    end if;

    select coalesce(nullif(btrim(display_name), ''), 'SkyBoard teacher') into v_name from public.profiles where id = v_user;

    select * into v_existing from public.marketplace_listings where id = p_listing_id for update;
    if found and v_existing.seller_id <> v_user then raise exception 'Not your listing.'; end if;

    if not found then
        insert into public.marketplace_listings (id, seller_id, seller_name, title, description, price_cents, cover, cover_image, color, tags, page_count, preview_pages)
        values (p_listing_id, v_user, coalesce(v_name, ''), btrim(p_title), coalesce(p_description, ''), p_price_cents, p_cover, p_cover_image, coalesce(p_color, '#fffef9'), coalesce(p_tags, '{}'), jsonb_array_length(p_pages), coalesce(p_preview, '[]'::jsonb));
        v_version := 1;
    else
        select coalesce(max(version_number), 0) + 1 into v_version from public.marketplace_listing_versions where listing_id = p_listing_id;
    end if;

    insert into public.marketplace_listing_versions (id, listing_id, seller_id, version_number, title, description, cover, cover_image, color, tags, card_deck, pages)
    values (p_version_id, p_listing_id, v_user, v_version, btrim(p_title), coalesce(p_description, ''), p_cover, p_cover_image, coalesce(p_color, '#fffef9'), coalesce(p_tags, '{}'), p_card_deck, p_pages);

    update public.marketplace_listings
    set current_version_id = p_version_id, seller_name = coalesce(v_name, ''), title = btrim(p_title), description = coalesce(p_description, ''),
        price_cents = p_price_cents, cover = p_cover, cover_image = p_cover_image, color = coalesce(p_color, '#fffef9'),
        tags = coalesce(p_tags, '{}'), page_count = jsonb_array_length(p_pages), preview_pages = coalesce(p_preview, '[]'::jsonb), status = 'published'
    where id = p_listing_id;

    return p_listing_id;
end;
$$;

revoke all on function public.publish_marketplace_listing(uuid, uuid, text, text, integer, text, text, text, text[], jsonb, jsonb, jsonb) from public;
grant execute on function public.publish_marketplace_listing(uuid, uuid, text, text, integer, text, text, text, text[], jsonb, jsonb, jsonb) to authenticated;
