import React from "react";
import { BRANDS, brandLogo } from "../brand-logos";
import { markTileClass, markTileShadow } from "../lib/mark-tile";

/** Rounded brand square with the service's real logo (falls back to the first
 * letter on a neutral tile). Shared by the Connections page and the
 * connected-services picker so both read the same.
 *
 * Shape, corner and lift come from lib/mark-tile, which the house glyph plates
 * in the library also draw. A grid mixing the two has to read as one family,
 * and it did not while each side rounded and lit itself. */
export function IconTile({ name, size = 34 }: { name: string; size?: number }) {
  const key = name.toLowerCase();
  const brand = BRANDS[key];
  const logo = brandLogo(key);
  const logoSize = key === "tella" ? size : size * 0.56;
  const bg = brand?.bg;
  return (
    <span
      // `plate-sheen` rather than a gradient of our own: a brand colour is not
      // ours to shade, so the tile takes the same top-light every other plate
      // in the app carries and nothing more. It paints through
      // `background-image`, so the fill below has to be `backgroundColor`: the
      // `background` shorthand would blank it.
      className={`${markTileClass(size)} plate-sheen`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        backgroundColor: bg || "var(--bg-active)",
        color: brand?.fg || (brand ? "#fff" : "var(--text-dim)"),
        // Only a real brand earns the tinted lift. The letter fallback is a
        // neutral chrome plate, and a glow under it would read as a colour it
        // does not have.
        boxShadow: bg ? markTileShadow(bg) : undefined,
      }}
    >
      {logo ? (
        <svg
          viewBox={logo.viewBox}
          width={logoSize}
          height={logoSize}
          fill="currentColor"
          aria-hidden="true"
        >
          {logo.paths.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
      ) : (
        key === "codestorage" ? "cs" : name.charAt(0).toUpperCase()
      )}
    </span>
  );
}
