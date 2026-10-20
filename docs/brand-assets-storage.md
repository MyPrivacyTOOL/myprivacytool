# Brand asset storage (MPC-8366, social automation)

Cloudflare R2 was the plan (`mpt-brand-assets`), but R2 cannot be enabled through the Cloudflare API: it answers
`10042 Please enable R2 through the Cloudflare Dashboard` and needs a payment method. Assets live in **Supabase Storage** instead.

| | |
|---|---|
| Project | `xmdmkumwxpgahmlweuug` |
| Bucket | `mpt-brand-assets` |
| Access | **Public read** by exact URL. No storage policies exist, so anonymous and authenticated users cannot upload, overwrite or list. Only the server-side service key writes. |
| Limits | 10 MB per file; `image/png`, `image/jpeg`, `image/webp`, `image/svg+xml`, `image/gif` only |
| Public URL | `https://xmdmkumwxpgahmlweuug.supabase.co/storage/v1/object/public/mpt-brand-assets/<path>` |

## Rules

- Only pre-approved marketing assets. The bucket is world-readable by URL, so never put personal data, screenshots of real
  accounts or anything unreleased in it.
- Upload with the service key from a trusted place (a Worker, the Supabase dashboard, or a one-off script). Never put the service
  key in browser code.
- Sizing per platform (Instagram 1080x1080, Pinterest 1000x1500, X 1600x900) is MPC-8366: either Cloudflare Image Transformations
  on the zone with this bucket as the origin, or Supabase image transformation. The choice and its cost go on that task.

## Moving to R2 later

If R2 is enabled (dashboard, payment method): create the bucket, copy the objects, change the base URL in the social automation.
Nothing else depends on the Supabase URL.
