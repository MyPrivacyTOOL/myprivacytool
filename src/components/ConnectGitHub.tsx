import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Github, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GITHUB_START_URL,
  disconnectGithub,
  fetchGithubProfile,
  friendlyChannelError,
  type PapitProfile,
} from "@/lib/githubChannel";

type State = { kind: "loading" } | { kind: "connected"; profile: PapitProfile } | { kind: "disconnected" } | { kind: "error" };

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1 py-3 border-b border-border last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
    <dt className="w-44 shrink-0 text-sm text-muted-foreground">{label}</dt>
    <dd className="text-sm text-foreground">{children}</dd>
  </div>
);

export default function ConnectGitHub() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [disconnectFailed, setDisconnectFailed] = useState(false);
  const [params] = useSearchParams();
  const callbackError = friendlyChannelError(params.get("channel_error"));

  useEffect(() => {
    let alive = true;
    fetchGithubProfile().then((r) => {
      if (!alive) return;
      setState(r.status === "connected" ? { kind: "connected", profile: r.profile } : { kind: r.status });
    });
    return () => {
      alive = false;
    };
  }, []);

  const onDisconnect = async () => {
    setBusy(true);
    setDisconnectFailed(false);
    const ok = await disconnectGithub();
    setBusy(false);
    if (ok) setState({ kind: "disconnected" });
    else setDisconnectFailed(true);
  };

  return (
    <section className="max-w-2xl mx-auto px-4 py-12" aria-live="polite">
      <h1 className="text-3xl font-bold text-foreground mb-2">Connect GitHub</h1>
      <p className="text-muted-foreground mb-6">
        See what your public GitHub activity says about you, as a private, portable identity snapshot. We ask for the
        minimum permission (<code>read:user</code>), never see your email, and you can disconnect at any time.
      </p>

      {callbackError && (
        <p role="alert" className="mb-4 rounded-md border border-border p-3 text-sm text-foreground">
          {callbackError}
        </p>
      )}

      {state.kind === "loading" && <p className="text-muted-foreground">Checking your connection…</p>}

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-foreground">
          We couldn't reach the connection service. Please try again in a moment.
        </p>
      )}

      {state.kind === "disconnected" && (
        <Button asChild size="lg">
          <a href={GITHUB_START_URL}>
            <Github className="mr-2 h-5 w-5" aria-hidden="true" />
            Connect GitHub
          </a>
        </Button>
      )}

      {state.kind === "connected" && (
        <div>
          <div className="mb-4 flex items-center gap-2 text-sm text-foreground">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
            <span>GitHub connected</span>
          </div>
          <dl className="mb-6">
            <Row label="Skills">{state.profile.core_identity.career.skills.join(", ") || "None found"}</Row>
            <Row label="Role">{state.profile.core_identity.career.primary_role}</Row>
            <Row label="Public projects">{state.profile.core_identity.career.public_projects_count}</Row>
            <Row label="Interests">{state.profile.behavioral.interests.join(", ") || "None found"}</Row>
            <Row label="Activity (90 days)">{state.profile.behavioral.activity_level}</Row>
            <Row label="Snapshot valid for">{state.profile.privacy_boundaries.data_retention_days} days</Row>
            <Row label="Integrity receipt">
              <code className="break-all text-xs">{state.profile.cryptographic_receipt}</code>
            </Row>
          </dl>
          <Button variant="outline" onClick={onDisconnect} disabled={busy}>
            <Unplug className="mr-2 h-4 w-4" aria-hidden="true" />
            {busy ? "Disconnecting…" : "Disconnect GitHub"}
          </Button>
          {disconnectFailed && (
            <p role="alert" className="mt-3 text-sm text-foreground">
              We couldn't disconnect just now. Please try again.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
