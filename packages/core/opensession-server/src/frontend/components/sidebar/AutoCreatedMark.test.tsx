import { expect, test } from "bun:test";
import type { ReactElement } from "react";
import { AutoCreatedMark } from "./AutoCreatedMark";

type ActivationEvent = {
	key?: string;
	preventDefault: () => void;
	stopPropagation: () => void;
};
type KeepTriggerProps = {
	role: string;
	"aria-label": string;
	"data-sidebar-keep": string;
	onClick: (event: ActivationEvent) => void;
	onKeyDown: (event: ActivationEvent) => void;
};

test("agent mark offers an inline keep action until claimed", () => {
	let kept = 0;
	const actionable = AutoCreatedMark({ onKeep: () => kept++ }) as ReactElement<{
		children: ReactElement<KeepTriggerProps>;
	}>;
	const trigger = actionable.props.children;
	const event = {
		preventDefault: () => {},
		stopPropagation: () => {},
	};

	expect(trigger.props.role).toBe("button");
	expect(trigger.props["aria-label"]).toBe("Keep in sidebar");
	expect(trigger.props["data-sidebar-keep"]).toBe("");
	trigger.props.onClick(event);
	trigger.props.onKeyDown({ ...event, key: "Enter" });
	expect(kept).toBe(2);

	const claimed = AutoCreatedMark({}) as ReactElement<{
		role: string;
		"data-sidebar-keep"?: string;
	}>;
	expect(claimed.props.role).toBe("img");
	expect(claimed.props["data-sidebar-keep"]).toBeUndefined();
});
