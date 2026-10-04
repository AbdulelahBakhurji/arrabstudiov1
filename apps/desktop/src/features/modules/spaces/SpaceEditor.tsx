import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useEffect, useRef, type ReactNode } from "react";
import {
  Bold,
  Code2,
  Eraser,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  Redo2,
  Strikethrough,
  Undo2,
} from "lucide-react";

function markdownToHtml(md: string): string {
  const escaped = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const blocks = escaped.split(/\n{2,}/);
  return blocks
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((line) => /^[-*] \[ \] /.test(line) || /^[-*] \[x\] /i.test(line))) {
        return `<ul data-type="taskList">${lines
          .map((line) => {
            const checked = /^[-*] \[x\] /i.test(line);
            const text = line.replace(/^[-*] \[[ xX]\] /, "");
            return `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? " checked" : ""}><span></span></label><div><p>${text}</p></div></li>`;
          })
          .join("")}</ul>`;
      }
      if (lines.every((line) => /^[-*] /.test(line))) {
        return `<ul>${lines.map((line) => `<li><p>${line.replace(/^[-*] /, "")}</p></li>`).join("")}</ul>`;
      }
      if (lines.every((line) => /^\d+\. /.test(line))) {
        return `<ol>${lines.map((line) => `<li><p>${line.replace(/^\d+\. /, "")}</p></li>`).join("")}</ol>`;
      }
      if (lines.every((line) => /^> /.test(line))) {
        return `<blockquote>${lines.map((line) => `<p>${line.replace(/^> /, "")}</p>`).join("")}</blockquote>`;
      }
      if (lines[0] === "---" || lines[0] === "***") return "<hr>";
      if (lines[0]?.startsWith("### ")) {
        return `<h3>${lines[0].slice(4)}</h3>${lines.slice(1).map((l) => `<p>${l}</p>`).join("")}`;
      }
      if (lines[0]?.startsWith("## ")) {
        return `<h2>${lines[0].slice(3)}</h2>${lines.slice(1).map((l) => `<p>${l}</p>`).join("")}`;
      }
      if (lines[0]?.startsWith("# ")) {
        return `<h1>${lines[0].slice(2)}</h1>${lines.slice(1).map((l) => `<p>${l}</p>`).join("")}`;
      }
      return `<p>${lines.join("<br>")}</p>`;
    })
    .join("");
}

function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const walk = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof HTMLElement)) return "";
    const kids = Array.from(node.childNodes).map(walk).join("");
    switch (node.tagName.toLowerCase()) {
      case "h1":
        return `# ${kids}\n\n`;
      case "h2":
        return `## ${kids}\n\n`;
      case "h3":
        return `### ${kids}\n\n`;
      case "p":
        return `${kids}\n\n`;
      case "br":
        return "\n";
      case "strong":
      case "b":
        return `**${kids}**`;
      case "em":
      case "i":
        return `*${kids}*`;
      case "s":
      case "strike":
      case "del":
        return `~~${kids}~~`;
      case "code":
        return `\`${kids}\``;
      case "blockquote":
        return (
          kids
            .split("\n")
            .filter(Boolean)
            .map((line) => `> ${line}`)
            .join("\n") + "\n\n"
        );
      case "hr":
        return "---\n\n";
      case "li": {
        const parent = node.parentElement;
        if (parent?.getAttribute("data-type") === "taskList") {
          const checked = node.getAttribute("data-checked") === "true";
          return `- [${checked ? "x" : " "}] ${kids.trim()}\n`;
        }
        if (parent?.tagName.toLowerCase() === "ol") {
          const index = Array.from(parent.children).indexOf(node) + 1;
          return `${index}. ${kids.trim()}\n`;
        }
        return `- ${kids.trim()}\n`;
      }
      case "ul":
      case "ol":
      case "div":
      case "body":
      case "label":
      case "span":
        return kids;
      default:
        return kids;
    }
  };
  return walk(doc.body).replace(/\n{3,}/g, "\n\n").trim();
}

function ToolBtn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={active ? "is-on" : undefined}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      title={label}
    >
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sp-ribbon-group">
      <span className="sp-ribbon-label">{label}</span>
      <div className="sp-ribbon-row">{children}</div>
    </div>
  );
}

export function SpaceEditor({
  markdown,
  placeholder,
  sourceMode,
  onChange,
  onStats,
}: {
  markdown: string;
  placeholder: string;
  sourceMode: boolean;
  onChange: (markdown: string) => void;
  onStats?: (stats: { words: number; chars: number }) => void;
}) {
  const skipEmit = useRef(false);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: markdownToHtml(markdown || ""),
    onUpdate: ({ editor: ed }) => {
      if (skipEmit.current) return;
      onChange(htmlToMarkdown(ed.getHTML()));
      const text = ed.getText();
      onStats?.({
        words: text.trim() ? text.trim().split(/\s+/).length : 0,
        chars: text.length,
      });
    },
  });

  useEffect(() => {
    if (!editor || sourceMode) return;
    try {
      const current = htmlToMarkdown(editor.getHTML());
      if (current === markdown.trim()) return;
      skipEmit.current = true;
      editor.commands.setContent(markdownToHtml(markdown || ""), { emitUpdate: false });
      skipEmit.current = false;
      const text = editor.getText();
      onStats?.({
        words: text.trim() ? text.trim().split(/\s+/).length : 0,
        chars: text.length,
      });
    } catch {
      skipEmit.current = false;
    }
  }, [markdown, editor, sourceMode, onStats]);

  if (sourceMode) {
    return (
      <div className="sp-editor">
        <textarea
          className="sp-source"
          value={markdown}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck
        />
      </div>
    );
  }

  return (
    <div className="sp-editor">
      <div className="sp-ribbon" role="toolbar" aria-label="Document tools">
        <Group label="Edit">
          <ToolBtn label="Undo" disabled={!editor?.can().undo()} onClick={() => editor?.chain().focus().undo().run()}>
            <Undo2 size={15} />
          </ToolBtn>
          <ToolBtn label="Redo" disabled={!editor?.can().redo()} onClick={() => editor?.chain().focus().redo().run()}>
            <Redo2 size={15} />
          </ToolBtn>
          <ToolBtn label="Clear" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()}>
            <Eraser size={15} />
          </ToolBtn>
        </Group>
        <span className="sp-ribbon-sep" aria-hidden />
        <Group label="Font">
          <ToolBtn label="Bold" active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>
            <Bold size={15} />
          </ToolBtn>
          <ToolBtn label="Italic" active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>
            <Italic size={15} />
          </ToolBtn>
          <ToolBtn label="Strike" active={editor?.isActive("strike")} onClick={() => editor?.chain().focus().toggleStrike().run()}>
            <Strikethrough size={15} />
          </ToolBtn>
          <ToolBtn label="Code" active={editor?.isActive("code")} onClick={() => editor?.chain().focus().toggleCode().run()}>
            <Code2 size={15} />
          </ToolBtn>
        </Group>
        <span className="sp-ribbon-sep" aria-hidden />
        <Group label="Styles">
          <ToolBtn label="Heading 1" active={editor?.isActive("heading", { level: 1 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 size={15} />
          </ToolBtn>
          <ToolBtn label="Heading 2" active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 size={15} />
          </ToolBtn>
          <ToolBtn label="Heading 3" active={editor?.isActive("heading", { level: 3 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 size={15} />
          </ToolBtn>
          <ToolBtn label="Quote" active={editor?.isActive("blockquote")} onClick={() => editor?.chain().focus().toggleBlockquote().run()}>
            <Quote size={15} />
          </ToolBtn>
        </Group>
        <span className="sp-ribbon-sep" aria-hidden />
        <Group label="Paragraph">
          <ToolBtn label="Bullets" active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>
            <List size={15} />
          </ToolBtn>
          <ToolBtn label="Numbered" active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={15} />
          </ToolBtn>
          <ToolBtn label="Checklist" active={editor?.isActive("taskList")} onClick={() => editor?.chain().focus().toggleTaskList().run()}>
            <ListTodo size={15} />
          </ToolBtn>
          <ToolBtn label="Divider" onClick={() => editor?.chain().focus().setHorizontalRule().run()}>
            <Minus size={15} />
          </ToolBtn>
        </Group>
      </div>

      <div className="sp-page-stage">
        <article className="sp-page">
          <EditorContent editor={editor} className="sp-page-body" />
        </article>
      </div>
    </div>
  );
}
