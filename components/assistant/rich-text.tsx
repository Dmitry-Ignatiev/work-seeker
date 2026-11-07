import { Fragment } from 'react';

/**
 * Tiny, safe renderer for the assistant's replies: paragraphs, "- " bullets and **bold**.
 * No HTML is interpreted. Direction is detected per block, so Hebrew and English both read right.
 */
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((piece, i) =>
    piece.startsWith('**') && piece.endsWith('**') ? <strong key={i}>{piece.slice(2, -2)}</strong> : <Fragment key={i}>{piece}</Fragment>,
  );
}

export function RichText({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="flex flex-col gap-2 leading-relaxed">
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        if (lines.every(line => /^\s*[-*•]\s+/.test(line))) {
          return (
            <ul key={i} dir="auto" className="list-disc ps-5">
              {lines.map((line, j) => (
                <li key={j}>{inline(line.replace(/^\s*[-*•]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} dir="auto" className="whitespace-pre-wrap">
            {inline(block.replace(/^#+\s*/gm, ''))}
          </p>
        );
      })}
    </div>
  );
}
