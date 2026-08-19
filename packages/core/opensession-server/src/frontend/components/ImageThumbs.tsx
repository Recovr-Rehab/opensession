import React, { useState } from "react";
import { ImageMarkup } from "./ImageMarkup";
import { openLightbox } from "./MediaLightbox";
import { IconPencil, IconX } from "./icons";

interface Props {
  /** Attached images as `data:` URLs. */
  images: string[];
  onRemove: (index: number) => void;
  /**
   * Swap one attachment for an annotated copy of itself, and take the notes
   * written on its regions so the surface can fold them into the message being
   * composed. Wire this and each thumbnail gets a markup button; leave it off
   * and the tiles stay read-only (a surface that cannot upload has nowhere to
   * put the new picture).
   */
  onReplace?: (index: number, ref: string, notes: string[]) => void;
  disabled?: boolean;
  /**
   * Images still on their way to disk. A paste is not attached until its
   * upload lands, which during a slow load is seconds of a composer that looks
   * like it ignored you — so each one stands here as a ghost tile until its
   * picture replaces it.
   */
  pending?: number;
}

/** Removable thumbnail row for pasted/dropped image attachments. */
export function ImageThumbs({
  images,
  onRemove,
  onReplace,
  disabled,
  pending = 0,
}: Props) {
  // Which tile is open in the markup editor. An index rather than a ref: the
  // editor hands back a NEW ref, and the row it belongs to is what we need.
  const [editing, setEditing] = useState<number | null>(null);
  if (images.length === 0 && pending < 1) return null;
  const editingSrc = editing === null ? undefined : images[editing];
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {images.map((src, i) => (
        <div key={i} className="relative leading-[0]">
          <button
            type="button"
            // The radius is only visible through the focus ring, which has to
            // follow the thumbnail's corner rather than cut across it.
            className="focus-ring block cursor-zoom-in rounded-control leading-[0]"
            onClick={(event) =>
              openLightbox(
                images.map((image) => ({ kind: "image", src: image })),
                i,
                event.currentTarget,
              )
            }
            aria-label="Open image preview"
          >
            <img
              src={src}
              alt=""
              className="h-14 w-auto max-w-[120px] rounded-control border border-line/60 object-cover"
            />
          </button>
          <button
            type="button"
            className="absolute -top-1.5 -right-1.5 flex size-[18px] items-center justify-center rounded-full bg-fg p-0 text-panel"
            onClick={() => onRemove(i)}
            disabled={disabled}
            title="Remove image"
          >
            <IconX className="block" size={12} dense />
          </button>
          {/* The markup affordance sits on the tile rather than behind a
              hover, because half the people who need it are on a phone and a
              hover is not a thing there. It shares the corner language of the
              remove button so the pair reads as one control set: same size,
              same chip, opposite corner. */}
          {onReplace && (
            <button
              type="button"
              className="absolute -bottom-1.5 -right-1.5 flex size-[18px] items-center justify-center rounded-full bg-fg p-0 text-panel"
              onClick={() => setEditing(i)}
              disabled={disabled}
              title="Draw on image"
              aria-label="Draw on image"
            >
              <IconPencil className="block" size={12} dense />
            </button>
          )}
        </div>
      ))}
      {/* The shape the picture will take, in the place it will take it: the
          app's skeleton language (a bordered block that breathes) rather than
          a spinner, which in this product means an agent is working. 100px is
          a 16:9 screenshot at this height, so the common paste barely moves
          when the real thumbnail lands. */}
      {Array.from({ length: pending }, (_, i) => (
        <div
          key={`staging-${i}`}
          className="h-14 w-[100px] animate-pulse rounded-control border border-line-strong bg-hover"
        />
      ))}
      {editingSrc && editing !== null && (
        <ImageMarkup
          src={editingSrc}
          onSave={(ref, notes) => onReplace?.(editing, ref, notes)}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
