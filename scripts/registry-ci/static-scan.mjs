// MPC-9884 layer 1: static scan with the TypeScript compiler API (design 1.4).
//   Rule url-literal        a URL literal with a non-relative host (http/https/ws/wss) or a stun:/turn: scheme must be in the registry or the
//                           non-outbound list (shared/recipients/non-outbound.json).
//   Rule forbidden-api      fetch, XMLHttpRequest, WebSocket, EventSource, sendBeacon, RTCPeerConnection, importScripts, import("http..") are
//                           forbidden outside shared/recipients/outbound.*; the wrapper is the only door.
//   Rule wrapper-key        every callRecipient / fetchRecipient / loadRecipientScript / createPeerConnection call passes a STRING-LITERAL key that exists.
// HTML (index.html, public/**/*.html) and CSS are scanned for resource URLs; <a href> is navigation, not a request, and is not flagged.
// Test files are not scanned (they hold mock hosts by design). What this cannot see: a host assembled from visitor input or a redirect (the
// wrapper's user_supplied rules and layer 2 cover those), and an indirect call through an injected fetchImpl (layer 3 covers those).
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { entriesForHost, hostMatches, isLocalHost, isNonOutbound, registryKeys } from "./registry.mjs";

export const SCAN_ROOTS = ["src", "functions", "workers", "shared", "index.html", "public"];
const SCAN_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".html", ".css"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "coverage", "test", "tests", "__tests__", "test-fixtures", "fixtures"]);
const TEST_FILE = /(\.test\.|\.vitest\.|\.spec\.|\.d\.ts$)/;
/** Vendored/minified third-party bundles are not our code; flagged as a file-level skip in the report, not silently. */
const MINIFIED = /\.min\.(js|css)$/;

const WRAPPER_DIR = "shared/recipients/";
export const isWrapperFile = (rel) => rel.startsWith(WRAPPER_DIR + "outbound.") || rel === WRAPPER_DIR + "fetch-spy.ts";

const WRAPPER_FUNCS = new Set(["callRecipient", "fetchRecipient", "loadRecipientScript", "createPeerConnection"]);
const CONSTRUCTOR_GLOBALS = new Set(["XMLHttpRequest", "WebSocket", "EventSource", "RTCPeerConnection", "webkitRTCPeerConnection", "mozRTCPeerConnection"]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);
const URL_RE = /\b(?:(https?|wss?):\/\/([^\s/?#"'`\\)<>]*)|(stuns?|turns?):([^\s/?#"'`\\,)<>]*))/gi;

const lineOf = (sf, pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

/** Extract {scheme, host} pairs from a text. A host containing a template/format placeholder is dynamic (skipped, the wrapper checks it at runtime). */
export function urlsIn(text) {
  const out = [];
  for (const m of text.matchAll(URL_RE)) {
    const scheme = (m[1] || m[3]).toLowerCase();
    let host = (m[2] ?? m[4] ?? "");
    host = host.replace(/^[^@]*@/, "").replace(/:\d*$/, "").replace(/\.$/, "").toLowerCase();
    if (!host || /[${}%*<>]/.test(host) || !/^[a-z0-9[\]]([a-z0-9.\-[\]:]*)$/.test(host)) continue;
    if (!host.includes(".") && !isLocalHost(host)) continue; // a bare word is a placeholder, not a host
    out.push({ scheme, host });
  }
  return out;
}

function urlFinding(file, line, scheme, host, registry, nonOutbound) {
  if (isLocalHost(host) || isNonOutbound(host, nonOutbound)) return null;
  const owners = entriesForHost(registry, host);
  if (owners.length) return null;
  return { rule: "url-literal", file, line, detail: `${scheme}://${host}`, message: `${scheme}://${host} is not a registered recipient host` };
}

const isDeclName = (node) => {
  const p = node.parent;
  if (!p) return false;
  return ((ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p) || ts.isPropertyDeclaration(p) ||
    ts.isPropertySignature(p) || ts.isParameter(p) || ts.isVariableDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) ||
    ts.isGetAccessor(p) || ts.isSetAccessor(p) || ts.isEnumMember(p) || ts.isBindingElement(p)) && p.name === node) ||
    (ts.isPropertyAssignment(p) && p.name === node) || (ts.isImportSpecifier(p)) || (ts.isExportSpecifier(p)) || ts.isImportClause(p) || ts.isNamespaceImport(p) ||
    (ts.isPropertyAccessExpression(p) && p.name === node) || ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isExpressionWithTypeArguments(p) ||
    ts.isJsxAttribute(p) || ts.isLabeledStatement(p) || ts.isQualifiedName(p);
};

const isTypeofOperand = (node) => ts.isTypeOfExpression(node.parent) && node.parent.expression === node;

/** A bare `fetch` identifier used as a call, a `new`, or a value that is handed on (so it can be called later). */
function fetchUse(node) {
  const p = node.parent;
  if (!p || isDeclName(node) || isTypeofOperand(node)) return false;
  if (ts.isCallExpression(p) && p.expression === node) return true;
  if (ts.isVariableDeclaration(p) && p.initializer === node) return true;
  if (ts.isBinaryExpression(p)) return true;
  if (ts.isPropertyAssignment(p) && p.initializer === node) return true;
  if (ts.isShorthandPropertyAssignment(p)) return true;
  if ((ts.isCallExpression(p) || ts.isNewExpression(p)) && p.arguments?.includes(node)) return true;
  if (ts.isPropertyAccessExpression(p) && p.expression === node && ["bind", "call", "apply"].includes(p.name.text)) return true;
  if (ts.isConditionalExpression(p) || ts.isParenthesizedExpression(p) || ts.isAsExpression(p) || ts.isReturnStatement(p)) return true;
  return false;
}

/** Scan one TS/JS source text. `rel` is the repo-relative posix path (used for the wrapper exemption and in findings). */
export function scanScript(rel, text, registry, nonOutbound, sink = null) {
  const findings = [];
  const keys = registryKeys(registry);
  const kind = /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : /\.jsx$/.test(rel) ? ts.ScriptKind.JSX : /\.(js|mjs|cjs)$/.test(rel) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const wrapper = isWrapperFile(rel);
  const add = (rule, node, detail, message) => findings.push({ rule, file: rel, line: lineOf(sf, node.getStart(sf)), detail, message });

  const visit = (node) => {
    // ---- URL literals ----
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const p = node.parent;
      const isAnchorHref = ts.isJsxAttribute(p) && p.name.getText(sf) === "href" && ts.isJsxOpeningLikeElement(p.parent.parent) && /^(a|Link)$/.test(p.parent.parent.tagName.getText(sf));
      const propName = ts.isPropertyAssignment(p) && p.initializer === node && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) ? p.name.text : null;
      const isLinkProp = propName !== null && (nonOutbound.link_properties ?? []).includes(propName);
      const isImportSpec = (ts.isImportDeclaration(p) || ts.isExportDeclaration(p)) && p.moduleSpecifier === node;
      if (!wrapper && !isAnchorHref && !isImportSpec && !isLinkProp) {
        for (const u of urlsIn(node.text)) {
          sink?.hosts.add(u.host);
          const f = urlFinding(rel, lineOf(sf, node.getStart(sf)), u.scheme, u.host, registry, nonOutbound);
          if (f) findings.push(f);
        }
      }
    }
    if (!wrapper) {
      // ---- forbidden APIs ----
      if (ts.isIdentifier(node)) {
        const name = node.text;
        if (name === "fetch" && fetchUse(node)) add("forbidden-api", node, "fetch", "fetch() outside shared/recipients/outbound: use callRecipient/fetchRecipient");
        else if (CONSTRUCTOR_GLOBALS.has(name) && !isDeclName(node) && !isTypeofOperand(node)) add("forbidden-api", node, name.replace(/^(webkit|moz)/, ""), `${name} outside shared/recipients/outbound: use the wrapper`);
        else if (name === "importScripts" && !isDeclName(node)) add("forbidden-api", node, "importScripts", "importScripts outside shared/recipients/outbound");
      }
      if (ts.isPropertyAccessExpression(node)) {
        const n = node.name.text;
        const obj = node.expression;
        if (n === "sendBeacon") add("forbidden-api", node.name, "sendBeacon", "navigator.sendBeacon outside shared/recipients/outbound");
        else if (n === "fetch" && ts.isIdentifier(obj) && GLOBAL_OBJECTS.has(obj.text)) add("forbidden-api", node.name, "fetch", `${obj.text}.fetch outside shared/recipients/outbound`);
        else if ((CONSTRUCTOR_GLOBALS.has(n)) && ts.isIdentifier(obj) && GLOBAL_OBJECTS.has(obj.text)) add("forbidden-api", node.name, n.replace(/^(webkit|moz)/, ""), `${obj.text}.${n} outside shared/recipients/outbound`);
      }
      if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && ts.isIdentifier(node.expression) && GLOBAL_OBJECTS.has(node.expression.text) &&
        (node.argumentExpression.text === "fetch" || CONSTRUCTOR_GLOBALS.has(node.argumentExpression.text))) {
        add("forbidden-api", node, node.argumentExpression.text.replace(/^(webkit|moz)/, ""), `${node.expression.text}["${node.argumentExpression.text}"] outside shared/recipients/outbound`);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const a = node.arguments[0];
        if (a && ts.isStringLiteralLike(a) && /^https?:\/\//i.test(a.text)) add("forbidden-api", node, "import(http)", "dynamic import() of a remote URL");
        else if (a && !ts.isStringLiteralLike(a) && !ts.isTemplateExpression(a)) add("forbidden-api", node, "import(dynamic)", "dynamic import() of a computed specifier cannot be proven local");
      }
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && /^https?:\/\//i.test(node.moduleSpecifier.text)) add("forbidden-api", node, "import(http)", "static import of a remote URL");
    }
    // ---- wrapper calls need a literal, existing key ----
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression) ? node.expression.text : ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : null;
      if (callee && WRAPPER_FUNCS.has(callee) && !wrapper) {
        const a = node.arguments[0];
        if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) sink?.keys.add(a.text);
        if (!a || !(ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) add("wrapper-key", node, `${callee}(<non-literal>)`, `${callee}() must pass a string-literal registry key as its first argument`);
        else if (!keys.has(a.text)) add("wrapper-key", node, `${callee}("${a.text}")`, `${callee}("${a.text}"): no such key in shared/recipients/recipients.json`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

/** HTML/CSS: resource URLs only. <a href> is navigation. Inline <script> bodies are scanned as script. */
export function scanMarkup(rel, text, registry, nonOutbound, sink = null) {
  const findings = [];
  const isCss = rel.endsWith(".css");
  const lines = text.split("\n");
  const stripAnchors = (s) => s.replace(/<a\b[^>]*>/gi, (tag) => tag.replace(/https?:\/\/\S+/gi, ""));
  lines.forEach((raw, i) => {
    const line = isCss ? raw : stripAnchors(raw);
    if (/^\s*(<!--|\/\*|\*)/.test(line) && !/<(script|link|img|iframe|source|form)\b/i.test(line)) return; // a pure comment line
    for (const u of urlsIn(line)) {
      sink?.hosts.add(u.host);
      const f = urlFinding(rel, i + 1, u.scheme, u.host, registry, nonOutbound);
      if (f) findings.push(f);
    }
  });
  if (!isCss) {
    for (const m of text.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      const startLine = text.slice(0, m.index).split("\n").length;
      for (const f of scanScript(rel + "#inline", m[1], registry, nonOutbound, sink)) findings.push({ ...f, file: rel, line: startLine + f.line - 1 });
    }
  }
  return dedupeSameSpot(findings);
}

function dedupeSameSpot(fs) {
  const seen = new Set();
  return fs.filter((f) => { const k = `${f.rule}|${f.file}|${f.line}|${f.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

function* walk(root, abs) {
  let st;
  try { st = statSync(abs); } catch { return; }
  if (st.isFile()) { yield abs; return; }
  for (const name of readdirSync(abs)) {
    if (SKIP_DIRS.has(name)) continue;
    yield* walk(root, join(abs, name));
  }
}

/** Scan the repo. Returns {findings, filesScanned, skipped}. Deterministic order (file, line). */
export function scanRepo(root, registry, nonOutbound, roots = SCAN_ROOTS) {
  const findings = [];
  const skipped = [];
  const sink = { hosts: new Set(), keys: new Set() };
  let filesScanned = 0;
  for (const r of roots) {
    for (const abs of walk(root, join(root, r))) {
      const rel = relative(root, abs).split(sep).join("/");
      const ext = rel.slice(rel.lastIndexOf("."));
      if (!SCAN_EXT.has(ext) || TEST_FILE.test(rel)) continue;
      if (MINIFIED.test(rel)) { skipped.push(`${rel} (minified third-party bundle)`); continue; }
      const text = readFileSync(abs, "utf8");
      filesScanned++;
      const fs = /\.(html|css)$/.test(rel) ? scanMarkup(rel, text, registry, nonOutbound, sink) : scanScript(rel, text, registry, nonOutbound, sink);
      findings.push(...fs);
    }
  }
  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.detail.localeCompare(b.detail));
  return { findings, filesScanned, skipped, seenHosts: sink.hosts, seenKeys: sink.keys };
}

export { hostMatches };
