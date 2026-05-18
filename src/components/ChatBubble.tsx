import { ReactNode } from "react";
import { renderInlineText } from "../utils";

export function FormattedMessageText({ text, compact = false }: { text: string; compact?: boolean }) {
    const codeFencePattern = /```(\w+)?\n?([\s\S]*?)```/g;
    const blocks: Array<{ type: "text" | "code"; value: string; language?: string }> = [];
    let lastIndex = 0;
    for (const match of text.matchAll(codeFencePattern)) {
    if (match.index > lastIndex) {
      blocks.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    blocks.push({ type: "code", language: match[1], value: match[2].trim() });
    lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
    blocks.push({ type: "text", value: text.slice(lastIndex) });
    }

    const renderTextBlock = (value: string, blockIndex: number) => {
            const lines = value.replace(/\r\n/g, "\n").split("\n");
            const elements: ReactNode[] = [];
            let paragraph: string[] = [];
            let listItems: string[] = [];
            let listType: "ul" | "ol" | null = null;
            let tableRows: string[][] = [];

            const isTableDividerLine = (candidate: string) =>
              /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(candidate);

            const isTableRowLine = (candidate: string) => {
              const pipeCount = (candidate.match(/\|/g) ?? []).length;
              return pipeCount >= 2 || (pipeCount >= 1 && (candidate.startsWith("|") || candidate.endsWith("|")));
            };

            const parseTableCells = (candidate: string) =>
              candidate
                .replace(/^\|/, "")
                .replace(/\|$/, "")
                .split("|")
                .map((cell) => cell.trim());

            const flushParagraph = () => {
              const content = paragraph.join(" ").trim();
              paragraph = [];
              if (!content) return;
              const heading = content.match(/^(#{1,3})\s+(.+)$/);
              if (heading) {
                elements.push(
                  <div key={`h-${blockIndex}-${elements.length}`} className="mt-2 text-sm font-bold text-[#f1f3f4] first:mt-0">
                    {renderInlineText(heading[2], `h-${blockIndex}-${elements.length}`)}
                  </div>,
                );
                return;
              }
              elements.push(
                <p key={`p-${blockIndex}-${elements.length}`} className={`${compact ? "leading-6" : "leading-7"} text-sm break-words`}>
                  {renderInlineText(content, `p-${blockIndex}-${elements.length}`)}
                </p>,
              );
            };

            const flushList = () => {
              if (!listItems.length || !listType) return;
              const Tag = listType;
              elements.push(
                <Tag key={`list-${blockIndex}-${elements.length}`} className={`my-2 space-y-1 ${listType === "ol" ? "list-decimal" : "list-disc"} pl-5 text-sm leading-7 break-words`}>
                  {listItems.map((item, index) => (
                    <li key={`li-${blockIndex}-${elements.length}-${index}`}>
                      {renderInlineText(item, `li-${blockIndex}-${elements.length}-${index}`)}
                    </li>
                  ))}
                </Tag>,
              );
              listItems = [];
              listType = null;
            };

            const flushTable = () => {
              if (!tableRows.length) return;
              const [headerRow, ...bodyRows] = tableRows;
              const columnCount = Math.max(...tableRows.map((row) => row.length));
              const headers = Array.from({ length: columnCount }, (_, index) => headerRow[index] ?? "");
              elements.push(
                <div key={`table-${blockIndex}-${elements.length}`} className="my-3 overflow-x-auto rounded-2xl ring-1 ring-[#282a2c]">
                  <table className="min-w-full table-auto border-collapse text-left text-xs leading-6">
                    <thead className="bg-[#282a2c]/70 text-[#f1f3f4]">
                      <tr>
                        {headers.map((cell, index) => (
                          <th key={`th-${blockIndex}-${elements.length}-${index}`} className="max-w-64 break-words px-3 py-2 font-semibold">
                            {renderInlineText(cell, `th-${blockIndex}-${elements.length}-${index}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="text-[#e3e3e3]">
                      {bodyRows.map((row, rowIndex) => (
                        <tr key={`tr-${blockIndex}-${elements.length}-${rowIndex}`} className="border-t border-[#282a2c]">
                          {headers.map((_, cellIndex) => (
                            <td key={`td-${blockIndex}-${elements.length}-${rowIndex}-${cellIndex}`} className="min-w-24 max-w-72 break-words px-3 py-2 align-top">
                              {renderInlineText(row[cellIndex] ?? "", `td-${blockIndex}-${elements.length}-${rowIndex}-${cellIndex}`)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>,
              );
              tableRows = [];
            };

            lines.forEach((line) => {
              const trimmed = line.trim();
              if (!trimmed) {
                flushParagraph();
                flushList();
                flushTable();
                return;
              }

              if (isTableDividerLine(trimmed)) {
                return;
              }

              if (isTableRowLine(trimmed)) {
                flushParagraph();
                flushList();
                tableRows.push(parseTableCells(trimmed));
                return;
              }

              flushTable();

              const directMedia = trimmed.match(/^(https?:\/\/[^\s)]+|file:[^\s)]+)\.(png|jpe?g|gif|webp|mp4|webm|ogg|mp3|wav)(\?[^\s)]*)?$/i);
              if (directMedia) {
                flushParagraph();
                flushList();
                const mediaUrl = directMedia[0];
                const extension = directMedia[2].toLowerCase();
                if (["mp4", "webm", "ogg"].includes(extension)) {
                  elements.push(
                    <video key={`video-${blockIndex}-${elements.length}`} src={mediaUrl} controls className="my-3 max-h-[420px] w-full rounded-3xl bg-[#131314] ring-1 ring-[#282a2c]" />,
                  );
                } else if (["mp3", "wav"].includes(extension)) {
                  elements.push(
                    <audio key={`audio-${blockIndex}-${elements.length}`} src={mediaUrl} controls className="my-3 w-full" />,
                  );
                } else {
                  elements.push(
                    <img key={`image-url-${blockIndex}-${elements.length}`} src={mediaUrl} alt="Chat visual" className="my-3 max-h-[420px] w-full rounded-3xl bg-[#131314] object-contain ring-1 ring-[#282a2c]" />,
                  );
                }
                return;
              }

              const markdownImage = trimmed.match(/^!\[([^\]]*)\]\((https?:\/\/[^\s)]+|data:image\/[^)]+|blob:[^)]+|file:[^)]+)\)$/i);
              if (markdownImage) {
                flushParagraph();
                flushList();
                elements.push(
                  <figure key={`md-image-${blockIndex}-${elements.length}`} className="my-3">
                    <img
                      src={markdownImage[2]}
                      alt={markdownImage[1] || "Chat image"}
                      className="max-h-[420px] w-full rounded-3xl bg-[#131314] object-contain ring-1 ring-[#282a2c]"
                    />
                    {markdownImage[1] && (
                      <figcaption className="mt-2 text-xs leading-5 text-[#c4c7c5]">
                        {markdownImage[1]}
                      </figcaption>
                    )}
                  </figure>,
                );
                return;
              }

              const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
              const bullet = trimmed.match(/^[-*]\s+(.+)$/);
              if (numbered || bullet) {
                flushParagraph();
                const nextType = numbered ? "ol" : "ul";
                if (listType && listType !== nextType) flushList();
                listType = nextType;
                listItems.push((numbered?.[2] ?? bullet?.[1] ?? "").trim());
                return;
              }

              if (trimmed.startsWith(">")) {
                flushParagraph();
                flushList();
                elements.push(
                  <blockquote key={`quote-${blockIndex}-${elements.length}`} className="my-2 border-l-2 border-[var(--accent-soft-strong)] pl-3 text-sm italic leading-7 text-[#c4c7c5]">
                    {renderInlineText(trimmed.replace(/^>\s?/, ""), `quote-${blockIndex}-${elements.length}`)}
                  </blockquote>,
                );
                return;
              }

              paragraph.push(trimmed);
            });

            flushParagraph();
            flushList();
            flushTable();
            return elements;
          };
    return (
    <div className={`chat-content min-w-0 space-y-3 ${compact ? "text-[#e3e3e3]" : "text-[#f1f3f4]"}`}>
      {blocks.map((block, blockIndex) =>
        block.type === "code" ? (
          <pre key={`code-${blockIndex}`} className="max-w-full overflow-x-auto rounded-2xl bg-[#0f1011] p-3 text-xs leading-6 text-[#dfe3ea] ring-1 ring-[#282a2c]">
            <code>{block.value}</code>
          </pre>
        ) : (
          <div key={`text-${blockIndex}`} className="space-y-3">
            {renderTextBlock(block.value, blockIndex)}
          </div>
        ),
      )}
    </div>
    );
}
