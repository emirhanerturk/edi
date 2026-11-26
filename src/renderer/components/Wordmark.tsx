/** The edi wordmark, as on the icon: the name in mono with the green cursor block after it. */
export function Wordmark() {
  return (
    <span className="wordmark mono" role="img" aria-label="edi" data-testid="wordmark">
      <span aria-hidden="true">edi</span>
      <span className="wordmark-cursor" aria-hidden="true" />
    </span>
  );
}
