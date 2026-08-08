import React from "react";
import { openLightbox } from "./MediaLightbox";

interface Props {
  /** Attached images as `data:` URLs. */
  images: string[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}

/** Removable thumbnail row for pasted/dropped image attachments. */
export function ImageThumbs({ images, onRemove, disabled }: Props) {
  if (images.length === 0) return null;
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
              className="h-14 w-auto max-w-[120px] rounded-control border border-line-strong object-cover"
            />
          </button>
          <button
            type="button"
            className="absolute -top-1.5 -right-1.5 flex size-[18px] items-center justify-center rounded-full bg-fg text-label leading-none text-panel"
            onClick={() => onRemove(i)}
            disabled={disabled}
            title="Remove image"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
