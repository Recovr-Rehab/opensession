import React from "react";
import { extBadge, type FileAttachment } from "../lib/images";
import {
  fileChipCard,
  fileChipCardPaddingRemovable,
  fileChipMeta,
  fileChipName,
  fileChipRow,
  fileChipSub,
  fileChipThumb,
} from "../lib/composer-classes";
import { cn } from "../ui/cn";

interface Props {
  files: FileAttachment[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}

/** Removable preview cards for non-image file attachments (staged to disk server-side). */
export function FileChips({ files, onRemove, disabled }: Props) {
  if (files.length === 0) return null;
  return (
    <div className={fileChipRow}>
      {files.map((f, i) => (
        <div
          key={i}
          className={cn(fileChipCard, fileChipCardPaddingRemovable)}
          title={f.name}
        >
          <span className={fileChipThumb}>{extBadge(f.name)}</span>
          <span className={fileChipMeta}>
            <span className={fileChipName}>{f.name}</span>
            <span className={fileChipSub}>Attachment</span>
          </span>
          <button
            type="button"
            className="absolute top-1 right-[5px] shrink-0 text-[15px] leading-none text-faint enabled:hover:text-fg disabled:cursor-default disabled:opacity-50"
            onClick={() => onRemove(i)}
            disabled={disabled}
            title="Remove file"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
