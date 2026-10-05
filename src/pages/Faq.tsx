import pageMeta from "@/data/pageMeta.json";
import ComingSoonPage from "@/components/ComingSoonPage";

const Faq = () => (
  <ComingSoonPage
    title={pageMeta["/faq"].title}
    description={pageMeta["/faq"].description}
  />
);

export default Faq;
