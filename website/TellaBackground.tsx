import heroPosterUrl from "./hero-poster.webp";

/** Tella's "Silver Silk" background loop. */
export function TellaBackground() {
	return (
		<video
			className="hero-video"
			autoPlay
			loop
			muted
			playsInline
			poster={heroPosterUrl}
			aria-hidden="true"
		>
			<source
				src="https://ucarecdn.com/b8c1a712-87c2-4884-8034-77e71fa4d7ac/"
				type="video/mp4"
			/>
		</video>
	);
}
