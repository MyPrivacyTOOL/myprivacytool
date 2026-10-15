# /footprint/ data and scaling

The page lays out any number of hexagons (tested at 1, 3, 54, 118 and 1000; 1000 builds in ~150 ms).

## Item fields
`id, label, emoji, ex (example value), conf (0-100), sens (high|medium|low), cap, val, risk, group, box, state, exposure`, plus:

- `channel` — e.g. `Web`, `Email`, `Phone`. Defaults to `Web`.

## Range slider
Items of the active channel are ranked riskiest first (demo order, then asking/risk states, exposure, sensitivity). The slider is exponential, from the top 1 to the whole channel, with presets Top 3 risks / Top 10 / All.

## Channels
At the end of the slider (all of a channel shown), the other channels decode out of the matrix rain as chips with their hexagons ringed around the hive. Sliding back dissolves them. Choosing a chip makes that channel the active one; "All channels" returns to the overview.

## Trying it
`/footprint/?test=1` adds clearly-labelled synthetic channels (118 total) for testing. Nothing synthetic ships by default.
