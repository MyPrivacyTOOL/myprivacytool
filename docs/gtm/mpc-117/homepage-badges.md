# Homepage channel badge — spec only (no UI change made)

Show a GitHub badge as a supported channel on `src/pages/Index.tsx`, in the style of any existing channel row. Reddit is not included (MPC-116 is parked).

- Do not ship until the launch gate in `README.md` is met.
- Use GitHub's official mark and follow GitHub's logo and brand guidelines; confirm "works with"-style wording is allowed.
- Alt text "GitHub"; AA contrast in both themes (Brand Bible v2 palette, PR #62).
- Gate behind a constant such as `CHANNELS_LIVE = { github: false }` so it can merge dark and flip on at launch.
- Link the badge to `/connect/github` (PR #69) once that page is public and the cookie issue is fixed.
