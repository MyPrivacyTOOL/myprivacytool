# Limited-mode help page (MPC-8529)

**Prepared, not deployed.** One static file, `help/index.html`: no scripts, no forms, no external requests, no analytics.
It exists so there is something honest to show when the website or the AI assistant is down. It states plainly that it cannot
save a request or issue a case reference.

## Why it is not in `public/`
`public/` ships with the main site on Cloudflare Pages. A copy there would share the failed dependency, so it must not be
described as independent. This folder is deliberately outside the site build.

## What makes it independent (and what does not yet)
It is independent of the website, AI and database **only if it is served from a different provider and a different DNS path
from the site** (for example a static host on another provider, linked from a separate hostname or a status link). **Today it is
served from nowhere.** Choosing and paying for that host, and pointing a hostname at it, is new infrastructure and needs
explicit approval. Until then, describe it as "prepared", never as "independent fallback".

## To publish later (needs approval)
1. Choose the host and hostname (owner decision). 2. Copy `fallback/help/` to it. 3. Check the page loads with the main site
blocked. 4. Link it from the places that need it (status link, email footer). 5. Record the host, date and a check in MPC-8529.

Rollback: remove the files from that host. Nothing else depends on it.
