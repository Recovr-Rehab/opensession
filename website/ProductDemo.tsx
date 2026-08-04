export function ProductDemo() {
	return (
		<figure className="preview-wrap">
			<iframe
				className="product-demo-frame"
				title="Interactive OpenSession product preview"
				src="/product-demo.html"
				loading="lazy"
				referrerPolicy="no-referrer"
				sandbox="allow-scripts allow-same-origin"
			/>
		</figure>
	);
}
