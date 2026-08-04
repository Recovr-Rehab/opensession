# OpenSession website

The public marketing site is a separate frontend from the authenticated
OpenSession app. It deliberately imports no app APIs, WebSocket hooks, or auth
code, so the static output can be hosted on a public origin while OpenSession
instances stay private.

```sh
bun run website:dev    # http://127.0.0.1:3865
bun run website:build  # writes .website-dist/
```

Deploy the contents of `.website-dist/` as a static site. The build always
emits stable `index.html` and `opensession-social.png` paths; scripts, styles,
and the in-page icon remain content-hashed.

The hero uses animated background artwork from Tella. The product preview is
a self-contained interactive React demo, so visitors can switch sessions,
collapse navigation, and try the composer without connecting to a real
OpenSession instance.

Agentation is available on localhost and tailnet staging hosts for visual
feedback. It is not rendered on the public website.
