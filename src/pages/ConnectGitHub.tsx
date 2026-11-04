import Seo from "@/components/Seo";
import ConnectGitHub from "@/components/ConnectGitHub";

// Unlisted on purpose (noindex, not in the sitemap or nav) until the GitHub channel is ready to launch.
export default function ConnectGitHubPage() {
  return (
    <>
      <Seo
        title="Connect GitHub | MyPrivacyTOOL.IO"
        description="Connect your GitHub account to build a private, portable identity snapshot."
        path="/connect/github"
        noindex
      />
      <ConnectGitHub />
    </>
  );
}
