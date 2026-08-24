import { els } from "./01b-elements.js";
import { insertFootnoteFromDialog, insertLinkFromDialog } from "./02b-toolbar-dialogs.js";
import { insertAdmonitionFromDialog } from "./02c-admonition-dialog.js";
import { generateMissingAltTexts } from "./16a-alt-text-actions.js";

// --- Editor toolbar (data-driven; add a button by adding an entry) -------
//
// Split in two, because the writing bar now sits directly above the on-screen
// keyboard and a phone has room for about five targets there. PRIMARY holds
// what gets used in every article; MORE lives behind the "+" and costs one
// extra tap.
//
// Alt-text sits right after "media" on purpose: in practice it gets used
// immediately after inserting an image, not as a separate document-level
// pass — an earlier version filed it as a document action next to unpublish
// and delete, which was a tidier taxonomy but put it a screen away from
// where it is actually reached for.

export const icon = (name) => window.RWIcons?.svg(name) || "";

export const ICON = {
  edit: icon("pencil-line"),
  eye: icon("eye"),
  send: icon("send")
};

export const PRIMARY_COMMANDS = [
  {
    name: "bold",
    title: "Fett (⌘B)",
    icon: "bold",
    run: (ed) => ed.toggleWrap("**")
  },
  {
    name: "italic",
    title: "Kursiv (⌘I)",
    icon: "italic",
    run: (ed) => ed.toggleWrap("*")
  },
  {
    name: "link",
    title: "Link (⌘K)",
    icon: "link",
    run: (ed) => insertLinkFromDialog(ed)
  },
  {
    name: "media",
    title: "Bild oder Video einfügen",
    icon: "image",
    run: () => els.imageUploadInput.click()
  },
  {
    name: "alt-text",
    title: "Alt-Texte erzeugen",
    icon: "sparkles",
    run: () => generateMissingAltTexts()
  }
];

export const MORE_COMMANDS = [
  {
    name: "code",
    title: "Code",
    icon: "code",
    run: (ed) => ed.toggleWrap("`")
  },
  {
    name: "strike",
    title: "Durchgestrichen",
    icon: "strikethrough",
    run: (ed) => ed.toggleWrap("~~")
  },
  {
    name: "highlight",
    title: "Markieren",
    icon: "highlighter",
    run: (ed) => ed.toggleWrap("==")
  },
  {
    name: "footnote",
    title: "Fußnote",
    icon: "superscript",
    run: (ed) => insertFootnoteFromDialog(ed)
  },
  {
    name: "admonition",
    title: "Hinweis einfügen",
    icon: "circle-alert",
    run: (ed) => insertAdmonitionFromDialog(ed)
  },
  {
    name: "gpx",
    title: "GPX-Tour hochladen",
    icon: "route",
    run: () => els.gpxUploadInput.click()
  }
];
