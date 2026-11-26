-- 9110 — Logo exclusivo da página de login (Admin › Marca).
-- Opcional: null = o login segue usando o logo da marca.
alter table public.platform_branding add column if not exists login_logo_path text;
alter table public.platform_branding drop constraint if exists platform_branding_login_logo_path;
alter table public.platform_branding add constraint platform_branding_login_logo_path check (
  login_logo_path is null or
  login_logo_path ~ '^platform/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg)$'
);
comment on column public.platform_branding.login_logo_path is
  'Logo mostrado só na página de login, subido em Admin › Marca. Caminho em brand-logos; null usa o logo da marca.';
