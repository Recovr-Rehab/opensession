import type { Metadata } from "next";
import { AnnouncementArticle } from "../../AnnouncementArticle";

const title = "Introducing Open Session";
const description =
	"Why we built Open Session, how our team uses it, and why we are open-sourcing our cloud-based agent orchestrator.";

export const metadata: Metadata = {
	title: `${title} · Open Session`,
	description,
	alternates: { canonical: "/announcement" },
	openGraph: {
		type: "article",
		url: "/announcement",
		title,
		description,
		images: ["/opensession-social.png"],
	},
	twitter: {
		card: "summary",
		title,
		description,
		images: ["/opensession-social.png"],
	},
};

export default function AnnouncementPage() {
	return (
		<main className="announcement-page" aria-labelledby="announcement-title">
			<a className="announcement-home" href="/">
				Home
			</a>
			<AnnouncementArticle />
		</main>
	);
}
