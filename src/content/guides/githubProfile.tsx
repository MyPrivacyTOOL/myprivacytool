import { Link } from "react-router-dom";

export const sections = [
  { id: "what-it-is", title: "What the GitHub profile is" },
  { id: "connect", title: "Step 1: You connect, with one permission" },
  { id: "what-we-read", title: "Step 2: What we read from GitHub" },
  { id: "what-we-drop", title: "Step 3: What we drop before anything is summarised" },
  { id: "your-profile", title: "Step 4: The profile you get" },
  { id: "storage-and-control", title: "Step 5: How your token is stored, and how to leave" },
  { id: "limits", title: "What this profile can and cannot tell you" },
];

export const faqs: { q: string; a: string }[] = [
  {
    q: "What permission does MyPrivacyTOOL ask GitHub for?",
    a: "One: read:user, GitHub's basic read access to your profile. We do not ask for access to private repositories, we cannot write to your account, and we do not request your email address. Public repositories and public starred repositories need no extra permission.",
  },
  {
    q: "Does the profile contain my name, username or email?",
    a: "No. The profile is built only from derived values: language names, topic labels, counts and a role label. Your email, name, username, location, company, website, avatar, profile link and numeric ID are never included. Your bio is read only to match role keywords and is never copied.",
  },
  {
    q: "How long is my data kept?",
    a: "The profile snapshot is marked valid for 30 days and is cached for 24 hours so we do not call GitHub repeatedly. Your GitHub connection token is kept, encrypted, until you disconnect. Disconnecting deletes the token and revokes our access at GitHub.",
  },
  {
    q: "How do I disconnect?",
    a: "Open the Connect GitHub page and choose Disconnect GitHub. We delete our stored token first, clear the cached profile, and then revoke the grant at GitHub. You can also revoke us yourself in GitHub under Settings, Applications.",
  },
  {
    q: "What is the integrity receipt?",
    a: "A SHA-256 fingerprint of the profile. If anyone changes any value in the profile afterwards, the fingerprint no longer matches, so the edit is detectable. It proves the profile has not been altered since we generated it. It does not prove that GitHub's data was accurate.",
  },
  {
    q: "Why does my profile say Software Developer, or show no interests?",
    a: "The role comes from fixed keyword rules over your bio and your most common languages and topics, and it falls back to Software Developer when nothing specific matches. Interests come from the topics on repositories you have starred, so an account with no starred repositories shows none. Neither is a judgement about you.",
  },
];

const Content = () => (
  <>
    <p>
      Most digital-footprint tools show you what the internet already knows about you. The GitHub profile works the
      other way round. With your permission, it reads your own public GitHub activity and turns it into a small,
      private profile that you own. This guide explains exactly what is read, what is thrown away, how the profile is
      stored and how to remove it.
    </p>

    <h2 id="what-it-is">What the GitHub profile is</h2>
    <p>
      It is a short summary in a portable format called PaPIT (Private and Portable Identity Tool). It lists your main
      programming languages, a role label, how many public projects you have, a handful of interest topics and a rough
      activity level, plus a fingerprint that makes edits detectable. It is a snapshot of what your public activity
      signals, shown to you first. GitHub is the first source we support.
    </p>

    <h2 id="connect">Step 1: You connect, with one permission</h2>
    <p>
      You sign in with GitHub&apos;s own login screen, so we never see your password. We request a single permission,
      read:user, which is GitHub&apos;s basic read access to your profile. We do not request private repository access,
      we cannot change anything in your account, and we do not ask for your email address. You choose to connect, and
      you can{" "}
      <Link to="/connect/github?utm_source=blog&utm_medium=how-github-becomes-a-private-profile">
        connect your GitHub account here
      </Link>
      .
    </p>

    <h2 id="what-we-read">Step 2: What we read from GitHub</h2>
    <p>From your public GitHub data we read four things, and nothing else:</p>
    <ul>
      <li>
        <strong>Languages.</strong> The languages used across your own, non-fork public repositories.
      </li>
      <li>
        <strong>Topics.</strong> The topics attached to repositories you have starred.
      </li>
      <li>
        <strong>Activity.</strong> How many public events you made in the last 90 days.
      </li>
      <li>
        <strong>Bio keywords.</strong> Your public bio is read only to match role keywords. It is never copied into the
        profile.
      </li>
    </ul>

    <h2 id="what-we-drop">Step 3: What we drop before anything is summarised</h2>
    <p>
      Before a profile is produced, the data passes through a sanitisation step. Fields that identify you are classed as
      restricted and removed: email, name, username, location, company, website, avatar, profile link, numeric ID,
      phone and address. In free text, links, email addresses, @handles, card and ID numbers, IP addresses and phone
      numbers are replaced with a redaction marker. Topic labels are reduced to plain lowercase words and hyphens, which
      also removes anything shaped like a name or address.
    </p>

    <h2 id="your-profile">Step 4: The profile you get</h2>
    <p>The finished profile contains only derived values:</p>
    <ul>
      <li>
        <strong>Skills.</strong> Up to 10 languages, ranked by how many of your public repositories use them.
      </li>
      <li>
        <strong>Primary role.</strong> One label from fixed keyword rules: Security, Data and ML, DevOps and SRE,
        Mobile, Frontend, Backend or Full-Stack. If nothing matches, it says Software Developer. No AI model guesses
        this.
      </li>
      <li>
        <strong>Public projects.</strong> The number of public repositories on your account.
      </li>
      <li>
        <strong>Interests.</strong> Up to 15 topics from your starred repositories.
      </li>
      <li>
        <strong>Activity level.</strong> Low for fewer than 5 public events in 90 days, medium for 5 to 50, high for
        more than 50.
      </li>
      <li>
        <strong>Integrity receipt.</strong> A SHA-256 fingerprint of the whole profile, so any later edit is
        detectable.
      </li>
    </ul>
    <p>
      The profile also states its own limits in plain data: it is valid for 30 days and it is revocable.
    </p>

    <h2 id="storage-and-control">Step 5: How your token is stored, and how to leave</h2>
    <p>
      Your GitHub connection token is encrypted with AES-256-GCM before it is stored, so the database holds ciphertext
      only. The finished profile is cached for 24 hours to avoid calling GitHub repeatedly; the cache never contains
      tokens or raw GitHub responses. The profile snapshot is valid for 30 days, but the token itself is kept until you
      disconnect.
    </p>
    <p>
      To leave, choose Disconnect GitHub on the connect page. We delete the stored token first, clear the cached
      profile, and then revoke our access at GitHub. You can also revoke access yourself at any time in GitHub under
      Settings, Applications.
    </p>

    <h2 id="limits">What this profile can and cannot tell you</h2>
    <ul>
      <li>It reflects public activity only. Private repositories and private work are invisible to it.</li>
      <li>The role is a keyword-based label, not an assessment of your skills or seniority.</li>
      <li>
        GitHub&apos;s public events feed is limited to roughly the last 90 days and a few hundred events, which is
        enough to place you in low, medium or high but not to measure total output.
      </li>
      <li>An empty interests list simply means no starred repositories were found.</li>
      <li>The integrity receipt shows the profile has not been altered. It does not vouch for the underlying data.</li>
    </ul>
    <p>
      This guide describes how the feature works at the time of writing. If you want to see how exposed your details
      are across the wider internet, you can also{" "}
      <Link to="/scan?utm_source=blog&utm_medium=how-github-becomes-a-private-profile">
        run a free scan with MyPrivacyTOOL
      </Link>
      .
    </p>
  </>
);

export default Content;
