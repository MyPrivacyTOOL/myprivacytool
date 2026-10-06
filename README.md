# Welcome to your Lovable project

## Project info

**URL**: https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID

## How can I edit this code?

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)


## GitHub channel integration (MPC-115)

A Cloudflare Worker in `workers/github-channel` connects a user's GitHub account (OAuth, `read:user` only), stores the token
AES-256-GCM encrypted in Supabase, and serves a sanitized PaPIT v1 profile at `GET /channels/github/profile` (24h Workers KV cache).

- Setup, flow diagram, rate limits, rollback: [`docs/channels/github.md`](docs/channels/github.md)
- PaPIT schema: [`docs/papit/schema-v1.md`](docs/papit/schema-v1.md)
- Config: non-secret vars live in `workers/github-channel/wrangler.toml`; secrets (`GITHUB_CLIENT_SECRET`, `STATE_SIGNING_KEY`,
  `ENCRYPTION_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) are set with `wrangler secret put`. For local dev copy `.dev.vars.example` to `.dev.vars`.
  Never commit real secrets.
- Tests: `node --test workers/github-channel/test/*.test.mjs`

## Testing and CI/CD

`npm test` runs the unit, component and Worker tests; `npm run test:e2e` runs the Playwright suite; every pull request
runs the full pipeline (see `.github/workflows/ci.yml`). Test layers, the merge gate, deploy smoke tests and the rollback
runbook are in [docs/ci-cd-testing.md](docs/ci-cd-testing.md).

## Reddit channel (MPC-116)

The same Worker also serves a Reddit behavioral channel (`/oauth/reddit/*`, `/channels/reddit/*`), off until the Reddit app credentials are set.
Setup, routes and privacy pipeline: [`docs/channels/reddit.md`](docs/channels/reddit.md).
