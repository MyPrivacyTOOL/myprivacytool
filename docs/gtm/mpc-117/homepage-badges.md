# Homepage channel badges — spec only (no UI change made)

Add GitHub and Reddit logos as "supported channels" on `src/pages/Index.tsx`, in the same style as any existing channel/partner row. Do not ship until the launch gate in `README.md` is met; showing the badges earlier would claim support that doesn't exist.

- Use official brand assets and follow each platform's brand guidelines (Reddit and GitHub both restrict logo use; confirm "works with" wording is allowed).
- Alt text: "GitHub", "Reddit". Badges must meet AA contrast on both themes (see the Brand Bible v2 palette work, PR #62).
- Gate behind a constant such as `CHANNELS_LIVE = { github: false, reddit: false }` so the change can merge dark and flip on at launch.
