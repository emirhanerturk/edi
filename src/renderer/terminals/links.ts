// Links in the terminal: Option+click opens them in the browser. A plain click is left for text selection.

/** Click handler for the links addon. */
export function linkActivator(open: (url: string) => void): (event: MouseEvent, url: string) => void {
  return (event, url) => {
    if (event.altKey) open(url);
  };
}
