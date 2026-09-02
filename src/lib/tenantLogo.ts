/**
 * Per-tenant workspace icon (favicon) helpers.
 *
 * Logos live in the public `tenant-logos` storage bucket — favicons are
 * fetched by browsers and link-preview crawlers with no session, so there is
 * no way to authenticate the request. Only logos live in that bucket, kept
 * separate from the private `documents` bucket.
 *
 * Rows store the object path, not a full URL, so moving projects or buckets
 * doesn't strand rows pointing at a dead host.
 */
export const TENANT_LOGO_BUCKET = 'tenant-logos'

export function publicUrlFor(path: string): string {
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${TENANT_LOGO_BUCKET}/${path}`
}
