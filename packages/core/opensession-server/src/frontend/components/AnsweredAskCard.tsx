import type { AnsweredAskData } from "@tellahq/opensession-protocol/notices";
import { renderMarkdown } from "../lib/markdown";
import { ASK_CARD_SHELL, ASK_CHOICE_ROW_BASE } from "../lib/ask-card-classes";
import { cn } from "../ui/cn";
import { IconCheck } from "./icons";
import { useMarkdownRepo } from "./MarkdownBody";

const OPTION_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function answerState(question: AnsweredAskData["questions"][number]): {
	selected: Set<string>;
	typed: string[];
} {
	const options = question.options ?? [];
	const answer = question.answer.trim();
	if (!answer) return { selected: new Set(), typed: [] };

	// Preserve a single option whose label itself contains a comma. The live
	// card's old answer wire joins multi-select labels with ", ", so only a
	// multi-select needs the split fallback.
	if (!question.multiSelect) {
		const offered = options.find((option) => option.label === answer);
		return offered
			? { selected: new Set([offered.label]), typed: [] }
			: { selected: new Set(), typed: [answer] };
	}

	const parts = answer
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
	const labels = new Set(options.map((option) => option.label));
	return {
		selected: new Set(parts.filter((part) => labels.has(part))),
		typed: parts.filter((part) => !labels.has(part)),
	};
}

function ChoiceMark({ multiple, selected }: { multiple: boolean; selected: boolean }) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"mt-px flex h-5 w-5 shrink-0 items-center justify-center border",
				multiple
					? "rounded-[calc(6px*var(--rf))] [corner-shape:var(--cs)]"
					: "rounded-full",
				selected
					? "border-transparent bg-fg text-bg"
					: "border-line-strong text-transparent",
			)}
		>
			<IconCheck size={20} />
		</span>
	);
}

/** The durable, read-only form of AskCard. It deliberately keeps the original
 * card's shell, question rhythm, lettered options and selection indicator, but
 * removes every input and action so history never looks answerable. */
export function AnsweredAskCard({
	record,
	entryId,
}: {
	record: AnsweredAskData;
	entryId: string;
}) {
	const repo = useMarkdownRepo();
	const lone = record.questions.length === 1 ? record.questions[0] : undefined;

	return (
		<div className={ASK_CARD_SHELL} data-eid={entryId} data-answered-ask="">
			<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
				<span
					aria-hidden="true"
					className="h-1.5 w-1.5 shrink-0 rounded-full bg-green shadow-[0_0_0_3px_var(--green-soft)]"
				/>
				<span className="text-label font-semibold text-dim">
					{record.questions.length === 1
						? "Answered"
						: `Answered ${record.questions.length} questions`}
				</span>
				{lone?.header && (
					<>
						<span aria-hidden="true" className="text-label text-faint">
							·
						</span>
						<span className="text-label font-semibold text-faint">{lone.header}</span>
					</>
				)}
			</div>

			{record.questions.map((question, questionIndex) => {
				const { selected, typed } = answerState(question);
				const multiple = Boolean(question.multiSelect);
				return (
					<section
						key={`${question.question}:${questionIndex}`}
						className="flex min-w-0 flex-col gap-3"
					>
						{question.header && !lone && (
							<span className="text-label font-semibold text-faint">{question.header}</span>
						)}
						<div
							className="markdown text-body leading-6 text-fg [overflow-wrap:anywhere]"
							dangerouslySetInnerHTML={{
								__html: renderMarkdown(question.question, { repo }),
							}}
						/>
						<div className="flex flex-col gap-1.5" role="list" aria-label="Answer choices">
							{question.options?.map((option, optionIndex) => {
								const active = selected.has(option.label);
								return (
									<div
										key={`${option.label}:${optionIndex}`}
										role="listitem"
										aria-label={`${option.label}${active ? ", selected" : ""}`}
										data-selected={active ? "" : undefined}
										className={ASK_CHOICE_ROW_BASE}
									>
										<span className="-mr-2 w-3.5 shrink-0 text-label leading-5 text-faint">
											{OPTION_LETTERS[optionIndex] ?? "–"}
										</span>
										<span className="min-w-0 flex-1">
											<span className="block text-control-label font-semibold leading-5 text-fg">
												{option.label}
											</span>
											{option.description && (
												<span className="mt-0.5 block text-supporting leading-[1.45] text-dim">
													{option.description}
												</span>
											)}
										</span>
										<ChoiceMark multiple={multiple} selected={active} />
									</div>
								);
							})}
							{typed.map((answer, typedIndex) => (
								<div
									key={`${answer}:${typedIndex}`}
									role="listitem"
									aria-label={`${answer}, selected typed answer`}
									data-selected=""
									className={ASK_CHOICE_ROW_BASE}
								>
									<span className="-mr-2 w-3.5 shrink-0 text-label leading-5 text-faint">–</span>
									<span className="min-w-0 flex-1">
										<span className="block text-control-label font-semibold leading-5 text-fg">
											{answer}
										</span>
										<span className="mt-0.5 block text-supporting leading-[1.45] text-dim">
											Typed answer
										</span>
									</span>
									<ChoiceMark multiple={multiple} selected />
								</div>
							))}
						</div>
					</section>
				);
			})}
		</div>
	);
}
