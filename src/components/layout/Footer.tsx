import { Link } from "react-router-dom";
import { Facebook, Instagram, Linkedin, Twitter } from "lucide-react";
import { trackSocialClick } from "@/lib/analytics";
import { socialLinks } from "@/lib/socialLinks";
import { openCookiePreferences } from "@/lib/cookieConsent";
import logoFooter from "@/assets/logo-footer.png";

const COMPANY_LINKS = [
  { label: "Pricing", to: "/pricing" },
  { label: "For Business", to: "/business" },
  { label: "About", to: "/about" },
  { label: "Blog", to: "/blog" },
  { label: "Contact", to: "/contact" },
];

const GUIDES_LINKS = [
  { label: "Remove my info from the internet", to: "/guides/remove-my-info-from-internet" },
  { label: "Remove my info from Google", to: "/guides/remove-from-google" },
  { label: "Stop spam calls & emails", to: "/guides/stop-spam" },
  { label: "Opt-out guides", to: "/opt-out-guides" },
];

const LEGAL_LINKS = [
  { label: "Privacy Policy", to: "/privacy" },
  { label: "Terms of Service", to: "/terms" },
  { label: "Cookie Policy", to: "/cookies" },
];

const SOCIAL_ITEMS = [
  { platform: "x", label: "Follow us on X", url: socialLinks.x, Icon: Twitter },
  { platform: "linkedin", label: "Follow us on LinkedIn", url: socialLinks.linkedin, Icon: Linkedin },
  { platform: "instagram", label: "Follow us on Instagram", url: socialLinks.instagram, Icon: Instagram },
  { platform: "facebook", label: "Follow us on Facebook", url: socialLinks.facebook, Icon: Facebook },
];

const FooterLinkList = ({
  title,
  links,
}: {
  title: string;
  links: { label: string; to: string }[];
}) => (
  <div>
    <h3 className="text-sm font-semibold text-foreground mb-4">{title}</h3>
    <ul className="space-y-2.5">
      {links.map((link) => (
        <li key={link.to}>
          <Link
            to={link.to}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {link.label}
          </Link>
        </li>
      ))}
    </ul>
  </div>
);

const Footer = () => {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-background" role="contentinfo">
      <div className="container mx-auto px-4 py-12">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
          <FooterLinkList title="Company" links={COMPANY_LINKS} />
          <FooterLinkList title="Guides" links={GUIDES_LINKS} />
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-4">Legal</h3>
            <ul className="space-y-2.5">
              {LEGAL_LINKS.map((link) => (
                <li key={link.to}>
                  <Link
                    to={link.to}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={openCookiePreferences}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors text-left"
                >
                  Manage cookies
                </button>
              </li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-4">Follow us</h3>
            <div className="flex gap-3">
              {SOCIAL_ITEMS.map(({ platform, label, url, Icon }) => (
                <a
                  key={platform}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => trackSocialClick(platform, url)}
                  aria-label={label}
                  className="w-9 h-9 rounded-full bg-secondary hover:bg-secondary/70 flex items-center justify-center transition-colors"
                >
                  <Icon className="w-4 h-4 text-foreground/70" aria-hidden="true" />
                </a>
              ))}
            </div>
          </div>
        </div>

        <div className="pt-8 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-3">
          <Link to="/" className="flex items-center" aria-label="MyPrivacyTOOL home">
            <img src={logoFooter} alt="MyPrivacyTOOL.IO" className="h-8 object-contain" loading="lazy" />
          </Link>
          <p className="text-xs text-muted-foreground text-center">
            © {year} MyPrivacyTOOL, {"{LEGAL_ENTITY_NAME}"}, Hong Kong
          </p>
          <p className="text-xs text-muted-foreground">We never sell your data.</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
