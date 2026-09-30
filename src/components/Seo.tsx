import { Helmet } from "react-helmet";

const SITE_URL = "https://www.myprivacytool.io";

interface SeoProps {
  title: string;
  description: string;
  /** Path such as "/scan". Omit to keep the route-level default canonical from Layout. */
  path?: string;
}

/** Per-page <title>, meta description and (optionally) canonical. Renders nothing visible. */
const Seo = ({ title, description, path }: SeoProps) => (
  <Helmet>
    <title>{title}</title>
    <meta name="description" content={description} />
    <meta property="og:title" content={title} />
    <meta property="og:description" content={description} />
    {path && <link rel="canonical" href={`${SITE_URL}${path}`} />}
  </Helmet>
);

export default Seo;
