import { Link } from "react-router-dom";
import Seo from "@/components/Seo";
import CodeBlock from "@/components/developers/CodeBlock";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import pageMeta from "@/data/pageMeta.json";
import {
  AUTH_ROWS,
  BASES,
  ENDPOINTS,
  INTERNAL_SERVICES,
  LANG_LABEL,
  LIMITATIONS,
  PAPIT_SCHEMA,
  QUICK_START_STEPS,
  RATE_ROWS,
  SNIPPETS,
  STATUS_LABEL,
  type Endpoint,
  type Lang,
} from "@/data/developerDocs";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "quick-start", label: "Quick start" },
  { id: "authentication", label: "Authentication" },
  { id: "rate-limits", label: "Rate limits" },
  { id: "endpoints", label: "API reference" },
  { id: "papit", label: "PaPIT profile" },
  { id: "sdk", label: "Code snippets" },
  { id: "errors", label: "Errors" },
  { id: "limitations", label: "Known limitations" },
  { id: "support", label: "Support" },
];

const LANGS = Object.keys(LANG_LABEL) as Lang[];

const statusVariant = (s: Endpoint["status"]) => (s === "live" ? "default" : "secondary");

const H2 = ({ id, children }: { id: string; children: string }) => (
  <h2 id={id} className="mb-4 mt-14 scroll-mt-24 text-2xl font-bold text-gray-900">
    {children}
  </h2>
);

const Table = ({ head, rows }: { head: string[]; rows: string[][] }) => (
  <div className="my-4 overflow-x-auto rounded-lg border border-gray-200 bg-white">
    <table className="w-full text-left text-sm">
      <thead className="bg-gray-100 text-gray-700">
        <tr>
          {head.map((h) => (
            <th key={h} scope="col" className="px-4 py-2 font-semibold">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.join("|")} className="border-t border-gray-200 align-top">
            {r.map((c, i) => (
              <td key={i} className={`px-4 py-2 ${i === 0 ? "font-medium text-gray-900" : "text-gray-700"}`}>
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const EndpointCard = ({ e }: { e: Endpoint }) => (
  <article id={e.id} className="my-6 scroll-mt-24 rounded-lg border border-gray-200 bg-white p-5">
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className="font-mono">
        {e.method}
      </Badge>
      <code className="break-all text-base font-semibold text-gray-900">{e.path}</code>
      <Badge variant={statusVariant(e.status)}>{STATUS_LABEL[e.status]}</Badge>
    </div>
    <p className="mt-1 text-xs text-gray-500">
      {e.service} · base <code>{e.base}</code>
    </p>
    <p className="mt-3 text-gray-700">{e.summary}</p>
    <p className="mt-2 text-sm text-gray-700">
      <strong>Auth:</strong> {e.auth}
    </p>

    {e.request && (
      <>
        <h4 className="mt-4 text-sm font-semibold text-gray-900">Request body ({e.request.contentType})</h4>
        <Table
          head={["Field", "Type", "Description"]}
          rows={e.request.fields.map((f) => [`${f.name}${f.required ? " *" : ""}`, f.type, f.description])}
        />
        <p className="-mt-2 text-xs text-gray-500">* required</p>
      </>
    )}

    <h4 className="mt-4 text-sm font-semibold text-gray-900">Example</h4>
    <CodeBlock code={e.curl} label={`${e.method} ${e.path} example`} />

    <h4 className="mt-4 text-sm font-semibold text-gray-900">Responses</h4>
    <ul className="mt-2 space-y-3">
      {e.responses.map((r, i) => (
        <li key={`${r.status}-${i}`}>
          <p className="text-sm text-gray-700">
            <code className="rounded bg-gray-100 px-1.5 py-0.5 font-semibold">{r.status}</code> {r.description}
          </p>
          {r.body && <CodeBlock code={r.body} label={`${r.status} response`} />}
        </li>
      ))}
    </ul>

    {e.notes && (
      <ul className="mt-4 list-inside list-disc space-y-1 text-sm text-gray-700">
        {e.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    )}
  </article>
);

const Developers = () => (
  <>
    <Seo {...pageMeta["/developers"]} path="/developers" />
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <header>
          <Badge variant="secondary">Developer preview</Badge>
          <h1 className="mt-3 text-4xl font-bold text-gray-900">MyPrivacyTOOL for developers</h1>
          <p className="mt-2 max-w-3xl text-lg text-gray-600">
            Reference for the HTTP endpoints that exist today, with request and response examples, how access works,
            and snippets in JavaScript/TypeScript, Python and Go.
          </p>
        </header>

        <div className="mt-10 lg:grid lg:grid-cols-[14rem_1fr] lg:gap-10">
          <nav aria-label="On this page" className="mb-8 lg:sticky lg:top-24 lg:mb-0 lg:self-start">
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm lg:flex-col lg:gap-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-gray-600 underline-offset-2 hover:text-primary hover:underline">
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="min-w-0">
            <H2 id="overview">Overview</H2>
            <p className="text-gray-700">
              MyPrivacyTOOL runs its back end as small Cloudflare Workers. This page documents the ones with an HTTP
              surface. There is no general-purpose public API yet: no API keys are issued and no versioned base path
              exists. What you can integrate with today is:
            </p>
            <ul className="mt-3 list-inside list-disc space-y-1 text-gray-700">
              <li>
                <strong>Scan requests</strong>: ask for a privacy scan and emailed report for a user who has consented.
              </li>
              <li>
                <strong>The GitHub channel</strong>: let a user connect GitHub and read a sanitized PaPIT profile
                (preview, browser flow).
              </li>
              <li>
                <strong>PaPIT receipts</strong>: verify that a profile you received has not been edited.
              </li>
            </ul>
            <p className="mt-3 text-gray-700">
              Each endpoint carries a status: <Badge>Live</Badge> in production use, <Badge variant="secondary">Preview</Badge>{" "}
              works but may change without notice. If you need something that is not here, see{" "}
              <a href="#support" className="text-primary underline">
                Support
              </a>
              .
            </p>

            <H2 id="quick-start">Quick start</H2>
            <p className="text-gray-700">Request a privacy scan for a user in four steps. You need nothing but HTTPS.</p>
            <ol className="mt-4 space-y-6">
              {QUICK_START_STEPS.map((s, i) => (
                <li key={s.title}>
                  <h3 className="font-semibold text-gray-900">
                    {i + 1}. {s.title}
                  </h3>
                  <p className="mt-1 text-gray-700">{s.body}</p>
                  {s.code && <CodeBlock code={s.code} label={s.title} />}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-sm text-gray-600">
              Email delivery is currently limited to an allowlist of test inboxes while launch approval is pending, so a
              successful request from your own address may not produce an email yet. The request is still recorded.
            </p>

            <H2 id="authentication">Authentication</H2>
            <p className="text-gray-700">
              There are no API keys and no bearer tokens to send. Access works differently for each surface:
            </p>
            <Table
              head={["Surface", "Mechanism", "Details"]}
              rows={AUTH_ROWS.map((r) => [r.surface, r.mechanism, r.detail])}
            />
            <p className="text-gray-700">
              OAuth tokens (GitHub, Google) are held by MyPrivacyTOOL, never given to you. GitHub tokens are stored
              AES-256-GCM encrypted and can be revoked by the user at any time; the Google proof of concept stores
              nothing and revokes its token before it responds.
            </p>

            <H2 id="rate-limits">Rate limits</H2>
            <p className="text-gray-700">
              Limits are minimal today. Do not assume a published quota exists beyond the table; design callers to back off on
              any 5xx.
            </p>
            <Table
              head={["Surface", "Limit", "Details"]}
              rows={RATE_ROWS.map((r) => [r.surface, r.limit, r.detail])}
            />

            <H2 id="endpoints">API reference</H2>
            <p className="text-gray-700">Base URLs:</p>
            <Table
              head={["Service", "Base URL"]}
              rows={[
                ["Scan & report", BASES.scan],
                ["Lead capture", BASES.leads],
                ["GitHub channel", BASES.github],
                ["Google OAuth proof of concept", BASES.oauthPoc],
              ]}
            />
            <p className="text-sm text-gray-600">
              Browser calls from other origins are blocked by CORS. Call the scan endpoint from your server.
            </p>
            {ENDPOINTS.map((e) => (
              <EndpointCard key={e.id} e={e} />
            ))}
            <h3 className="mt-8 text-lg font-semibold text-gray-900">Internal services</h3>
            <p className="text-gray-700">These are not part of any integration surface.</p>
            <Table head={["Worker", "Note"]} rows={INTERNAL_SERVICES.map((s) => [s.name, s.note])} />

            <H2 id="papit">PaPIT profile</H2>
            <p className="text-gray-700">
              PaPIT (Private and Portable Identity Tool) is the portable profile built from a connected channel. It is
              derived only: language names, topic slugs, counts and a role label. It never contains an email, name,
              username, location, company, avatar, URL or bio text.
            </p>
            <CodeBlock code={PAPIT_SCHEMA} label="PaPIT schema" />
            <p className="text-gray-700">
              Activity level is based on public events in the last 90 days: fewer than 5 is low, 5 to 50 medium, over 50
              high. Additive changes keep <code>version: "1.0"</code>; removing or re-typing a field bumps the major
              version.
            </p>

            <H2 id="sdk">Code snippets</H2>
            <p className="text-gray-700">
              There is no published SDK package. These are copy-paste examples against the endpoints above, with no
              dependencies beyond each language's standard library.
            </p>
            {SNIPPETS.map((s) => (
              <section key={s.id} id={`snippet-${s.id}`} className="my-8 scroll-mt-24">
                <h3 className="text-lg font-semibold text-gray-900">{s.title}</h3>
                <p className="mt-1 text-gray-700">{s.description}</p>
                <Tabs defaultValue="typescript" className="mt-3">
                  <TabsList>
                    {LANGS.map((l) => (
                      <TabsTrigger key={l} value={l}>
                        {LANG_LABEL[l]}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {LANGS.map((l) => (
                    <TabsContent key={l} value={l}>
                      <CodeBlock code={s.code[l]} label={`${s.title} in ${LANG_LABEL[l]}`} />
                    </TabsContent>
                  ))}
                </Tabs>
              </section>
            ))}

            <H2 id="errors">Errors</H2>
            <p className="text-gray-700">
              Failures return JSON with an HTTP status. The body shape depends on the Worker, so read the status first.
            </p>
            <Table
              head={["Worker", "Shape", "Example"]}
              rows={[
                ["Scan & report, lead capture", "{ error: string }", '{ "error": "Consent required" }'],
                ["GitHub channel", "{ error: code }", '{ "error": "reauthorize" }'],
                ["Google OAuth proof of concept", "{ ok: false, error: string }", '{ "ok": false, "error": "invalid_state" }'],
              ]}
            />
            <ul className="mt-3 list-inside list-disc space-y-1 text-gray-700">
              <li>400: fix the request. Do not retry unchanged.</li>
              <li>401: the session is missing or expired. Send the user through the connect flow again.</li>
              <li>403: the Origin is not allowed.</li>
              <li>404: wrong method or path (plain text, not JSON).</li>
              <li>500 / 502: retry later with backoff.</li>
            </ul>

            <H2 id="limitations">Known limitations</H2>
            <ul className="list-inside list-disc space-y-2 text-gray-700">
              {LIMITATIONS.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>

            <H2 id="support">Support</H2>
            <p className="text-gray-700">
              Questions, access requests and bug reports: email{" "}
              <a href="mailto:support@myprivacytool.io" className="text-primary underline">
                support@myprivacytool.io
              </a>{" "}
              or use the <Link to="/contact" className="text-primary underline">contact page</Link>. See our <Link to="/terms" className="text-primary underline">Terms</Link> and{" "}
              <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </main>
  </>
);

export default Developers;
