import { expect, test } from "bun:test";
import type { ReactElement } from "react";
import { KeepInSidebarMark } from "./KeepInSidebarMark";

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

test("visible but unclaimed rows offer an inline keep action", () => {
	let kept = 0;
	const action = KeepInSidebarMark({ onKeep: () => kept++ }) as ReactElement<{
		children: ReactElement<KeepTriggerProps>;
	}>;
	const trigger = action.props.children;
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
});
