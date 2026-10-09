# 0012. MSPDI export: text XML 1.0 cannot carry is dropped natively and kept in the residue

- **Status:** Accepted
- **Date:** 2026-10-09
- **Deciders:** Ben Atkinson (Streamlined Analytics)
- **Feature / area:** io/mspdi, io/xml
- **Builds on:** ADR-0008 (MSPDI import and export: native fields plus a residue patch)
- **Supersedes / Superseded by:** none

## What problem were we trying to solve?

Issue #9. The MSPDI property test (`tests/io/mspdi.property.test.js`, seed `-1576626285`, found
under `TZ=America/Los_Angeles`) exported a task named `"￾"` and imported it back as `""`.
ADR-0008 promises a lossless round trip for every valid programme, and programme text is any
JSON string, so this was a broken promise rather than an edge case to document.

XML 1.0 has a closed set of legal characters (the `Char` production): tab, line feed, carriage
return, U+0020–U+D7FF, U+E000–U+FFFD and U+10000–U+10FFFF. The rest cannot appear in a document
at all, not even as a character reference (`&#xFFFE;` is a fatal error in libxml2). The rest
is:

- C0 controls other than tab, line feed and carriage return;
- lone surrogates (in a JavaScript string, half of a pair on its own);
- the noncharacters U+FFFE and U+FFFF.

The writer already dropped C0 controls and U+FFFE/U+FFFF from native text, and the residue was
meant to restore them. It worked for controls only by luck. The residue is JSON, and
`JSON.stringify` escapes controls as `\u0001`, but it writes U+FFFE and U+FFFF raw. The writer
then stripped them from the residue too, so the restore restored the stripped value.

Looking at the whole class turned up three more gaps:

1. **Lone surrogates were written as they were.** The export string was not a sequence of XML
   characters. Encoded as UTF-8 for saving, each one becomes U+FFFD. Our own reader never saw
   that, because it parses the in-memory string. So the residue thought nothing was lost.
2. **Task ids.** The id goes in Text1. A dropped character can change it (`"A￾"` reads back
   as `"A"`), or make it collide with another task's id, which import then replaces with `t` plus
   the UID. Export paired the original and rebuilt tasks by id, and so missed the pairing. It
   then keyed an overflowing residue (over 255 characters, moved to the project notes) by the
   original id, while import looks it up by the id it rebuilt. The overflow was silently ignored.
3. **Carriage returns** are legal, but XML parsers normalise a literal one to a line feed. MS
   Project and other tools would have changed `\r\n` in notes to `\n`. Our reader does not
   normalise, so the residue never noticed.

## What did we try?

### Option 1: narrow the property arbitrary and document the loss ❌ rejected

Excluding the illegal code points from the arbitrary and listing them as "not preserved" would
have been the smallest change. But ADR-0008 already has a mechanism for exactly this: data the
native format cannot hold goes in the residue. A documented loss was only needed if the residue
could not carry the characters, and it can.

### Option 2: our own escape scheme in the native text ❌ rejected

For example, write U+FFFE as a private-use character or a `￾`-style marker in `Name`, and
reverse it on import. That puts our encoding into fields people read in MS Project, and import
cannot tell our marker from a user who typed the same thing. The residue already has unambiguous
JSON escapes.

### Option 3: drop natively, preserve in the residue ✅ chosen

- **Native text** (`escapeXml` in `io/xml.js`) drops every code point outside `Char`: C0
  controls other than tab, line feed and carriage return; lone surrogates; U+FFFE and U+FFFF.
  It writes a carriage return as `&#13;`, which parsers keep. What MS Project shows is the text
  with those characters removed, which is the only thing it could show.
- **The residue** is serialised by `residueJson`: `JSON.stringify`, then U+FFFE and U+FFFF as
  `￾` / `￿`. `JSON.stringify` already escapes controls and lone surrogates, so the
  residue is plain XML text. Because export diffs against a native re-import (ADR-0008), every
  dropped character shows up as a difference and is stored. No field needs its own handling.
  That covers the project name and currency, calendar and exception names, task ids, names,
  WBS, notes, trade, crew, custom fields and link ids alike.
- **Pairing by position.** `residueFor` pairs each original task with the rebuilt task at its
  UID position, not by id. It keys overflowing residues by the rebuilt id, which is what import
  looks up before patching. Files written by 0.3.0 still import: their keys were the original
  ids, which equal the rebuilt ids whenever the old export worked.

## What did we land on, and why?

Option 3. It keeps ADR-0008's guarantee (`fromMSPDI(toMSPDI(p)).programme` deep-equals `p`, and
a second export is byte-identical) for every valid programme, with no new format and no
loss list. The export is always a well-formed XML 1.0 document.

Tests:

- `tests/io/mspdi.test.js` runs the exact repro from the issue. For each illegal class, it puts
  the characters in every text field the writer emits. It asserts libxml2 (`xmllint-wasm`,
  already a dev dependency) accepts the document as well-formed, the round trip is lossless
  with no warnings, and re-export is byte-identical. It also checks what a native-only reader
  sees and that `\r` is written as `&#13;`.
- The property test now runs the seed that found the bug, pinned. A second property draws text
  mostly from illegal characters into every text field, because `fc.string({ unit: "binary" })`
  almost never produces U+FFFE/U+FFFF and never produces lone surrogates. Every property also
  asserts that the export contains no character outside `Char`.

## What does this cost us?

- The module grew by about 15 bytes gzip net, to 9.99 KB against the 10 KB budget. The fix
  itself cost about 70 bytes. A compact regex literal, pairing tasks through the existing UID
  map, and reusing `isPlainObject` from `io/residue` in the reader won most of that back. There
  is now almost no headroom left for the next MSPDI feature.
- A task whose text needs the residue gets a residue it did not have before. That uses more of
  the 255-character Text4 field, or moves it to the project notes.
- Other tools see the text without the illegal characters, and an edit there to that field is
  overridden by the residue on import. That is ADR-0008's existing trade-off for residue-held
  fields.
- Our reader still accepts character references to illegal code points (such as `&#xFFFE;`) in
  foreign files. It is lenient on input and strict on output. Rejecting them would turn a
  readable file into an error for no benefit to the user.
