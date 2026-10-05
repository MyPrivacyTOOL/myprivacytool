import pageMeta from "@/data/pageMeta.json";
import ComingSoonPage from "@/components/ComingSoonPage";

const About = () => (
  <ComingSoonPage
    title={pageMeta["/about"].title}
    description={pageMeta["/about"].description}
  />
);

export default About;
