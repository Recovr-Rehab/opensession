import pearlPosterUrl from "./pearl-poster.webp";

export function TellaBackground() {
	return (
		<video
			className="hero-video"
			autoPlay
			loop
			muted
			playsInline
			poster={pearlPosterUrl}
			aria-hidden="true"
		>
			<source
				src="https://ucarecdn.com/fdcd780a-72a1-4d05-8f1a-8dbd1b4713b0/"
				type="video/mp4"
			/>
		</video>
	);
}
