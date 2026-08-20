import type { AnsweredAskData } from "@tellahq/opensession-protocol/notices";
import { renderMarkdown } from "../lib/markdown";
import { msgRow } from "../lib/msg-classes";
import { IconCheck } from "./icons";
import { useMarkdownRepo } from "./MarkdownBody";

/** A durable receipt for an answer sent through AskCard. It sits in the
 * assistant side of the transcript, but its quiet surface and status label
 * distinguish it from the agent's own prose. Only the question and the exact
 * answer remain. The unpicked options were useful while deciding, not later. */
export function AnsweredAskCard({
	record,
	entryId,
}: {
	record: AnsweredAskData;
	entryId: string;
}) {
	const repo = useMarkdownRepo();
	const count = record.questions.length;

	return (
		<div className={msgRow} data-eid={entryId} data-answered-ask="">
			<div className="max-w-[min(600px,90%)] rounded-lg bg-panel px-3.5 py-3 [corner-shape:var(--cs)]">
				<div className="flex items-center gap-1.5 text-label font-semibold text-dim">
					<span
						aria-hidden="true"
						className="flex h-4 w-4 items-center justify-center rounded-full bg-green-soft text-green"
					>
						<IconCheck size={14} />
					</span>
					{count === 1 ? "Answer sent" : `${count} answers sent`}
				</div>

				<div className="mt-2.5 flex flex-col gap-3.5">
					{record.questions.map((question, index) => (
						<section key={`${question.question}:${index}`}>
							{question.header && (
								<div className="mb-0.5 text-meta font-semibold text-faint">
									{question.header}
								</div>
							)}
							<div
								className="markdown text-supporting leading-5 text-dim [overflow-wrap:anywhere]"
								dangerouslySetInnerHTML={{
									__html: renderMarkdown(question.question, { repo }),
								}}
							/>
							<div className="mt-1 whitespace-pre-wrap text-body font-medium leading-6 text-fg [overflow-wrap:anywhere]">
								{question.answer || "No answer"}
							</div>
						</section>
					))}
				</div>
			</div>
		</div>
	);
}
