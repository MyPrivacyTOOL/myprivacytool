# MyPrivacyTOOL Operational Documentation

This directory contains the operational runbooks, decisions, configuration, and troubleshooting guides for MyPrivacyTOOL.

## Quick Links

- **[OPERATIONS.md](./OPERATIONS.md)** — How the team works, deployment cadence, decision rights, escalation paths
- **[CREDENTIALS.md](./CREDENTIALS.md)** — Credential inventory, rotation schedule, and access protocols (values stored securely, never in Git)
- **[DEPLOYMENT.md](./DEPLOYMENT.md)** — Release process, deployment targets, rollback procedures
- **[TROUBLESHOOTING.md](./TROUBLESHOOTING.md)** — Common issues, diagnostics, and recovery steps
- **[DECISIONS.md](./DECISIONS.md)** — Architecture decisions, trade-offs, and their rationale
- **[RUNBOOKS/](./RUNBOOKS/)** — Specific playbooks for common operational tasks

## Purpose

These docs are the source of truth for how MyPrivacyTOOL is operated, maintained, and evolved. They live in Git (not in Notion alone) so they can be version-controlled, reviewed in PRs, and kept in sync with code changes.

## Who This Is For

- **Operations team** — how to deploy, monitor, and troubleshoot
- **Engineers** — architecture decisions, deployment targets, credential access
- **Product & leadership** — decision context, why things are the way they are
- **New contributors** — how to get started, what the conventions are

## Last Updated

See Git history for this directory (`git log docs/` in the repo root).
