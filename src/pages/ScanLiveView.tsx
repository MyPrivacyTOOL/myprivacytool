import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import LiveScanPanel from "@/components/LiveScanPanel";
import { readVerifyKey } from "@/lib/liveScan";

// MPC-8452: where the button in the confirmation and report emails lands. The key is in the URL fragment (#v=...), which browsers never send to a
// server; it is read once into memory and removed from the address bar. Opening it proves the reader controls the inbox the scan was requested for,
// so found checks show their value here. A refresh forgets it (by design): press the button in the email again.
const ScanLiveView = () => {
  const [key, setKey] = useState("");
  useEffect(() => {
    const k = readVerifyKey(window.location.hash);
    if (k) {
      setKey(k);
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  return (
    <main className="mx-auto max-w-md px-4 py-12 text-center">
      <Seo title="Your results, live | MyPrivacyTOOL" description="Your private results page." path="/scan/live" noindex />
      <h1 className="text-2xl font-bold text-foreground">Your results, live</h1>
      {key ? (
        <LiveScanPanel token={key} kind="verified" />
      ) : (
        <p className="mt-4 text-muted-foreground">
          Open the button in your email to see your results here. This page keeps nothing, so a refresh needs the button again.{" "}
          <Link to="/scan" className="underline">Run a new scan</Link>
        </p>
      )}
    </main>
  );
};

export default ScanLiveView;
