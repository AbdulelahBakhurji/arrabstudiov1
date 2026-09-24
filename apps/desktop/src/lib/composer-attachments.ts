/** Turn uploaded files into draft text blocks for chat composers. */

import { pushToast } from "@/lib/notify";

export type AttachResult = {
  parts: string[];
  attachedNames: string[];
  skippedNames: string[];
};

function isArabicUi(): boolean {
  return typeof document !== "undefined" && document.documentElement.lang === "ar";
}

/** In-app toast when files/images are added to a composer. */
export function notifyUploadAttached(input: {
  attachedNames: string[];
  skippedNames?: string[];
}): void {
  const ar = isArabicUi();
  const attached = input.attachedNames;
  const skipped = input.skippedNames ?? [];

  if (attached.length > 0) {
    const shown = attached.slice(0, 3).join(", ");
    const extra = attached.length > 3 ? ` +${attached.length - 3}` : "";
    pushToast({
      title:
        attached.length === 1
          ? ar
            ? "تم إرفاق الملف"
            : "File attached"
          : ar
            ? `تم إرفاق ${attached.length} ملفات`
            : `${attached.length} files attached`,
      body: `${shown}${extra}`,
      tone: "success",
    });
  }

  if (skipped.length > 0) {
    pushToast({
      title: ar ? "تعذّر إرفاق بعض الملفات" : "Some files were skipped",
      body: skipped.join(", "),
      tone: "warn",
    });
  }
}

export async function filesToDraftParts(fileList: FileList | null): Promise<string[]> {
  const result = await attachFilesToDraft(fileList);
  return result.parts;
}

/** Same as filesToDraftParts, plus optional toast (on by default). */
export async function attachFilesToDraft(
  fileList: FileList | null,
  options?: { notify?: boolean },
): Promise<AttachResult> {
  if (!fileList?.length) {
    return { parts: [], attachedNames: [], skippedNames: [] };
  }

  const parts: string[] = [];
  const attachedNames: string[] = [];
  const skippedNames: string[] = [];

  for (const file of Array.from(fileList).slice(0, 8)) {
    if (file.size > 1_200_000) {
      parts.push(`[Attached: ${file.name} — skipped, too large (>1.2MB)]`);
      skippedNames.push(file.name);
      continue;
    }
    const isText =
      file.type.startsWith("text/") ||
      /\.(md|txt|json|csv|ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|swift|css|html|xml|yml|yaml|toml|sh|sql|log)$/i.test(
        file.name,
      );
    if (isText) {
      try {
        const text = await file.text();
        parts.push(`[Attached file: ${file.name}]\n${text.slice(0, 24_000)}`);
        attachedNames.push(file.name);
      } catch {
        parts.push(`[Attached file: ${file.name} — could not read]`);
        skippedNames.push(file.name);
      }
    } else if (file.type.startsWith("image/")) {
      try {
        if (file.size <= 400_000) {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
          });
          parts.push(
            `[Attached image: ${file.name} (${file.type}, ${Math.round(file.size / 1024)}KB)]\n${dataUrl}`,
          );
        } else {
          parts.push(
            `[Attached image: ${file.name} (${file.type}, ${Math.round(file.size / 1024)}KB). Too large to inline — describe from filename/context or ask me to save it to the desk and use read_document.]`,
          );
        }
        attachedNames.push(file.name);
      } catch {
        parts.push(`[Attached image: ${file.name} — could not read]`);
        skippedNames.push(file.name);
      }
    } else if (/\.(pdf|docx?|pptx?)$/i.test(file.name)) {
      parts.push(
        `[Attached document: ${file.name} (${file.type || "binary"}, ${Math.round(file.size / 1024)}KB). Ask me to save it on the Arrab desk and call read_document, or summarize from the filename if that is enough.]`,
      );
      attachedNames.push(file.name);
    } else {
      parts.push(
        `[Attached file: ${file.name} (${file.type || "binary"}, ${Math.round(file.size / 1024)}KB)]`,
      );
      attachedNames.push(file.name);
    }
  }

  if (options?.notify !== false) {
    notifyUploadAttached({ attachedNames, skippedNames });
  }

  return { parts, attachedNames, skippedNames };
}
