import type { Metadata } from "next";
import { IconX } from "../../../../core/opensession-server/src/frontend/components/icons";
import { AnnouncementArticle } from "../../AnnouncementArticle";

const title = "Open Session is open source";
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
		<main className="announcement-page">
			<section
				className="announcement-page-panel"
				aria-labelledby="announcement-title"
			>
				<a className="announcement-close" href="/" aria-label="Close announcement">
					<IconX size={24} />
				</a>
				<div className="announcement-scroll">
					<AnnouncementArticle />
				</div>
			</section>
		</main>
	);
}
