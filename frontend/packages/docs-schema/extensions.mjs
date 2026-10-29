/**
 * TipTap-Extensionliste ohne React-Anteile.
 *
 * Collaboration, CollaborationCaret und die eigenen UI-Extensions kommen im
 * Frontend dazu. Der Sidecar nutzt diese Liste nur fuer Schema und Rendering.
 */
import { StarterKit } from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Highlight } from "@tiptap/extension-highlight";
import { TextAlign } from "@tiptap/extension-text-align";
import { Link } from "@tiptap/extension-link";
import { Image } from "@tiptap/extension-image";
import {
  Table,
  TableRow,
  TableHeader,
  TableCell,
} from "@tiptap/extension-table";
import { TaskList } from "@tiptap/extension-task-list";
import { TaskItem } from "@tiptap/extension-task-item";
import { Placeholder } from "@tiptap/extension-placeholder";
import { CharacterCount } from "@tiptap/extension-character-count";
import { Typography } from "@tiptap/extension-typography";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";

export function createCoreExtensions(options = {}) {
  const { placeholder = "Schreib los …", lowlight = null } = options;

  return [
    StarterKit.configure({
      undoRedo: false,
      link: false,
      underline: false,
      ...(lowlight ? { codeBlock: false } : {}),
    }),
    ...(lowlight ? [CodeBlockLowlight.configure({ lowlight })] : []),
    Underline,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    Link.configure({ openOnClick: false, autolink: true, linkOnPaste: true }),
    Image,
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TaskList,
    TaskItem.configure({ nested: true }),
    Placeholder.configure({ placeholder }),
    CharacterCount.configure({ limit: 1_000_000 }),
    Typography,
    TextStyle,
    Color,
  ];
}
