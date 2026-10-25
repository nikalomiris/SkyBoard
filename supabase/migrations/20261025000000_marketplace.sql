-- Marketplace: sellers publish immutable lesson snapshots (versions); buyers own a
-- purchase that points at the exact version they bought.

create table public.marketplace_listings (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references auth.users (id) on delete cascade,
    seller_name text not null default '',
    current_version_id uuid,
    title text not null check (btrim(title) <> ''),
    description text not null default '' check (char_length(description) <= 4000),
    price_cents integer not null default 0 check (price_cents >= 0 and price_cents <= 100000),
    currency text not null default 'USD' check (currency = 'USD'),
    cover text,
    cover_image text,
    color text not null default '#fffef9',
    tags text[] not null default '{}',
    page_count integer not null default 1 check (page_count > 0),
    status text not null default 'published' check (status in ('published', 'unpublished')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table public.marketplace_listing_versions (
    id uuid primary key default gen_random_uuid(),
    listing_id uuid not null references public.marketplace_listings (id) on delete cascade,
    seller_id uuid not null references auth.users (id) on delete cascade,
    version_number integer not null check (version_number > 0),
    title text not null,
    description text not null default '',
    cover text,
    cover_image text,
    color text not null default '#fffef9',
    tags text[] not null default '{}',
    card_deck jsonb,
    pages jsonb not null check (jsonb_typeof(pages) = 'array' and jsonb_array_length(pages) between 1 and 100),
    created_at timestamptz not null default now(),
    unique (listing_id, version_number)
);

alter table public.marketplace_listings
    add constraint marketplace_listings_current_version_fk
    foreign key (current_version_id) references public.marketplace_listing_versions (id) deferrable initially deferred;

create table public.marketplace_purchases (
    id uuid primary key default gen_random_uuid(),
    buyer_id uuid not null references auth.users (id) on delete cascade,
    listing_id uuid not null references public.marketplace_listings (id),
    version_id uuid not null references public.marketplace_listing_versions (id),
    price_cents integer not null check (price_cents >= 0),
    currency text not null default 'USD',
    -- 'simulated' until a real payment provider confirms the charge server-side.
    payment_status text not null default 'simulated' check (payment_status in ('free', 'simulated', 'paid')),
    created_at timestamptz not null default now(),
    unique (buyer_id, listing_id)
);

create index marketplace_listings_status_idx on public.marketplace_listings (status, updated_at desc);
create index marketplace_listings_seller_idx on public.marketplace_listings (seller_id);
create index marketplace_purchases_buyer_idx on public.marketplace_purchases (buyer_id, created_at desc);

create trigger marketplace_listings_set_updated_at before update on public.marketplace_listings
    for each row execute function public.set_updated_at();

alter table public.marketplace_listings enable row level security;
alter table public.marketplace_listing_versions enable row level security;
alter table public.marketplace_purchases enable row level security;

-- Listings are readable when published, by their seller, or by anyone who bought them.
-- All writes go through the security-definer functions below.
create policy marketplace_listings_select on public.marketplace_listings
    for select to authenticated using (
        status = 'published'
        or seller_id = (select auth.uid())
        or exists (select 1 from public.marketplace_purchases p where p.listing_id = marketplace_listings.id and p.buyer_id = (select auth.uid()))
    );

-- Version content (the pages) is only visible to the seller and to buyers of that exact version.
create policy marketplace_versions_select on public.marketplace_listing_versions
    for select to authenticated using (
        seller_id = (select auth.uid())
        or exists (select 1 from public.marketplace_purchases p where p.version_id = marketplace_listing_versions.id and p.buyer_id = (select auth.uid()))
    );

create policy marketplace_purchases_select_own on public.marketplace_purchases
    for select to authenticated using (buyer_id = (select auth.uid()));

revoke all on public.marketplace_listings, public.marketplace_listing_versions, public.marketplace_purchases from anon, authenticated;
grant select on public.marketplace_listings, public.marketplace_listing_versions, public.marketplace_purchases to authenticated;

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
    p_pages jsonb
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
    if p_pages is null or jsonb_typeof(p_pages) <> 'array' or jsonb_array_length(p_pages) not between 1 and 100 then
        raise exception 'A listing needs between 1 and 100 pages.';
    end if;

    select coalesce(nullif(btrim(display_name), ''), 'SkyBoard teacher') into v_name from public.profiles where id = v_user;

    select * into v_existing from public.marketplace_listings where id = p_listing_id for update;
    if found and v_existing.seller_id <> v_user then raise exception 'Not your listing.'; end if;

    if not found then
        insert into public.marketplace_listings (id, seller_id, seller_name, title, description, price_cents, cover, cover_image, color, tags, page_count)
        values (p_listing_id, v_user, coalesce(v_name, ''), btrim(p_title), coalesce(p_description, ''), p_price_cents, p_cover, p_cover_image, coalesce(p_color, '#fffef9'), coalesce(p_tags, '{}'), jsonb_array_length(p_pages));
        v_version := 1;
    else
        select coalesce(max(version_number), 0) + 1 into v_version from public.marketplace_listing_versions where listing_id = p_listing_id;
    end if;

    insert into public.marketplace_listing_versions (id, listing_id, seller_id, version_number, title, description, cover, cover_image, color, tags, card_deck, pages)
    values (p_version_id, p_listing_id, v_user, v_version, btrim(p_title), coalesce(p_description, ''), p_cover, p_cover_image, coalesce(p_color, '#fffef9'), coalesce(p_tags, '{}'), p_card_deck, p_pages);

    update public.marketplace_listings
    set current_version_id = p_version_id, seller_name = coalesce(v_name, ''), title = btrim(p_title), description = coalesce(p_description, ''),
        price_cents = p_price_cents, cover = p_cover, cover_image = p_cover_image, color = coalesce(p_color, '#fffef9'),
        tags = coalesce(p_tags, '{}'), page_count = jsonb_array_length(p_pages), status = 'published'
    where id = p_listing_id;

    return p_listing_id;
end;
$$;

create or replace function public.set_marketplace_listing_status(p_listing_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if auth.uid() is null then raise exception 'Authentication required.'; end if;
    if p_status not in ('published', 'unpublished') then raise exception 'Invalid status.'; end if;
    update public.marketplace_listings set status = p_status where id = p_listing_id and seller_id = auth.uid();
    if not found then raise exception 'Listing not found.'; end if;
end;
$$;

-- Simulated checkout: replace with a payment-provider edge function and revoke
-- execute on this function from authenticated for paid listings before launch.
create or replace function public.purchase_marketplace_listing(p_listing_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_user uuid := auth.uid();
    v_listing public.marketplace_listings;
    v_purchase uuid;
begin
    if v_user is null then raise exception 'Authentication required.'; end if;
    select * into v_listing from public.marketplace_listings where id = p_listing_id;
    if not found or v_listing.status <> 'published' or v_listing.current_version_id is null then raise exception 'This listing is not available.'; end if;
    if v_listing.seller_id = v_user then raise exception 'You cannot buy your own listing.'; end if;

    insert into public.marketplace_purchases (buyer_id, listing_id, version_id, price_cents, currency, payment_status)
    values (v_user, p_listing_id, v_listing.current_version_id, v_listing.price_cents, v_listing.currency, case when v_listing.price_cents = 0 then 'free' else 'simulated' end)
    on conflict (buyer_id, listing_id) do nothing
    returning id into v_purchase;

    if v_purchase is null then
        select id into v_purchase from public.marketplace_purchases where buyer_id = v_user and listing_id = p_listing_id;
    end if;
    return v_purchase;
end;
$$;

revoke all on function public.publish_marketplace_listing(uuid, uuid, text, text, integer, text, text, text, text[], jsonb, jsonb) from public;
revoke all on function public.set_marketplace_listing_status(uuid, text) from public;
revoke all on function public.purchase_marketplace_listing(uuid) from public;
grant execute on function public.publish_marketplace_listing(uuid, uuid, text, text, integer, text, text, text, text[], jsonb, jsonb) to authenticated;
grant execute on function public.set_marketplace_listing_status(uuid, text) to authenticated;
grant execute on function public.purchase_marketplace_listing(uuid) to authenticated;

-- Private asset storage: marketplace-assets/sellerId/listingId/versionId/itemKey
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'marketplace-assets',
    'marketplace-assets',
    false,
    52428800,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy marketplace_assets_select on storage.objects
    for select to authenticated
    using (
        bucket_id = 'marketplace-assets'
        and (
            (storage.foldername(name))[1] = (select auth.uid())::text
            or exists (
                select 1 from public.marketplace_purchases p
                where p.buyer_id = (select auth.uid())
                    and p.listing_id::text = (storage.foldername(name))[2]
                    and p.version_id::text = (storage.foldername(name))[3]
            )
        )
    );
create policy marketplace_assets_insert_own on storage.objects
    for insert to authenticated
    with check (bucket_id = 'marketplace-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No update/delete policies: published assets are immutable so buyers keep what they bought.
