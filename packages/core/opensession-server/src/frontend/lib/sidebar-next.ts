export const SIDEBAR_ITEM_KEY_ATTRIBUTE = "data-sidebar-item-key";

interface SidebarItemElement {
	getAttribute(name: string): string | null;
}

interface SidebarAttentionElement {
	hasAttribute(name: string): boolean;
}

/**
 * Pick the next rendered sidebar item, falling back to the previous item when
 * the current item is last. Repeated copies of the current item are skipped.
 */
export function nextRenderedSidebarItem<T extends SidebarItemElement>(
	items: readonly T[],
	current: T | null,
	currentKey: string,
): T | null {
	let index = current ? items.indexOf(current) : -1;
	if (index < 0) {
		index = items.findIndex(
			(item) => item.getAttribute(SIDEBAR_ITEM_KEY_ATTRIBUTE) === currentKey,
		);
	}
	if (index < 0) return null;

	for (let i = index + 1; i < items.length; i += 1) {
		if (items[i].getAttribute(SIDEBAR_ITEM_KEY_ATTRIBUTE) !== currentKey)
			return items[i];
	}
	for (let i = index - 1; i >= 0; i -= 1) {
		if (items[i].getAttribute(SIDEBAR_ITEM_KEY_ATTRIBUTE) !== currentKey)
			return items[i];
	}
	return null;
}

/**
 * Pick the next unread item in rendered sidebar order. A selected unread
 * workspace wins because its unread activity belongs to a sibling session tab.
 */
export function nextUnreadRenderedSidebarItem<T extends SidebarAttentionElement>(
	items: readonly T[],
): T | null {
	if (items.length === 0) return null;
	const selected = items.findIndex((item) => item.hasAttribute("data-selected"));
	if (selected >= 0 && items[selected].hasAttribute("data-unread"))
		return items[selected];

	const start = selected >= 0 ? selected + 1 : 0;
	for (let offset = 0; offset < items.length; offset += 1) {
		const item = items[(start + offset) % items.length];
		if (item.hasAttribute("data-unread")) return item;
	}
	return null;
}
