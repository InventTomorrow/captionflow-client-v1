# Caption fonts

These TTF files are static instances of Google Fonts families, mirrored
byte-for-byte from `server/fonts/` by `server/scripts/sync-fonts.mjs` (the
originals are fetched by `server/scripts/download-fonts.mjs`). Do not edit or
add files here by hand — run the sync.

They are served at `/fonts/<file>` so the in-browser export worker measures
and draws captions with exactly the bytes the server's renderer uses.

All families are distributed under the SIL Open Font License 1.1 or the
Apache License 2.0 as published on https://fonts.google.com — both permit
bundling and serving the fonts with this application. Per-family licence
text is available from each family's page on Google Fonts.
