// mysite.example admin markdown editor (CodeMirror 6).
// Builds a global `window.RWEditor` factory. Markdown stays the source of
// truth: inline formatting (bold, italic, headings, code, quotes, highlights) is styled
// live while you type, the syntax markers fade out when the caret leaves them,
// and images stay as plain `![alt](url)` text until you open the preview.

import { Compartment, EditorState, EditorSelection, RangeSetBuilder, Prec } from "@codemirror/state";
import {
  EditorView,
  Decoration,
  ViewPlugin,
  keymap,
  drawSelection,
  placeholder as placeholderExt
} from "@codemirror/view";
import {
  syntaxTree,
  syntaxHighlighting,
  HighlightStyle,
  bracketMatching
} from "@codemirror/language";
import { history, historyKeymap, defaultKeymap, indentWithTab, selectAll, undo, redo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { tags as t } from "@lezer/highlight";
import {
  footnoteField,
  insertFootnote,
  insertFootnoteLink,
  moveToFootnoteBoundary,
  toggleFootnoteTag
} from "./footnotes.js";

// --- Live inline styling -------------------------------------------------

const highlightStyle = HighlightStyle.define([
  { tag: t.heading1, class: "cm-h cm-h1" },
  { tag: t.heading2, class: "cm-h cm-h2" },
  { tag: t.heading3, class: "cm-h cm-h3" },
  { tag: t.heading4, class: "cm-h cm-h4" },
  { tag: t.heading5, class: "cm-h cm-h5" },
  { tag: t.heading6, class: "cm-h cm-h6" },
  { tag: t.strong, class: "cm-strong" },
  { tag: t.emphasis, class: "cm-em" },
  { tag: t.strikethrough, class: "cm-strike" },
  { tag: t.monospace, class: "cm-code" },
  { tag: t.link, class: "cm-link" },
  { tag: t.url, class: "cm-url" },
  { tag: t.quote, class: "cm-quote" },
  { tag: t.list, class: "cm-list" },
  { tag: t.processingInstruction, class: "cm-mark" }
]);

// Marker nodes that get concealed once the caret is elsewhere.
const concealMarks = new Set([
  "EmphasisMark",
  "CodeMark",
  "StrikethroughMark",
  "QuoteMark"
]);

const hiddenMark = Decoration.replace({});
const highlightMark = Decoration.mark({ class: "cm-highlight" });

function selectionTouches(state, from, to) {
  for (const range of state.selection.ranges) {
    if (range.empty ? range.from > from && range.from < to : range.from < to && range.to > from) return true;
  }
  return false;
}

function buildConcealments(view) {
  const builder = new RangeSetBuilder();
  const { state } = view;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        // Heading marks: hide the leading `#`s and the following space.
        if (name === "HeaderMark") {
          const parent = node.node.parent;
          const pFrom = parent ? parent.from : node.from;
          const pTo = parent ? parent.to : node.to;
          if (selectionTouches(state, pFrom, pTo)) return;
          let end = node.to;
          if (state.doc.sliceString(end, end + 1) === " ") end += 1;
          builder.add(node.from, end, hiddenMark);
          return;
        }

        if (!concealMarks.has(name)) return;

        const parent = node.node.parent;
        const pFrom = parent ? parent.from : node.from;
        const pTo = parent ? parent.to : node.to;
        if (selectionTouches(state, pFrom, pTo)) return;
        if (node.to > node.from) builder.add(node.from, node.to, hiddenMark);
      }
    });
  }

  return builder.finish();
}

const concealPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildConcealments(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildConcealments(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations || Decoration.none)
  }
);

function buildHighlightDecorations(view) {
  const builder = new RangeSetBuilder();
  const { state } = view;

  for (const { from, to } of view.visibleRanges) {
    const text = state.doc.sliceString(from, to);
    const expression = /==([^=\n]|=[^=])+?==/g;
    let match;

    while ((match = expression.exec(text))) {
      const markFrom = from + match.index;
      const markTo = markFrom + match[0].length;
      const innerFrom = markFrom + 2;
      const innerTo = markTo - 2;
      if (innerTo <= innerFrom) continue;

      if (!selectionTouches(state, markFrom, markTo)) {
        builder.add(markFrom, innerFrom, hiddenMark);
        builder.add(innerFrom, innerTo, highlightMark);
        builder.add(innerTo, markTo, hiddenMark);
      } else {
        builder.add(innerFrom, innerTo, highlightMark);
      }
    }
  }

  return builder.finish();
}

const highlightPlugin = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildHighlightDecorations(view);
    }
    update(update) {
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
        this.decorations = buildHighlightDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations || Decoration.none)
  }
);

// --- Theme ---------------------------------------------------------------

const theme = EditorView.theme({
  "&": {
    color: "var(--text)",
    backgroundColor: "transparent",
    fontSize: "1.05rem"
  },
  ".cm-content": {
    fontFamily: "var(--font-main)",
    lineHeight: "1.72",
    padding: "0.2rem 0 4rem",
    caretColor: "var(--accent-blue)"
  },
  ".cm-scroller": {
    fontFamily: "var(--font-main)",
    overflow: "visible"
  },
  "&.cm-focused": { outline: "none" },
  ".cm-line": { padding: "0 2px 0 0" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent-blue)", borderLeftWidth: "2px" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--cm-selection, #d6e4ff)"
  },
  ".cm-placeholder": { color: "var(--quiet)", fontStyle: "normal" },
  ".cm-h": { fontWeight: "760", lineHeight: "1.25", color: "var(--heading)" },
  ".cm-h1": { fontSize: "1.9em" },
  ".cm-h2": { fontSize: "1.55em" },
  ".cm-h3": { fontSize: "1.3em" },
  ".cm-h4": { fontSize: "1.12em" },
  ".cm-h5": { fontSize: "1em", textTransform: "uppercase", letterSpacing: "0.04em" },
  ".cm-h6": { fontSize: "0.9em", textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--muted)" },
  ".cm-strong": { fontWeight: "720", color: "var(--heading)" },
  ".cm-em": { fontStyle: "italic" },
  ".cm-strike": { textDecoration: "line-through", color: "var(--muted)" },
  ".cm-highlight": {
    borderRadius: "0.18em",
    backgroundColor: "rgba(242, 205, 71, 0.42)",
    color: "var(--heading)"
  },
  ".cm-code": {
    fontFamily: "var(--font-mono)",
    fontSize: "0.9em",
    background: "var(--panel-soft)",
    borderRadius: "4px",
    padding: "0.05em 0.3em"
  },
  ".cm-link": { color: "var(--accent-blue)", textDecoration: "underline" },
  ".cm-url": { color: "var(--quiet)", fontFamily: "var(--font-mono)", fontSize: "0.88em" },
  ".cm-quote": { color: "var(--muted)", fontStyle: "italic" },
  ".cm-mark": { color: "var(--quiet)", fontWeight: "400" },
  ".cm-footnote-ref": { color: "var(--accent-blue)", fontSize: "0.72em", verticalAlign: "super" },
  ".cm-footnote-line": { color: "var(--muted)", fontSize: "0.9em" },
  ".cm-footnote-line-first": { marginTop: "2.5rem", paddingTop: "1rem", borderTop: "1px solid var(--line)" },
  ".cm-footnote-number": { color: "var(--muted)", userSelect: "none" },
  ".cm-footnote-empty": { display: "inline-block", minWidth: "0.6em", minHeight: "1em" }
});

// --- Formatting commands -------------------------------------------------

function toggleWrap(view, mark) {
  const footnoteTag = { "**": "strong", "*": "em", "`": "code", "~~": "del", "==": "mark" }[mark];
  if (footnoteTag && toggleFootnoteTag(view, footnoteTag)) return;
  const len = mark.length;
  const transaction = view.state.changeByRange((range) => {
    const before = view.state.doc.sliceString(Math.max(0, range.from - len), range.from);
    const after = view.state.doc.sliceString(range.to, range.to + len);

    if (before === mark && after === mark) {
      return {
        changes: [
          { from: range.from - len, to: range.from },
          { from: range.to, to: range.to + len }
        ],
        range: EditorSelection.range(range.from - len, range.to - len)
      };
    }

    return {
      changes: [
        { from: range.from, insert: mark },
        { from: range.to, insert: mark }
      ],
      range: EditorSelection.range(range.from + len, range.to + len)
    };
  });

  view.dispatch(transaction, { scrollIntoView: true });
  view.focus();
}

function toggleLinePrefix(view, prefix, { numbered = false } = {}) {
  const { state } = view;
  const changes = [];
  const seen = new Set();

  for (const range of state.selection.ranges) {
    const lineFrom = state.doc.lineAt(range.from).number;
    const lineTo = state.doc.lineAt(range.to).number;
    let counter = 1;

    for (let n = lineFrom; n <= lineTo; n += 1) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const wanted = numbered ? `${counter}. ` : prefix;
      counter += 1;

      const stripped = line.text.replace(/^(#{1,6}\s+|>\s?|[-*+]\s+|\d+\.\s+)/, "");
      const already = prefix && !numbered && line.text.startsWith(prefix);
      const insert = already ? stripped : `${wanted}${stripped}`;
      changes.push({ from: line.from, to: line.to, insert });
    }
  }

  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

function insertText(view, text, { block = false } = {}) {
  const { state } = view;
  const range = state.selection.main;
  const from = range.from;
  const to = range.to;
  let insert = text;

  if (block) {
    const before = from > 0 ? state.doc.sliceString(Math.max(0, from - 2), from) : "";
    const lead = from === 0 ? "" : before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
    const afterChar = state.doc.sliceString(to, to + 2);
    const trail = afterChar.startsWith("\n") ? "" : "\n\n";
    insert = `${lead}${text}${trail}`;
  }

  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: from + insert.length },
    scrollIntoView: true
  });
  view.focus();
}

function normalizeHref(value) {
  const href = String(value || "").trim();
  if (!href) return "";
  if (/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(href)) return href;
  return `https://${href}`;
}

function markdownLinkText(value) {
  return String(value || "Text")
    .replace(/\r?\n+/g, " ")
    .replace(/\]/g, "\\]")
    .trim() || "Text";
}

function insertLink(view, href, labelFallback = "Text") {
  const url = normalizeHref(href);
  if (!url) {
    view.focus();
    return false;
  }

  if (insertFootnoteLink(view, url)) return true;

  const transaction = view.state.changeByRange((range) => {
    const selected = view.state.doc.sliceString(range.from, range.to);
    const label = markdownLinkText(selected || labelFallback);
    const insert = `[${label}](${url})`;
    const labelStart = range.from + 1;
    const labelEnd = labelStart + label.length;
    const selection = selected
      ? EditorSelection.cursor(range.from + insert.length)
      : EditorSelection.range(labelStart, labelEnd);

    return {
      changes: { from: range.from, to: range.to, insert },
      range: selection
    };
  });

  view.dispatch(transaction, { scrollIntoView: true });
  view.focus();
  return true;
}

function replaceRanges(view, ranges = []) {
  const changes = ranges
    .filter((range) => Number.isFinite(range.from) && Number.isFinite(range.to) && range.from <= range.to)
    .sort((a, b) => a.from - b.from)
    .map((range) => ({ from: range.from, to: range.to, insert: String(range.insert || "") }));

  if (!changes.length) return;

  const last = changes[changes.length - 1];
  view.dispatch({
    changes,
    selection: { anchor: last.from + last.insert.length },
    scrollIntoView: true
  });
  view.focus();
}

function textAssistAttributes(lang = "de") {
  return {
    autocapitalize: "sentences",
    autocorrect: "on",
    inputmode: "text",
    lang: lang === "en" ? "en" : "de",
    spellcheck: "true"
  };
}

function sourceInputAttributes() {
  return {
    autocapitalize: "none",
    autocorrect: "off",
    inputmode: "text",
    spellcheck: "false"
  };
}

// --- Public factory ------------------------------------------------------

function create(parent, options = {}) {
  const onChange = typeof options.onChange === "function" ? options.onChange : () => {};
  const editableCompartment = new Compartment();
  const textAssistCompartment = new Compartment();
  const markupCompartment = new Compartment();

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) onChange(update.state.doc.toString());
  });

  const wrapKeymap = Prec.high(
    keymap.of([
      { key: "Mod-a", run: selectAll },
      { key: "Mod-b", run: (v) => (toggleWrap(v, "**"), true) },
      { key: "Mod-i", run: (v) => (toggleWrap(v, "*"), true) },
      { key: "Home", run: (v) => moveToFootnoteBoundary(v, false, false) },
      { key: "End", run: (v) => moveToFootnoteBoundary(v, true, false) },
      { key: "Shift-Home", run: (v) => moveToFootnoteBoundary(v, false, true) },
      { key: "Shift-End", run: (v) => moveToFootnoteBoundary(v, true, true) }
    ])
  );

  const state = EditorState.create({
    doc: options.value || "",
    extensions: [
      history(),
      drawSelection(),
      bracketMatching(),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markupCompartment.of([
        wrapKeymap,
        markdown({ base: markdownLanguage, addKeymap: true }),
        syntaxHighlighting(highlightStyle),
        concealPlugin,
        highlightPlugin,
        footnoteField
      ]),
      editableCompartment.of([
        EditorView.editable.of(true),
        EditorState.readOnly.of(false)
      ]),
      textAssistCompartment.of(EditorView.contentAttributes.of(textAssistAttributes(options.lang))),
      theme,
      placeholderExt(options.placeholder || "Schreib etwas …"),
      updateListener
    ]
  });

  const view = new EditorView({ state, parent });

  return {
    view,
    getValue: () => view.state.doc.toString(),
    getSelectedText: () => {
      const range = view.state.selection.main;
      return view.state.doc.sliceString(range.from, range.to);
    },
    setValue: (text) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text || "" },
        selection: { anchor: 0 }
      });
    },
    focus: () => view.focus(),
    insertText: (text, opts) => insertText(view, text, opts),
    insertLink: (href) => insertLink(view, href),
    insertFootnote: (text) => insertFootnote(view, text),
    replaceRanges: (ranges) => replaceRanges(view, ranges),
    toggleWrap: (mark) => toggleWrap(view, mark),
    toggleLine: (prefix, opts) => toggleLinePrefix(view, prefix, opts),
    setLanguage: (lang) => {
      view.dispatch({
        effects: textAssistCompartment.reconfigure(
          EditorView.contentAttributes.of(textAssistAttributes(lang))
        )
      });
    },
    setMode: (mode, lang = "de") => {
      const sourceMode = mode === "source";
      view.dispatch({
        effects: [
          markupCompartment.reconfigure(sourceMode ? [] : [
            wrapKeymap,
            markdown({ base: markdownLanguage, addKeymap: true }),
            syntaxHighlighting(highlightStyle),
            concealPlugin,
            highlightPlugin,
            footnoteField
          ]),
          textAssistCompartment.reconfigure(
            EditorView.contentAttributes.of(sourceMode ? sourceInputAttributes() : textAssistAttributes(lang))
          )
        ]
      });
    },
    setEditable: (editable) => {
      const canEdit = Boolean(editable);
      view.dispatch({
        effects: editableCompartment.reconfigure([
          EditorView.editable.of(canEdit),
          EditorState.readOnly.of(!canEdit)
        ])
      });
      if (!canEdit) view.contentDOM.blur();
    },
    undo: () => { undo(view); view.focus(); },
    redo: () => { redo(view); view.focus(); },
    destroy: () => view.destroy()
  };
}

window.RWEditor = { create };
