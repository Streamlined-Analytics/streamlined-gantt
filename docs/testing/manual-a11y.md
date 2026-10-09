# Manual accessibility and device checklist

Run before each release and record the results in the release PR. Automated checks (axe, ARIA
snapshots, keyboard-only flows) cannot replace these.

## Screen readers

For each of NVDA with Firefox, JAWS with Chrome, VoiceOver with Safari (macOS) and VoiceOver
with Safari (iPadOS), on the flat-roof example:

- [ ] Tab into the chart: it is one tab stop, and the focused row is announced with its position
      ("row 5 of 14") and level.
- [ ] Arrow through rows: each announces name, start, finish and duration in working days;
      critical tasks say "critical".
- [ ] Left and right arrows collapse and expand summaries, and the state is announced.
- [ ] Alt+Right Arrow moves a task: the live region says where it moved, how many tasks were
      rescheduled and the new finish.
- [ ] Ctrl+Z undoes, and the live region confirms.
- [ ] Read-only mode: editing keys announce that the programme is read-only.

## Zoom and contrast

- [ ] 200% and 400% browser zoom: the chart reflows without hiding content behind the sticky
      grid.
- [ ] Windows High Contrast (forced colours): bars, milestones, links and markers stay visible.
- [ ] DaisyUI dark theme: text and bars keep at least 4.5:1 and 3:1 contrast.

## Real touch devices

On the oldest available iPad (iPadOS 16.4 or later) and an Android phone:

- [ ] Vertical swipes over bars scroll the chart.
- [ ] Tap selects a bar; dragging the selected bar moves it; resize handles are easy to hit.
- [ ] Long-press opens the context menu.
- [ ] Pinch-zoom of the page does not break dragging.

## Phones (`examples/mobile.html`, ADR-0011)

On an iPhone (Safari) and an Android phone (Chrome), with VoiceOver and TalkBack once each:

- [ ] Held upright, the summary shows instead of the chart and the page scrolls past it with no
      scroll trapped inside it.
- [ ] **Open the chart** goes full screen; on Android it turns to landscape; on the iPhone the
      "turn your phone sideways" hint shows until you do.
- [ ] Landscape: every row fits without scrolling; nothing sits under the notch or the home
      indicator.
- [ ] Tap a bar, then drag it: it moves, the page does not scroll, the summary shows the new dates
      after closing.
- [ ] Pinch zooms the chart, not the page; the rail's minus and fit return to the whole programme.
- [ ] Android's back gesture leaves fullscreen; the close button then returns to the page.
- [ ] The task editor opens as a bottom sheet and focusing a field does not zoom the page.
- [ ] VoiceOver / TalkBack read the summary rows, the rail buttons and the dialog's name.
