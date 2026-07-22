/**
 * Rendered markdown for the viewer's file displays (#143): run response.md,
 * sandbox artifacts, and the Files/Instructions tabs the review panel's
 * artifact links deep-link into.
 *
 * `MarkdownContent` renders `runtime/markdown.ts`'s block AST as React
 * elements -- no `dangerouslySetInnerHTML` anywhere, so untrusted
 * (agent-produced) markdown is sanitized by construction: raw HTML in the
 * source only ever appears as literal text, and `<script>`/`<iframe>`
 * payloads cannot execute. Link hrefs pass the parser's scheme allowlist.
 *
 * `FileContentView` is the shared "file contents" pane: `.md` files render
 * formatted with a Raw toggle (the toggle only flips presentation -- the
 * content string is untouched, so switching back is lossless); every other
 * file keeps the plain <pre> it always had.
 */
import { useState, type FC } from "react";
import { isMarkdownPath, parseMarkdown, type InlineNode, type MarkdownBlock } from "../runtime/markdown.ts";

const InlineNodes: FC<{ nodes: ReadonlyArray<InlineNode> }> = ({ nodes }) => (
  <>
    {nodes.map((node, i) => {
      switch (node.kind) {
        case "text":
          return <span key={i}>{node.text}</span>;
        case "code":
          return (
            <code key={i} className="rounded bg-neutral-100 px-1 font-mono text-[0.9em] dark:bg-neutral-900">
              {node.text}
            </code>
          );
        case "strong":
          return (
            <strong key={i} className="font-semibold">
              <InlineNodes nodes={node.children} />
            </strong>
          );
        case "em":
          return (
            <em key={i}>
              <InlineNodes nodes={node.children} />
            </em>
          );
        case "link":
          return (
            <a
              key={i}
              href={node.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 underline decoration-dotted underline-offset-2 hover:decoration-solid dark:text-sky-300"
            >
              <InlineNodes nodes={node.children} />
            </a>
          );
      }
    })}
  </>
);

const HEADING_CLASS: Record<number, string> = {
  1: "text-base font-semibold text-neutral-900 dark:text-neutral-100",
  2: "text-sm font-semibold text-neutral-900 dark:text-neutral-100",
  3: "text-sm font-semibold text-neutral-800 dark:text-neutral-200",
  4: "text-xs font-semibold text-neutral-800 dark:text-neutral-200",
  5: "text-xs font-semibold text-neutral-700 dark:text-neutral-300",
  6: "text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400",
};

const Block: FC<{ block: MarkdownBlock }> = ({ block }) => {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${block.level}` as const;
      return (
        <Tag className={HEADING_CLASS[block.level]}>
          <InlineNodes nodes={block.children} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="text-neutral-700 dark:text-neutral-300">
          <InlineNodes nodes={block.children} />
        </p>
      );
    case "list": {
      const items = block.items.map((item, i) => (
        <li key={i}>
          <InlineNodes nodes={item} />
        </li>
      ));
      return block.ordered ? (
        <ol className="list-decimal pl-5 text-neutral-700 dark:text-neutral-300">{items}</ol>
      ) : (
        <ul className="list-disc pl-5 text-neutral-700 dark:text-neutral-300">{items}</ul>
      );
    }
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md bg-neutral-100 p-2 font-mono text-[0.9em] dark:bg-neutral-900">
          <code>{block.text}</code>
        </pre>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="border-collapse text-left">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    className="border border-neutral-200 px-2 py-1 font-semibold text-neutral-800 dark:border-neutral-800 dark:text-neutral-200"
                  >
                    <InlineNodes nodes={cell} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className="border border-neutral-200 px-2 py-1 text-neutral-700 dark:border-neutral-800 dark:text-neutral-300"
                    >
                      <InlineNodes nodes={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "blockquote":
      return (
        <blockquote className="border-l-2 border-neutral-300 pl-3 text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
          <InlineNodes nodes={block.children} />
        </blockquote>
      );
  }
};

export const MarkdownContent: FC<{ markdown: string; className?: string }> = ({ markdown, className }) => (
  <div className={className ?? "flex flex-col gap-2 text-[13px] leading-relaxed"}>
    {parseMarkdown(markdown).map((block, i) => (
      <Block key={i} block={block} />
    ))}
  </div>
);

/**
 * Shared file-contents pane: markdown files render formatted with a Raw
 * toggle; everything else keeps the caller's plain <pre>. `preClassName`
 * carries each surface's existing raw styling so non-.md displays are
 * pixel-for-pixel unchanged.
 */
export const FileContentView: FC<{
  path: string;
  content: string;
  preClassName: string;
  /** Wraps the rendered (non-raw) markdown view; defaults to a bordered scroll box matching `preClassName`'s bounds. */
  renderedClassName?: string;
}> = ({ path, content, preClassName, renderedClassName }) => {
  const [showRaw, setShowRaw] = useState(false);
  const markdown = isMarkdownPath(path);

  if (!markdown) {
    return <pre className={preClassName}>{content.length > 0 ? content : "(empty)"}</pre>;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowRaw((raw) => !raw)}
          aria-pressed={showRaw}
          className="rounded-md border border-neutral-300 px-2 py-0.5 font-mono text-[10px] text-neutral-600 hover:border-neutral-500 dark:border-neutral-700 dark:text-neutral-300"
        >
          {showRaw ? "Rendered" : "Raw"}
        </button>
      </div>
      {showRaw ? (
        <pre className={preClassName}>{content.length > 0 ? content : "(empty)"}</pre>
      ) : (
        <div className={renderedClassName ?? "max-h-96 overflow-auto rounded-md border border-neutral-200 p-3 dark:border-neutral-800"}>
          {content.length > 0 ? (
            <MarkdownContent markdown={content} />
          ) : (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">(empty)</p>
          )}
        </div>
      )}
    </div>
  );
};
