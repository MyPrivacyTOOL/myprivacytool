import pageMeta from "@/data/pageMeta.json";
import ComingSoonPage from "@/components/ComingSoonPage";

const Contact = () => (
  <ComingSoonPage
    title={pageMeta["/contact"].title}
    description={pageMeta["/contact"].description}
  />
);

export default Contact;
