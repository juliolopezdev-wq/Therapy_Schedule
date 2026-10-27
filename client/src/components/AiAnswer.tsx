import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";

// "Room 204 (Jane Doe)" -> a patient chip. Rendered through a fake link so markdown
// around it (bold, lists, tables) keeps working. Internal ids like "(id 22)" are dropped.
function prepare(markdown: string) {
  return markdown
    .replace(/\s*[([](?:therapist |team |patient )?id \d+[)\]]/gi, "")
    .replace(/\bRoom ([\w-]+) \(([^()\n]+)\)/g, (_m, room, name) => `[${name}](patient:${encodeURIComponent(room)})`);
}

const components: Components = {
  h1: ({ children }) => <h3 className="mb-1.5 mt-4 text-sm font-bold text-slate-900 first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mb-1.5 mt-4 text-sm font-bold text-slate-900 first:mt-0">{children}</h3>,
  h3: ({ children }) => (
    <h4 className="mb-1.5 mt-4 border-b border-slate-100 pb-1 text-xs font-bold uppercase tracking-wide text-slate-500 first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children, node }) => {
    // an answer that opens with a bold sentence gets it as a headline
    const only = node?.children.length === 1 ? node.children[0] : null;
    const headline = node?.position?.start.offset === 0 && only?.type === "element" && only.tagName === "strong";
    if (headline) {
      return <p className="mb-3 rounded-lg bg-blue-50 px-3 py-2 text-[0.95rem] leading-snug text-blue-950 [&_strong]:font-semibold [&_strong]:text-blue-950">{children}</p>;
    }
    return <p className="mb-2 last:mb-0">{children}</p>;
  },
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1.5 pl-5 marker:text-blue-400">{children}</ul>,
  // numbered steps get round number badges
  ol: ({ children }) => <ol className="my-2 space-y-2 [counter-reset:step]">{children}</ol>,
  li: ({ children }) => {
    return (
      <li className="pl-0.5 [ol>&]:relative [ol>&]:pl-8 [ol>&]:[counter-increment:step] [ol>&]:before:absolute [ol>&]:before:left-0 [ol>&]:before:top-0 [ol>&]:before:flex [ol>&]:before:h-5 [ol>&]:before:w-5 [ol>&]:before:items-center [ol>&]:before:justify-center [ol>&]:before:rounded-full [ol>&]:before:bg-blue-600 [ol>&]:before:text-[11px] [ol>&]:before:font-bold [ol>&]:before:text-white [ol>&]:before:content-[counter(step)]">
        {children}
      </li>
    );
  },
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  blockquote: ({ children }) => (
    <div className="my-2 rounded-lg border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-amber-950 [&_p]:mb-1">{children}</div>
  ),
  code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">{children}</code>,
  hr: () => <hr className="my-3 border-slate-100" />,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-slate-100 last:border-0 even:bg-slate-50/50">{children}</tr>,
  th: ({ children }) => <th className="whitespace-nowrap px-3 py-2 font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 align-top tabular-nums text-slate-700">{children}</td>,
  a: ({ href, children }) => {
    if (href?.startsWith("patient:")) {
      const room = decodeURIComponent(href.slice("patient:".length));
      return (
        <span className="inline-flex items-baseline gap-1 whitespace-nowrap rounded-md bg-blue-50 px-1.5 py-px font-medium text-blue-800 ring-1 ring-inset ring-blue-200">
          <User className="h-3 w-3 self-center" aria-hidden />
          <span className="text-[0.8em] font-semibold text-blue-500">Rm {room}</span>
          {children}
        </span>
      );
    }
    return (
      <a href={href} target="_blank" rel="noreferrer" className="font-medium text-blue-700 underline underline-offset-2">
        {children}
      </a>
    );
  },
};

export function AiAnswer({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("min-w-0 text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={(url) => (url.startsWith("patient:") ? url : defaultUrlTransform(url))}
      >
        {prepare(text)}
      </ReactMarkdown>
    </div>
  );
}
