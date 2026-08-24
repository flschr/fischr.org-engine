import { els } from "./01b-elements.js";
import { insertFootnoteFromDialog, insertLinkFromDialog } from "./02b-toolbar-dialogs.js";
import { insertAdmonitionFromDialog } from "./02c-admonition-dialog.js";

// --- Editor toolbar (data-driven; add a button by adding an entry) -------
//
// Split in two, because the writing bar now sits directly above the on-screen
// keyboard and a phone has room for about five targets there. PRIMARY holds
// what gets used in every article; MORE lives behind the "+" and costs one
// extra tap. Only *insertions* belong in either. Generating alt texts rewrites
// every image in the article and is therefore a document action, like unpublish
// and delete — it has its own button on the article bar. "Insert a footnote"
// and "rewrite all the images" must not be neighbours.

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
