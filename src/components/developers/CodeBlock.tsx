import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CodeBlockProps {
  code: string;
  label?: string;
}

const CodeBlock = ({ code, label }: CodeBlockProps) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the text stays selectable.
    }
  };

  return (
    <div className="relative my-3 rounded-lg border border-gray-200 bg-gray-900">
      <button
        type="button"
        onClick={copy}
        aria-label={label ? `Copy ${label}` : "Copy code"}
        className="absolute right-2 top-2 inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-xs text-gray-200 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {copied ? <Check className="h-3 w-3" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto p-4 pr-20 text-sm leading-relaxed text-gray-100">
        <code>{code}</code>
      </pre>
    </div>
  );
};

export default CodeBlock;
