import React from "react";
import { BRANDS, brandLogo } from "../brand-logos";

/** Rounded brand square with the service's real logo (falls back to the first
 * letter on a neutral tile). Shared by the Connections page and the
 * connected-services picker so both read the same. */
export function IconTile({ name, size = 34 }: { name: string; size?: number }) {
  const key = name.toLowerCase();
  const brand = BRANDS[key];
  const logo = brandLogo(key);
  const logoSize = key === "tella" ? size : size * 0.56;
  return (
    <span
      className="flex flex-shrink-0 items-center justify-center overflow-hidden rounded-md font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: brand?.bg || "var(--bg-active)",
        color: brand?.fg || (brand ? "#fff" : "var(--text-dim)"),
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
