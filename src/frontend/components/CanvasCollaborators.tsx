import { useEditor, useValue } from "tldraw";
import { usePeople } from "../lib/people";
import { cn } from "../ui/cn";
import { useCurrentUser } from "./UserPicker";
import { UserAvatar } from "./UserAvatar";

function personKey(name: string): string {
	return name.trim().split(/\s+/)[0]?.toLowerCase() || "";
}

/** Stable team roster with live Canvas membership layered on top. */
export function CanvasCollaborators() {
	const editor = useEditor();
	const currentUser = useCurrentUser();
	const people = usePeople();
	const peers = useValue(
		"canvas collaborators",
		() => editor.collaborators.getVisibleCollaborators(),
		[editor],
	);
	const active = new Set([
		personKey(currentUser),
		...peers.map((presence) => personKey(presence.userName)),
	]);
	const known = new Set(people.map((person) => personKey(person.name)));
	const roster = known.has(personKey(currentUser))
		? people
		: [
				...people,
				{ name: currentUser || "Anonymous", fullName: currentUser || "Anonymous" },
			];
	known.add(personKey(currentUser));
	const collaborators = [
		...roster,
		...peers
			.filter((presence) => !known.has(personKey(presence.userName)))
			.map((presence) => ({
				name: presence.userName || "Anonymous",
				fullName: presence.userName || "Anonymous",
			})),
	];

	if (!collaborators.length) return null;
	return (
		<div
			className="pointer-events-none absolute bottom-3 right-3 flex -space-x-2 rounded-popup bg-panel p-1.5 shadow-lg phone:bottom-[calc(12px+env(safe-area-inset-bottom))]"
			aria-label="Canvas collaborators"
		>
			{collaborators.map((person) => {
				const isActive = active.has(personKey(person.name));
				return (
					<UserAvatar
						key={personKey(person.name)}
						name={person.name}
						login={
							"github" in person && typeof person.github === "string"
								? person.github
								: undefined
						}
						size={28}
						title={`${person.fullName} · ${isActive ? "In Canvas" : "Collaborator"}`}
						className={cn(!isActive && "opacity-40 grayscale")}
						style={{
							boxShadow: "var(--avatar-edge), 0 0 0 2px var(--bg-panel)",
						}}
					>
						{isActive && (
							<span
								aria-hidden="true"
								className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-green"
								style={{ boxShadow: "0 0 0 2px var(--bg-panel)" }}
							/>
						)}
					</UserAvatar>
				);
			})}
		</div>
	);
}
