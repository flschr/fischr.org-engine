import { EditorSelection, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { footnoteTagPairs, parseFootnoteItems, selectedFootnoteItem } from "./footnote-model.js";

function selectionTouches(state, from, to) {
  return state.selection.ranges.some((range) =>
    range.empty ? range.from > from && range.from < to : range.from < to && range.to > from
  );
}

export function toggleFootnoteTag(view, tag) {
  const { state } = view;
  if (!state.selection.ranges.every((range) => selectedFootnoteItem(state, range))) return false;
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  const source = state.doc.toString();
  const transaction = state.changeByRange((selection) => {
    const item = selectedFootnoteItem(state, selection);
    let from = Math.max(selection.from, item.textFrom);
    let to = Math.min(selection.to, item.textTo);
    const enclosing = footnoteTagPairs(source, item, tag)
      .filter((pair) => pair.openFrom <= from && pair.closeTo >= to)
      .sort((a, b) => b.openFrom - a.openFrom)[0];
    if (!enclosing) {
      return {
        changes: [{ from, insert: open }, { from: to, insert: close }],
        range: EditorSelection.range(from + open.length, to + open.length)
      };
    }
    if (from <= enclosing.openTo) from = enclosing.openTo;
    if (to >= enclosing.closeFrom) to = enclosing.closeFrom;
    const before = state.doc.sliceString(enclosing.openTo, from);
    const selected = state.doc.sliceString(from, to);
    const after = state.doc.sliceString(to, enclosing.closeFrom);
    const insert = `${before ? `${open}${before}${close}` : ""}${selected}${after ? `${open}${after}${close}` : ""}`;
    const selectedFrom = enclosing.openFrom + (before ? open.length + before.length + close.length : 0);
    return {
      changes: { from: enclosing.openFrom, to: enclosing.closeTo, insert },
      range: EditorSelection.range(selectedFrom, selectedFrom + selected.length)
    };
  });
  view.dispatch(transaction, { scrollIntoView: true });
  view.focus();
  return true;
}

export function insertFootnoteLink(view, href) {
  const { state } = view;
  if (!state.selection.ranges.every((range) => selectedFootnoteItem(state, range))) return false;
  const escaped = String(href || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const transaction = state.changeByRange((selection) => {
    const item = selectedFootnoteItem(state, selection);
    const from = Math.max(selection.from, item.textFrom);
    const to = Math.min(selection.to, item.textTo);
    if (from >= to) return { range: selection };
    const open = `<a href="${escaped}">`;
    return {
      changes: [{ from, insert: open }, { from: to, insert: "</a>" }],
      range: EditorSelection.range(from + open.length, to + open.length)
    };
  });
  view.dispatch(transaction, { scrollIntoView: true });
  view.focus();
  return true;
}

export function moveToFootnoteBoundary(view, end, extend) {
  const { state } = view;
  if (!state.selection.ranges.every((range) => selectedFootnoteItem(state, range))) return false;
  const ranges = state.selection.ranges.map((range) => {
    const item = selectedFootnoteItem(state, range);
    const position = end ? item.textTo : item.textFrom;
    return extend ? EditorSelection.range(range.anchor, position) : EditorSelection.cursor(position);
  });
  view.dispatch({ selection: EditorSelection.create(ranges, state.selection.mainIndex), scrollIntoView: true });
  return true;
}

class TextWidget extends WidgetType {
  constructor(value, className = "") { super(); this.value = value; this.className = className; }
  eq(other) { return other.value === this.value && other.className === this.className; }
  toDOM() {
    const span = document.createElement(this.className === "cm-footnote-ref" ? "sup" : "span");
    span.className = this.className;
    span.textContent = this.value;
    if (this.className === "cm-footnote-ref") span.setAttribute("aria-label", `Fußnote ${this.value}`);
    if (this.className === "cm-footnote-number") span.setAttribute("aria-hidden", "true");
    return span;
  }
}

class BreakWidget extends WidgetType { toDOM() { return document.createElement("br"); } }

function decorationsFor(state) {
  const source = state.doc.toString();
  const ranges = [];
  const items = parseFootnoteItems(source);
  const hidden = Decoration.replace({});
  const classes = { strong: "cm-strong", em: "cm-em", code: "cm-code", del: "cm-strike", mark: "cm-highlight", a: "cm-link" };
  for (const item of items) {
    ranges.push({ from: item.itemFrom, to: item.textFrom, decoration: Decoration.replace({ widget: new TextWidget(`${item.number}. `, "cm-footnote-number") }), atomic: true });
    if (item.textFrom < item.textTo) ranges.push({ from: item.textFrom, to: item.textTo, decoration: Decoration.mark({ class: "cm-footnote-text" }) });
    else ranges.push({ from: item.textFrom, to: item.textFrom, decoration: Decoration.widget({ widget: new TextWidget("\u200b", "cm-footnote-text cm-footnote-empty") }) });
    ranges.push({ from: state.doc.lineAt(item.textFrom).from, to: state.doc.lineAt(item.textFrom).from, decoration: Decoration.line({ class: `cm-footnote-line${item === items[0] ? " cm-footnote-line-first" : ""}` }) });

    for (const pair of footnoteTagPairs(source, item)) {
      if (pair.closeFrom > pair.openTo) ranges.push({ from: pair.openTo, to: pair.closeFrom, decoration: Decoration.mark({ class: classes[pair.tag] }) });
      if (!selectionTouches(state, pair.openFrom, pair.closeTo)) {
        ranges.push({ from: pair.openFrom, to: pair.openTo, decoration: hidden, atomic: true });
        ranges.push({ from: pair.closeFrom, to: pair.closeTo, decoration: hidden, atomic: true });
      }
    }
    const formatted = source.slice(item.textFrom, item.textTo);
    for (const match of formatted.matchAll(/&(quot|amp|lt|gt);/gi)) {
      const values = { quot: '"', amp: "&", lt: "<", gt: ">" };
      const from = item.textFrom + match.index;
      ranges.push({ from, to: from + match[0].length, decoration: Decoration.replace({ widget: new TextWidget(values[match[1].toLowerCase()]) }), atomic: true });
    }
    for (const match of formatted.matchAll(/<br\s*\/?>/gi)) {
      const from = item.textFrom + match.index;
      if (!selectionTouches(state, from, from + match[0].length)) ranges.push({ from, to: from + match[0].length, decoration: Decoration.replace({ widget: new BreakWidget() }), atomic: true });
    }
    ranges.push({ from: item.textTo, to: item.itemTo, decoration: hidden, atomic: true });
  }
  for (const match of source.matchAll(/<section class=["']footnotes["']>|<ol>|<\/ol>|<\/section>/gi)) {
    if (items.some((item) => match.index >= item.sectionFrom && match.index < item.sectionTo)) ranges.push({ from: match.index, to: match.index + match[0].length, decoration: hidden, atomic: true });
  }
  for (const match of source.matchAll(/<sup class=["']footnote-ref["'] id=["']fnref-(\d+)["']><a href=["']#fn-\1["']>\1<\/a><\/sup>/gi)) {
    const from = match.index;
    const to = from + match[0].length;
    if (!selectionTouches(state, from, to)) ranges.push({ from, to, decoration: Decoration.replace({ widget: new TextWidget(match[1], "cm-footnote-ref") }), atomic: true });
  }
  const decorations = Decoration.set(ranges.map((range) => range.from === range.to ? range.decoration.range(range.from) : range.decoration.range(range.from, range.to)), true);
  const atomic = Decoration.set(ranges.filter((range) => range.atomic).map((range) => range.decoration.range(range.from, range.to)), true);
  return { decorations, atomic };
}

export const footnoteField = StateField.define({
  create: decorationsFor,
  update: (value, transaction) => transaction.docChanged || transaction.selection ? decorationsFor(transaction.state) : value,
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.from(field, (value) => value.atomic)
  ]
});

function escapeText(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\r?\n+/g, "<br>");
}

export function insertFootnote(view, text) {
  const doc = view.state.doc.toString();
  const range = view.state.selection.main;
  const lineStart = view.state.doc.lineAt(range.to).from;
  const trailingWhitespace = doc.slice(lineStart, range.to).match(/[^\S\r\n]+$/)?.[0] || "";
  const insertionAt = range.to - trailingWhitespace.length;
  const preservedWhitespace = range.to < doc.length ? trailingWhitespace : "";
  let number = 1;
  for (const match of doc.matchAll(/\b(?:id|href)=["']#?fn(?:ref)?-(\d+)["']/gi)) number = Math.max(number, (Number(match[1]) || 0) + 1);
  const ref = `<sup class="footnote-ref" id="fnref-${number}"><a href="#fn-${number}">${number}</a></sup>`;
  const item = `<li id="fn-${number}"><p>${escapeText(text)}<a class="footnote" href="#fnref-${number}">↗︎</a></p></li>`;
  const section = doc.match(/<section class="footnotes">\s*<ol>[\s\S]*?<\/ol>\s*<\/section>\s*$/i);
  const changes = [];
  if (section) {
    const listEnd = (section.index || 0) + section[0].search(/<\/ol>/i);
    changes.push({ from: insertionAt, to: range.to, insert: `${ref}${preservedWhitespace}` }, { from: listEnd, insert: `\n${item}` });
  } else {
    const lead = !doc.length || doc.endsWith("\n\n") ? "" : doc.endsWith("\n") ? "\n" : "\n\n";
    const block = `${lead}<section class="footnotes"><ol>\n${item}\n</ol></section>`;
    if (range.to === doc.length) changes.push({ from: insertionAt, to: range.to, insert: `${ref}${block}` });
    else changes.push({ from: insertionAt, to: range.to, insert: `${ref}${preservedWhitespace}` }, { from: doc.length, insert: block });
  }
  view.dispatch({ changes, selection: { anchor: insertionAt + ref.length }, scrollIntoView: true });
  view.focus();
}
