import Markdown from "react-markdown";
import { markdownBlocks } from "@/lib/chat-markdown";
const components = {
  img: () => null,
  a: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
};
export function ChatMarkdown({ content }: { content: string }) {
  return markdownBlocks(content).map((block, index) =>
    "text" in block ? (
      <Markdown key={index} components={components}>
        {block.text}
      </Markdown>
    ) : (
      <div
        className="chat-table"
        key={index}
        tabIndex={0}
        role="region"
        aria-label="Data table"
      >
        <table>
          <thead>
            <tr>
              {block.headers.map((cell, i) => (
                <th scope="col" key={i}>
                  <Markdown components={components}>{cell}</Markdown>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td key={c}>
                    <Markdown components={components}>{cell}</Markdown>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  );
}
