import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Github, ShieldCheck, Trash2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  GITHUB_REMOVE_URL,
  GITHUB_START_URL,
  disconnectGithub,
  fetchGithubProfile,
  friendlyChannelError,
  removalNotice,
  type PapitProfile,
} from "@/lib/githubChannel";

type State = { kind: "loading" } | { kind: "connected"; profile: PapitProfile } | { kind: "disconnected" } | { kind: "session_ended" } | { kind: "reauthorize" } | { kind: "error" };

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
  // MPC-10825: the Worker sends the person back here after "remove without a session". No session exists then, so the
  // profile call says session_ended; show the plain "not connected" state under the removal notice instead.
  const removed = removalNotice(params.get("channel_removed"), params.get("revoked"));

  useEffect(() => {
    let alive = true;
    fetchGithubProfile().then((r) => {
      if (!alive) return;
      if (r.status === "connected") setState({ kind: "connected", profile: r.profile });
      else setState({ kind: removed && r.status === "session_ended" ? "disconnected" : r.status });
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- read once on arrival; `removed` only decides which "not connected" state to show
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

      {removed && (
        <p role="status" className="mb-4 rounded-md border border-border p-3 text-sm text-foreground" data-testid="removed">
          Your stored GitHub connection was removed: we deleted the encrypted access token and the copy of your snapshot.{" "}
          {removed.revokedAtGithub
            ? "We also revoked our access at GitHub."
            : "We could not confirm the revoke at GitHub, so please also remove MyPrivacyTOOL under GitHub Settings, Applications."}
        </p>
      )}

      {state.kind === "loading" && <p className="text-muted-foreground">Checking your connection…</p>}

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-foreground">
          We couldn&rsquo;t reach the connection service. This says nothing about your connection, which is unchanged. Please try again in a moment.
        </p>
      )}

      {state.kind === "session_ended" && (
        <div className="mb-4 text-sm text-foreground" data-testid="session-ended" role="status">
          <p>
            Your browser session ended (it lasts 7 days). If you connected GitHub before, we may still hold that connection until you remove it.
            You can remove it now: sign in with GitHub and we delete the stored token and the copy of your snapshot, and revoke our access.
            Nothing is read and nothing new is saved. Or connect again to see your snapshot.
          </p>
          <Button asChild variant="outline" className="mt-3">
            <a href={GITHUB_REMOVE_URL} data-testid="remove-stored">
              <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
              Remove my stored connection
            </a>
          </Button>
        </div>
      )}

      {state.kind === "reauthorize" && (
        <p role="alert" className="mb-4 text-sm text-foreground" data-testid="reauthorize">
          GitHub no longer lets us read your profile: access was revoked, or it expired. We deleted our copy of the access token. Connect again to continue.
        </p>
      )}

      {state.kind === "disconnected" && (
        <p role="status" className="mb-4 text-sm text-foreground" data-testid="not-connected">
          No GitHub account is connected.
        </p>
      )}

      {(state.kind === "disconnected" || state.kind === "session_ended" || state.kind === "reauthorize") && (
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
            <Row label="Main languages">{state.profile.core_identity.career.skills.join(", ") || "None found"}</Row>
            <Row label="Role">{state.profile.core_identity.career.primary_role}</Row>
            <Row label="Public projects">{state.profile.core_identity.career.public_projects_count}</Row>
            <Row label="Interests">{state.profile.behavioral.interests.join(", ") || "None found"}</Row>
            <Row label="Activity (90 days)">{state.profile.behavioral.activity_level}</Row>
            {state.profile.data_coverage && (state.profile.data_coverage.repos_sampled || state.profile.data_coverage.starred_sampled || state.profile.data_coverage.events_capped) ? (
              <Row label="Sample">
                <span data-testid="profile-sampled">Large account: based on your most recent 300 public repos, 200 stars and 300 events, not everything.</span>
              </Row>
            ) : null}
            {state.profile.data_coverage?.interests === "no_stars" ? <Row label="Interests note">You have not starred anything.</Row> : null}
            {state.profile.data_coverage?.interests === "stars_without_topics" ? <Row label="Interests note">The repos you starred have no topics.</Row> : null}
            <Row label="Connection kept">Until you disconnect</Row>
            <Row label="Checksum (not a signature)">
              <code className="break-all text-xs">{state.profile.cryptographic_receipt}</code>
            </Row>
          </dl>
          <p className="mb-4 text-sm text-muted-foreground" data-testid="what-we-keep">
            What we keep: an encrypted access token until you disconnect, and a copy of this snapshot for 24 hours. Your browser stays signed in for 7 days.
            Disconnecting deletes the token, revokes our access at GitHub and clears the copy.
          </p>
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
