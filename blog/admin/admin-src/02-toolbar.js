import { els } from "./01b-elements.js";
import { insertFootnoteFromDialog, insertLinkFromDialog } from "./02b-toolbar-dialogs.js";
import { insertAdmonitionFromDialog } from "./02c-admonition-dialog.js";
import { generateMissingAltTexts } from "./16a-alt-text-actions.js";

// --- Editor toolbar (data-driven; add a button by adding an entry) -------

export const icon = (name) => window.RWIcons?.svg(name) || "";

export const ICON = {
  edit: icon("pencil-line"),
  eye: icon("eye"),
  send: icon("send"),
  unpublish: icon("eye-off")
};

export const FORMAT_COMMANDS = [
  {
    name: "bold",
    title: "Bold (⌘B)",
    icon: "bold",
    run: (ed) => ed.toggleWrap("**")
  },
  {
    name: "italic",
    title: "Italic (⌘I)",
    icon: "italic",
    run: (ed) => ed.toggleWrap("*")
  },
  {
    name: "code",
    title: "Inline code",
    icon: "code",
    run: (ed) => ed.toggleWrap("`")
  },
  {
    name: "strike",
    title: "Strikethrough",
    icon: "strikethrough",
    run: (ed) => ed.toggleWrap("~~")
  },
  {
    name: "highlight",
    title: "Highlight",
    icon: "highlighter",
    run: (ed) => ed.toggleWrap("==")
  },
  {
    name: "link",
    title: "Link (⌘K)",
    icon: "link",
    run: (ed) => insertLinkFromDialog(ed)
  },
  {
    name: "media",
    title: "Insert media",
    icon: "image",
    run: () => els.imageUploadInput.click()
  },
  {
    name: "gpx",
    title: "GPX-Tour hochladen",
    icon: "route",
    run: () => els.gpxUploadInput.click()
  },
  {
    name: "footnote",
    title: "Footnote",
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
    name: "alt-text",
    title: "Generate alt texts",
    icon: "sparkles",
    run: () => generateMissingAltTexts()
  }
];
