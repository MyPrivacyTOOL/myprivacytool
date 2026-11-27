import { MAX_LISTING_URLS, type ListingFields } from "@/lib/listingFields";
import FeatureStatus from "@/components/FeatureStatus";

// MPC-9813 (F1, Chris Decision 7): the optional "show us your listing" fields. Each label says why it is asked. Nothing is searched automatically.
// Shown only where a saved scan exists to keep them with (the details are stored with the saved scan and deleted with it).
const inputClass = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary disabled:opacity-60";

export default function ListingCheckFields({ idSuffix, value, onChange, disabled }: { idSuffix: string; value: ListingFields; onChange: (v: ListingFields) => void; disabled?: boolean }) {
  const set = (patch: Partial<ListingFields>) => onChange({ ...value, ...patch });
  const id = (n: string) => `listing-${n}-${idSuffix}`;
  return (
    <details className="w-full rounded-md border border-border bg-card px-3 py-2 text-left" data-testid="listing-fields">
      <summary className="cursor-pointer text-sm font-semibold text-foreground">
        Optional: show us a page that lists you<FeatureStatus feature="F1" />
      </summary>
      <div className="mt-3 space-y-3 text-xs text-muted-foreground">
        <p>
          <strong className="text-foreground">We check only pages you show us.</strong> We do not search broker sites for you. Paste the address of a page that lists you and,
          once you have confirmed your email, we read that one page and tell you whether it shows the details you gave. Only enter details about yourself.
        </p>
        <label htmlFor={id("name")} className="block">
          Your full name, as it would be listed (so we can look for it on the page)
          <input id={id("name")} className={inputClass} autoComplete="name" maxLength={120} value={value.fullName} disabled={disabled} onChange={(e) => set({ fullName: e.target.value })} />
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label htmlFor={id("city")} className="col-span-2 block">
            City and region (to tell you apart from people with your name)
            <input id={id("city")} className={inputClass} autoComplete="address-level2" maxLength={120} placeholder="e.g. Austin, TX" value={value.cityRegion} disabled={disabled} onChange={(e) => set({ cityRegion: e.target.value })} />
          </label>
          <label htmlFor={id("country")} className="block">
            Country
            <input id={id("country")} className={inputClass} maxLength={2} placeholder="US" value={value.country} disabled={disabled} onChange={(e) => set({ country: e.target.value.toUpperCase() })} />
          </label>
        </div>
        <label htmlFor={id("phone")} className="block">
          Your phone number (so we can see whether the page shows it)
          <input id={id("phone")} className={inputClass} type="tel" autoComplete="tel" maxLength={32} value={value.phone} disabled={disabled} onChange={(e) => set({ phone: e.target.value })} />
        </label>
        {Array.from({ length: MAX_LISTING_URLS }, (_, i) => (
          <label key={i} htmlFor={id(`url${i}`)} className="block">
            {i === 0 ? "Address of a page that lists you (up to 3)" : "Another page that lists you"}
            <input id={id(`url${i}`)} className={inputClass} type="url" inputMode="url" maxLength={500} placeholder="https://" value={value.urls[i] ?? ""} disabled={disabled}
              onChange={(e) => set({ urls: value.urls.map((u, j) => (j === i ? e.target.value : u)) })} />
          </label>
        ))}
        <p>
          These details are kept with your saved scan for 12 months and deleted with it when you quote your scan number. They are used only after you confirm your email.
        </p>
      </div>
    </details>
  );
}
