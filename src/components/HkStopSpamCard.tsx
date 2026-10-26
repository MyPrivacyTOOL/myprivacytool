// Light gate for the HK Stop Spam card (MPC-7446). The homepage is not code-split, so this file stays tiny: while
// the /HongKongSpam launch flag is off (and this is not an internal preview) it renders nothing and the card
// body, its copy and the geo lookup are never downloaded.
import { Suspense, lazy, useMemo } from "react";
import { isHkSpamSurfaceEnabled } from "@/config/hkSpamPage";

const Body = lazy(() => import("./HkStopSpamCardBody"));

const HkStopSpamCard = ({ placement }: { placement: "home" | "report" }) => {
  const enabled = useMemo(isHkSpamSurfaceEnabled, []);
  if (!enabled) return null;
  return (
    <Suspense fallback={null}>
      <Body placement={placement} />
    </Suspense>
  );
};

export default HkStopSpamCard;
