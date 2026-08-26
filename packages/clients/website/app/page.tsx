import type { Viewport } from "next";
import { LandingEntry } from "./legacy-entry";

export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function HomePage() {
  return <LandingEntry />;
}
