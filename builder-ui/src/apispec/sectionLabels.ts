/**
 * Apicurio writes its section headings in capitals (INFO, TAG DEFINITIONS, PATH PARAMETERS…).
 * ECHO shows them in title case (Info, Tag Definitions, Path Parameters) on every page, by
 * rewriting the heading's own text as Apicurio draws it. Returns a cleanup function.
 */
export function titleCaseSectionLabels(doc: Document) {
  const apply = () => {
    for (const label of doc.querySelectorAll('.section .section-label')) {
      for (const node of label.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent) continue;
        const text = node.textContent;
        if (/[A-Z]{2}/.test(text) && text === text.toUpperCase()) node.textContent = titleCase(text);
      }
    }
  };
  apply();
  // The frame's own MutationObserver: its nodes belong to the frame's window.
  const observer = new (doc.defaultView?.MutationObserver ?? MutationObserver)(apply);
  observer.observe(doc, { childList: true, subtree: true, characterData: true });
  return () => observer.disconnect();
}

export function titleCase(text: string) {
  return text.toLowerCase().replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}
