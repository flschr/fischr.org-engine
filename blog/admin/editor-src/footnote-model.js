export function parseFootnoteItems(source) {
  const items = [];
  const sections = /<section class=["']footnotes["']>\s*<ol>([\s\S]*?)<\/ol>\s*<\/section>/gi;
  let section;
  while ((section = sections.exec(source))) {
    const sectionFrom = section.index;
    const sectionTo = sectionFrom + section[0].length;
    const bodyOffset = section[0].indexOf(section[1]);
    const entries = /<li id=["']fn-(\d+)["']>\s*<p>([\s\S]*?)<a class=["']footnote["'] href=["']#fnref-\1["']>[^<]*<\/a>\s*<\/p>\s*<\/li>/gi;
    let entry;
    while ((entry = entries.exec(section[1]))) {
      const itemFrom = sectionFrom + bodyOffset + entry.index;
      const paragraph = /<p>/i.exec(entry[0]);
      const textFrom = itemFrom + paragraph.index + paragraph[0].length;
      items.push({
        number: entry[1], sectionFrom, sectionTo, itemFrom,
        itemTo: itemFrom + entry[0].length,
        textFrom, textTo: textFrom + entry[2].length
      });
    }
  }
  return items;
}

export function selectedFootnoteItem(state, range = state.selection.main) {
  return parseFootnoteItems(state.doc.toString()).find((item) => {
    if (range.empty) return range.from >= item.textFrom && range.from <= item.textTo;
    return range.to > item.textFrom && range.from < item.textTo;
  }) || null;
}

export function footnoteTagPairs(source, item, wanted = "") {
  const pairs = [];
  const stack = [];
  const tags = /<(\/)?(strong|em|code|del|mark)\s*>|<a\s+href=["'][^"']*["']\s*>|<\/a\s*>/gi;
  const text = source.slice(item.textFrom, item.textTo);
  let match;
  while ((match = tags.exec(text))) {
    const from = item.textFrom + match.index;
    const to = from + match[0].length;
    const closing = Boolean(match[1]) || /^<\/a/i.test(match[0]);
    const tag = (match[2] || "a").toLowerCase();
    if (!closing) {
      stack.push({ tag, openFrom: from, openTo: to });
      continue;
    }
    const index = stack.map((entry) => entry.tag).lastIndexOf(tag);
    if (index < 0) continue;
    const opening = stack[index];
    stack.splice(index, 1);
    if (!wanted || tag === wanted) pairs.push({ ...opening, closeFrom: from, closeTo: to });
  }
  return pairs;
}
