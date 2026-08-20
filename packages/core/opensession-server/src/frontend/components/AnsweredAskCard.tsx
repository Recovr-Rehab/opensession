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
	const lone = count === 1 ? record.questions[0] : undefined;

	return (
		<div className={msgRow} data-eid={entryId} data-answered-ask="">
			<div className="max-w-[min(600px,90%)] rounded-2xl bg-panel p-4 [corner-shape:var(--cs)]">
				<div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-label font-semibold">
					<span
						aria-hidden="true"
						className="flex h-4 w-4 items-center justify-center rounded-full bg-green-soft text-green"
					>
						<IconCheck size={14} />
					</span>
					<span className="text-dim">
						{count === 1 ? "Answer sent" : `${count} answers sent`}
					</span>
					{lone?.header && (
						<>
							<span aria-hidden="true" className="text-faint">
								·
							</span>
							<span className="text-faint">{lone.header}</span>
						</>
					)}
				</div>

				<div className="mt-3 flex flex-col gap-4">
					{record.questions.map((question, index) => (
						<section key={`${question.question}:${index}`}>
							{question.header && !lone && (
								<div className="mb-1 text-meta font-semibold text-faint">
									{question.header}
								</div>
							)}
							<div
								className="markdown text-control-label leading-5 text-dim [overflow-wrap:anywhere] [text-wrap:pretty]"
								dangerouslySetInnerHTML={{
									__html: renderMarkdown(question.question, { repo }),
								}}
							/>
							<div className="mt-2.5 whitespace-pre-wrap rounded-md bg-control px-3 py-2.5 text-body font-medium leading-6 text-fg [overflow-wrap:anywhere] [corner-shape:var(--cs)]">
								{question.answer || "No answer"}
							</div>
						</section>
					))}
				</div>
			</div>
		</div>
	);
}
