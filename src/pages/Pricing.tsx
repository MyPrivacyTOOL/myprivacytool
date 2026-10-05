import pageMeta from "@/data/pageMeta.json";
import ComingSoonPage from "@/components/ComingSoonPage";

const Pricing = () => (
  <ComingSoonPage
    title={pageMeta["/pricing"].title}
    description={pageMeta["/pricing"].description}
  />
);

export default Pricing;
