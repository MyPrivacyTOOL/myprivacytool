import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import logoHeader from "@/assets/logo-header.png";

interface NavItem {
  label: string;
  href: string;
  isAnchor?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { label: "Free Scan", href: "/" },
  { label: "How it works", href: "/#how-it-works", isAnchor: true },
  { label: "Pricing", href: "/pricing" },
  { label: "For Business", href: "/business" },
  { label: "Guides", href: "/blog" },
  { label: "About", href: "/about" },
];

const Header = () => {
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/";
    if (href.startsWith("/#")) return false;
    return location.pathname === href || location.pathname.startsWith(`${href}/`);
  };

  const handleHowItWorks = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (location.pathname === "/") {
      e.preventDefault();
      document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" });
      setMobileOpen(false);
    }
  };

  const renderLinks = (onNavigate?: () => void) =>
    NAV_ITEMS.map((item) => (
      <Link
        key={item.label}
        to={item.href}
        onClick={(e) => {
          if (item.isAnchor) handleHowItWorks(e);
          onNavigate?.();
        }}
        aria-current={isActive(item.href) ? "page" : undefined}
        className={cn(
          "text-sm font-medium transition-colors hover:text-primary",
          isActive(item.href) ? "text-primary" : "text-foreground/70",
        )}
      >
        {item.label}
      </Link>
    ));

  return (
    <header
      className="sticky top-0 z-50 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <nav
        className="container mx-auto px-4 h-16 flex items-center justify-between"
        role="navigation"
        aria-label="Main navigation"
      >
        <Link to="/" className="flex items-center shrink-0" aria-label="MyPrivacyTOOL home">
          <img
            src={logoHeader}
            alt="MyPrivacyTOOL.IO"
            className="h-9 sm:h-10 object-contain"
          />
        </Link>

        <div className="hidden md:flex items-center gap-6">{renderLinks()}</div>

        <div className="hidden md:block">
          <Button asChild>
            <Link to="/">Scan free</Link>
          </Button>
        </div>

        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden"
              aria-label="Open menu"
              aria-expanded={mobileOpen}
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="w-full sm:max-w-sm">
            <SheetTitle className="text-left">Menu</SheetTitle>
            <div className="mt-6 flex flex-col gap-5">
              {renderLinks(() => setMobileOpen(false))}
              <SheetClose asChild>
                <Button asChild className="mt-2">
                  <Link to="/">Scan free</Link>
                </Button>
              </SheetClose>
            </div>
          </SheetContent>
        </Sheet>
      </nav>
    </header>
  );
};

export default Header;
