import { useState } from "react";
import { Link } from "react-router-dom";
import { Globe2, ShieldCheck, Users, ChevronDown, type LucideIcon } from "lucide-react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";

// MPC-102: the three "What enterprise includes" cards open to show what each one means in practice:
// related links, a short visual guide, plain answers, and a tick-box checklist a buyer can work through.
// Copy makes no numeric SLA promise: service levels are agreed per contract.

interface Topic {
  id: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  links: { label: string; to: string }[];
  guide: { title: string; desc: string }[];
  faq: { q: string; a: string }[];
  checklist: string[];
}

const TOPICS: Topic[] = [
  {
    id: "apac",
    icon: Globe2,
    title: "APAC coverage",
    desc: "Our removal workflows focus on Hong Kong, Singapore and Australia, alongside major US data brokers, so regional staff are not an afterthought.",
    links: [
      { label: "Opt-out guides (HK, SG, AU, US)", to: "/opt-out-guides" },
      { label: "How a scan works (FAQ)", to: "/faq" },
    ],
    guide: [
      { title: "Pick your regions", desc: "Tell us where your staff live and work." },
      { title: "We scan the listings", desc: "People-search sites, data brokers and marketing lists for those regions." },
      { title: "We file removals", desc: "Opt-out requests go out for each listing we find." },
      { title: "We re-check", desc: "Brokers re-list people, so we look again." },
    ],
    faq: [
      { q: "Which countries are covered?", a: "Hong Kong, Singapore and Australia are our focus, plus major US brokers. Other countries can be discussed in the demo." },
      { q: "Do you cover staff who work remotely abroad?", a: "We scan by person, not by office, so tell us where each person is likely to be listed." },
      { q: "What do you need from us to start?", a: "A list of the people to cover, or just your leadership team to begin with." },
    ],
    checklist: ["List the regions your staff are based in", "Decide who to cover first (leadership, high-risk roles, everyone)", "Confirm who in your team owns the rollout"],
  },
  {
    id: "score",
    icon: ShieldCheck,
    title: "Privacy Score and reporting",
    desc: "A per-organisation exposure report and Privacy Score show who is exposed, what is visible and how it changes after removals. Service levels are agreed in your contract.",
    links: [
      { label: "See the exposure report", to: "/report" },
      { label: "Run the free scan yourself", to: "/scan" },
    ],
    guide: [
      { title: "Baseline", desc: "A first scan shows who is exposed and what is visible." },
      { title: "Score", desc: "Each person and the organisation get a Privacy Score." },
      { title: "Remove", desc: "We file removals and track the outcome." },
      { title: "Report", desc: "You see how the score changes over time." },
    ],
    faq: [
      { q: "What does the Privacy Score measure?", a: "How much of a person's personal information is visible on public listings, and how sensitive it is." },
      { q: "Can we share the report with auditors or the board?", a: "Tell us who needs to see it and in what format, and we will cover that in the demo." },
      { q: "What service levels do you offer?", a: "Service levels are agreed in your contract. We will walk through the options in the demo." },
    ],
    checklist: ["Decide who receives the report", "Agree which roles count as high risk", "Note any audit or board deadline we should plan around"],
  },
  {
    id: "contact",
    icon: Users,
    title: "Named contact and onboarding",
    desc: "A dedicated contact, executive and high-risk-role prioritisation, and help rolling out to your workforce.",
    links: [
      { label: "Book a call", to: "/contact" },
      { label: "Privacy Policy", to: "/privacy" },
    ],
    guide: [
      { title: "Kick-off", desc: "You meet your named contact and agree scope." },
      { title: "Priority group", desc: "Executives and high-risk roles go first." },
      { title: "Workforce rollout", desc: "We help you invite and brief everyone else." },
      { title: "Ongoing", desc: "One person to ask when something comes up." },
    ],
    faq: [
      { q: "Who will we deal with?", a: "One named contact from MyPrivacyTOOL for the life of the engagement." },
      { q: "How do staff find out?", a: "We help you plan the rollout and how it is explained to staff. We will cover this in the demo." },
      { q: "How is staff data handled?", a: "We use it only to run the scan and removals. See the Privacy Policy for details." },
    ],
    checklist: ["Name your internal sponsor", "Draft the message to staff", "Choose a kick-off date"],
  },
];

const EnterpriseIncludes = () => {
  const [done, setDone] = useState<Record<string, boolean>>({});
  const toggle = (key: string, value: boolean) => setDone((d) => ({ ...d, [key]: value }));

  return (
    <Accordion type="single" collapsible className="grid md:grid-cols-3 gap-4 items-start">
      {TOPICS.map(({ id, icon: Icon, title, desc, links, guide, faq, checklist }) => {
        const ticked = checklist.filter((_, i) => done[`${id}-${i}`]).length;
        return (
          <AccordionItem key={id} value={id} className="rounded-xl bg-card border border-border md:data-[state=open]:col-span-3">
            <AccordionTrigger className="p-6 text-left hover:no-underline items-start gap-4 [&>svg]:mt-1">
              <span className="block">
                <span className="mb-4 block"><Icon className="w-6 h-6 text-brand" aria-hidden="true" /></span>
                <span className="font-bold mb-2 block">{title}</span>
                <span className="text-muted-foreground text-sm leading-relaxed font-normal block">{desc}</span>
                <span className="text-brand text-xs font-semibold mt-3 inline-flex items-center gap-1">
                  See what this means <ChevronDown className="w-3 h-3" aria-hidden="true" />
                </span>
              </span>
            </AccordionTrigger>
            <AccordionContent className="px-6 pb-6 space-y-8">
              <div>
                <h3 className="text-sm font-semibold mb-3">Visual guide</h3>
                <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {guide.map((s, i) => (
                    <li key={s.title} className="rounded-lg border border-border bg-background p-4">
                      <div className="text-brand font-bold text-lg mb-1">{i + 1}</div>
                      <div className="font-semibold text-sm mb-1">{s.title}</div>
                      <div className="text-muted-foreground text-xs leading-relaxed">{s.desc}</div>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">Questions and answers</h3>
                <dl className="space-y-3">
                  {faq.map(({ q, a }) => (
                    <div key={q}>
                      <dt className="text-sm font-medium">{q}</dt>
                      <dd className="text-muted-foreground text-sm leading-relaxed">{a}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div>
                <h3 className="text-sm font-semibold mb-3">
                  Before the demo <span className="text-muted-foreground font-normal">({ticked} of {checklist.length} done)</span>
                </h3>
                <ul className="space-y-2">
                  {checklist.map((item, i) => {
                    const key = `${id}-${i}`;
                    return (
                      <li key={key} className="flex items-start gap-3">
                        <Checkbox
                          id={`enterprise-check-${key}`}
                          checked={!!done[key]}
                          onCheckedChange={(v) => toggle(key, v === true)}
                          className="mt-0.5"
                        />
                        <label htmlFor={`enterprise-check-${key}`} className="text-sm text-muted-foreground cursor-pointer">{item}</label>
                      </li>
                    );
                  })}
                </ul>
              </div>

              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                {links.map((l) => (
                  <Link key={l.to + l.label} to={l.to} className="underline hover:text-foreground">{l.label}</Link>
                ))}
              </div>
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
};

export default EnterpriseIncludes;
