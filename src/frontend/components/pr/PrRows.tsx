import type React from "react";
import { avatarUrl, type Provider } from "../../lib/provider";
import type { PrFile, PrReviewer } from "../../lib/types";
import {
  IconCheck,
  IconClock,
  IconFile,
  IconMessage,
  IconX,
} from "../icons";

export function ReviewerRow({ reviewer, provider }: { reviewer: PrReviewer; provider: Provider }) {
  const src = reviewer.isTeam ? null : avatarUrl(reviewer.login, provider, 40);
  const meta = reviewerStateMeta(reviewer.state);
  const toneClass =
    meta.tone === "green"
      ? "text-green"
      : meta.tone === "red"
        ? "text-red"
        : meta.tone === "yellow"
          ? "text-yellow"
          : "text-faint";
  return (
    <div className="flex items-center gap-3 rounded-sm border border-transparent px-1 py-1.5 hover:border-line hover:bg-hover/50">
      {src ? (
        <img className="size-7 rounded-full object-cover" src={src} alt="" loading="lazy" />
      ) : (
        <span
          className="inline-flex size-7 items-center justify-center rounded-full border border-line bg-surface text-[11px] font-semibold text-faint"
          aria-hidden
        >
          {reviewer.login.slice(0, 1).toUpperCase()}
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-sm text-fg">{reviewer.login}</span>
      <span className={`shrink-0 ${toneClass}`} title={meta.label}>
        {meta.icon}
      </span>
    </div>
  );
}

function reviewerStateMeta(state: PrReviewer["state"]): {
  label: string;
  tone: "green" | "red" | "muted" | "yellow";
  icon: React.ReactNode;
} {
  switch (state) {
    case "APPROVED":
      return { label: "Approved", tone: "green", icon: <IconCheck size={16} /> };
    case "CHANGES_REQUESTED":
      return { label: "Requested changes", tone: "red", icon: <IconX size={16} /> };
    case "COMMENTED":
      return { label: "Commented", tone: "muted", icon: <IconMessage size={16} /> };
    default:
      return { label: "Awaiting review", tone: "yellow", icon: <IconClock size={16} /> };
  }
}

export function FileRow({ file, onClick }: { file: PrFile; onClick?: () => void }) {
  const slash = file.path.lastIndexOf("/");
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const base = slash >= 0 ? file.path.slice(slash + 1) : file.path;
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-control border border-transparent px-1 py-1.5 text-left hover:border-line hover:bg-hover/50 disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent"
      onClick={onClick}
      disabled={!onClick}
      title={file.path}
    >
      <IconFile size={16} className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate text-sm text-fg">
        {dir && <span className="text-faint">{dir}</span>}
        {base}
      </span>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-meta">
        {file.additions > 0 && <span className="text-green">+{file.additions}</span>}
        {file.deletions > 0 && <span className="text-red">−{file.deletions}</span>}
      </span>
    </button>
  );
}
