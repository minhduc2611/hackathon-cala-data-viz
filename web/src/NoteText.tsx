// A note's text with its section labels (STORY:, WHO BENEFITS FROM THIS:, WHAT IT MEANS:, TRUST:) in bold.
const LABEL = /^(STORY|WHO BENEFITS FROM THIS|WHAT IT MEANS|TRUST):/;

export function NoteText({ text }: { text: string }) {
  return (
    <p className="story">
      {text.split("\n").map((line, i) => {
        const m = LABEL.exec(line);
        return (
          <span key={i}>
            {i > 0 && "\n"}
            {m ? <><strong className="note-label">{m[0]}</strong>{line.slice(m[0].length)}</> : line}
          </span>
        );
      })}
    </p>
  );
}
