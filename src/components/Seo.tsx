import { Helmet } from "react-helmet";

export const SITE_URL = "https://www.myprivacytool.io";
export const SITE_NAME = "MyPrivacyTOOL.IO";
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.jpg`;
/** Share-tag attribution for blog articles (what LinkedIn Post Inspector reads as Author). */
export const ARTICLE_AUTHOR = "Alice";
export const ARTICLE_PUBLISHER = "Wonderland";

interface SeoProps {
  title: string;
  description: string;
  /** Path such as "/scan". Omit to keep the route-level default canonical from Layout. */
  path?: string;
  /** Absolute URL of a 1200x630 preview image. Defaults to the site-wide card. */
  image?: string;
  /** Open Graph type; "article" for blog posts. */
  type?: "website" | "article";
  noindex?: boolean;
}

/**
 * Per-page <title>, meta description, canonical, Open Graph and Twitter card tags.
 * Renders nothing visible. index.html's static og/twitter tags carry data-react-helmet
 * so these replace them instead of duplicating.
 */
const Seo = ({ title, description, path, image = DEFAULT_OG_IMAGE, type = "website", noindex }: SeoProps) => {
  const url = path !== undefined ? `${SITE_URL}${path === "/" ? "" : path}` : undefined;
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      {noindex && <meta name="robots" content="noindex" />}
      {url && <link rel="canonical" href={url} />}
      {url && <meta property="og:url" content={url} />}
      <meta property="og:type" content={type} />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:image" content={image} />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      {type === "article" && <meta name="author" content={ARTICLE_AUTHOR} />}
      {type === "article" && <meta property="article:author" content={ARTICLE_AUTHOR} />}
      {type === "article" && <meta property="article:publisher" content={ARTICLE_PUBLISHER} />}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={image} />
    </Helmet>
  );
};

export default Seo;
