/**
 * The bar across the top of each Support inbox column.
 *
 * The queue and the ticket beside it share one height, the app's own
 * `--desktop-header-h`, so the two columns and the sidebar's brand row all
 * start on one line. `wco-chrome` is what makes the row a drag region in the
 * desktop shell, which is why the box is drawn even when it has nothing in it:
 * a bar that came and went with the open ticket would take the window's top
 * edge with it, and the pane below would jump by its height.
 *
 * Shared because two components fill it. The queue puts its name and count
 * here; the open ticket puts its subject and customer here (ConversationPane's
 * `headerInBar`), which is why that pane draws its own copy rather than being
 * handed one.
 */
export const SUPPORT_COLUMN_BAR =
	"wco-chrome flex h-[var(--desktop-header-h)] shrink-0 items-center gap-2 " +
	"border-b border-divider px-4";
