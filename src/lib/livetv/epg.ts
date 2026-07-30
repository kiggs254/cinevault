/**
 * Merge many XMLTV EPG documents into one `<tv>` document for Jellyfin's guide.
 * A passthrough concat (regex, not a full DOM parse) keeps it light on the
 * RAM-tight host: `<channel>` blocks are de-duplicated by id, `<programme>`
 * blocks are all carried over. Programmes reference channels by id, so as long
 * as each source is internally consistent the merged guide lines up.
 */
export function mergeEpg(sources: string[]): string {
  const channels = new Map<string, string>(); // channel id -> block (first wins)
  const programmes: string[] = [];
  const channelRe = /<channel\b[^>]*\bid="([^"]*)"[\s\S]*?<\/channel>/gi;
  const progRe = /<programme\b[\s\S]*?<\/programme>/gi;

  for (const raw of sources) {
    if (!raw) continue;
    let m: RegExpExecArray | null;
    channelRe.lastIndex = 0;
    while ((m = channelRe.exec(raw)) !== null) {
      if (!channels.has(m[1])) channels.set(m[1], m[0]);
    }
    progRe.lastIndex = 0;
    while ((m = progRe.exec(raw)) !== null) programmes.push(m[0]);
  }

  const body = [...channels.values(), ...programmes].join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<tv generator-info-name="Cinevault">\n${body}\n</tv>\n`;
}
