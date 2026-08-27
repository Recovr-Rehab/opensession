import type { Metadata, Viewport } from "next";
import "../../setup.css";
import { SetupEntry } from "../legacy-entry";

const title = "Set up Open Session";
const description = "Set up a private Open Session server on a VPS with Tailscale.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/setup" },
  openGraph: {
    type: "website",
    url: "/setup",
    title,
    description,
    images: ["/opensession-social-landing.png"],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/opensession-social-landing.png"],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#101011" },
  ],
};

export default function SetupPage() {
  return <SetupEntry />;
}
