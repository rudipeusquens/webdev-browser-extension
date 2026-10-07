# Smoke test

The checks automation cannot do: the installed package, the browser's own prompts, real keys
and menus, a real microphone and the real OpenRouter. Everything else runs in the E2E suite
(`pnpm test:e2e`) against the built extension in Chrome for Testing.

**When:** before a release, all of it, in Chrome and in Brave. Before a pull request is
merged, the sections its change touches; the pull request names them. The owner runs it: an
agent has no real browser profile, permission prompt or microphone.

**You need:**

- the package from `pnpm zip`, installed as the README says (section 1 does it);
- `https://example.com` and a local dev server of an app of your own
  (`http://localhost:<port>`; Vue 3 or Astro in dev mode for section 5);
- an OpenRouter key and a microphone for section 6.

**Record** for each run: browser and version, operating system, extension version, and per
section pass or fail with a note. In a pull request, name no real site and paste no prompt
from one (`docs/public-repo-policy.md`).

Each step says what to do, then what you should see.

## 1. Install and update

- [ ] Remove any earlier copy of the extension. Unpack the zip into a new folder, open
      `chrome://extensions`, turn on **Developer mode**, **Load unpacked**, choose the folder.
      → The card shows the logo, "Webdev Browser Extension" and the version from
      `package.json`; no **Errors** button.
- [ ] Pin the extension to the toolbar. → The icon is clear at toolbar size, in a light and in
      a dark browser theme.
- [ ] Open `chrome://extensions/shortcuts`. → The extension's activation key is
      `Ctrl+Shift+K` (`⇧⌘K` on macOS), unless another extension took it first.

## 2. Start and stop

- [ ] Open `https://example.com` and click the toolbar icon. → The side panel opens; the site
      pill shows `example.com` with a green dot. The page works as before (Browse mode).
- [ ] Click the toolbar icon again. → The panel closes.
- [ ] Press `Ctrl+Shift+K` (`⇧⌘K`), then again. → The panel opens with the overlay, then
      closes.
- [ ] Settings (gear) → **General** → turn on **Annotate this page in the context menu**.
      Close the panel, right-click the page. → The menu has **Annotate this page**; it opens
      the panel. Turn the option off. → The entry is gone from the menu.
- [ ] With the panel open, switch to a tab with `chrome://extensions` and click the toolbar
      icon. → The panel says "Can't run on this page: Chrome keeps extensions off it."

## 3. Mark, copy, paste

On `https://example.com` with the panel open:

- [ ] Press `E`, click the heading. → A popover "New pin"; type `Bigger heading`, `Enter`. →
      Pin 1 on the heading; the panel lists it. (If `E` does nothing, the panel has the focus:
      click an empty spot of the page first, and note it.)
- [ ] Press `Esc`, select a few words of the paragraph. → A **Pin** chip below the selection;
      click it, type a comment, `Enter`. → Pin 2 at the words.
- [ ] Press `A`, drag a rectangle over the paragraph, type a comment, `Enter`. → Pin 3.
- [ ] **Copy as prompt**. → "Copied 3 pins"; the pins leave the page and the list, since the
      filter **Open** shows open pins only. Under **All** they are back, green.
- [ ] Paste into your AI agent's input (Claude Code, Codex, Cursor). → The prompt arrives
      whole as text: "# UI feedback: 3 items on 1 page", then each comment as a `>` line.
- [ ] In the panel, press `Ctrl+Z` (`⌘Z`). → The three pins are open again.
- [ ] Reload the page. → No overlay. Click the toolbar icon. → The pins come back where they
      were.

## 4. Always enable here

- [ ] On `https://example.com`, point at the site pill and click **Always enable here**. →
      Chrome asks for access to the site. Allow. → The pill's tooltip says the site loads by
      itself.
- [ ] Reload the page. → The overlay starts without a click: the pins appear.
- [ ] Settings → **Sites**. → `example.com` with its number of open pins and **Auto**.
- [ ] On another web site, start the overlay with the toolbar icon, then **Always enable
      here**, and deny Chrome's prompt. → Nothing changes; the site is not remembered.
- [ ] Back on `example.com`, point at the pill, **Forget this site**, confirm. Reload. → No
      overlay. Click the toolbar icon. → The overlay starts and the pins are back.

## 5. Your own dev server

On `http://localhost:<port>`, a Vue 3 or Astro app in dev mode:

- [ ] Press `E` and point at an element of a component. → The chip names the tag and the
      component. Pin it and copy. → The prompt's `Component:` line names the component and
      its source file.
- [ ] Change that component's file so the dev server reloads it. → The pin stays on its
      element.
- [ ] Navigate inside the app (a client-side route). → The pins follow the page; the panel
      groups the pins by page.

## 6. Dictation

Settings → **Voice**:

- [ ] Paste the key into **OpenRouter API key**, **Save**. → It shows as `sk-or-v1-…` and its
      last four characters. **Test**. → "Key works."
- [ ] **Microphone** → **Grant**. → A tab opens and Chrome asks for the microphone. Allow it
      for good, not just this time. → The tab says "Microphone allowed. You can close this
      tab." and closes itself; Settings shows "Allowed". On macOS the first time, the system
      asks whether the browser may use the microphone; allow it (System Settings → Privacy &
      Security → Microphone).
- [ ] In a pin's popover, click the mic button next to **Save**, say a sentence, click it
      again. → A timer while recording, then "Transcribing…", then the sentence at the caret.
- [ ] `Alt+V` (`⌥V`) to start, `Esc` while recording. → The recording stops; nothing is
      inserted.
- [ ] After a dictation, `Ctrl+Z` (`⌘Z`) in the field. → The dictated text goes out again.
- [ ] Remove the key (bin icon), then click the mic in a popover. → "Add an OpenRouter API key
      in settings." with **Open settings**.

## 7. Update in place

With pins from section 3, a saved key and the microphone allowed (section 6; save the key
again after its last step):

- [ ] Empty the extension's folder, unpack the zip into it again, and click the reload icon on
      the extension's card. → The pins, the settings, the API key and the microphone
      permission are all still there.

## 8. Brave

- [ ] Sections 1 to 4, 6 and 7 in Brave (`brave://extensions`), with Shields up on
      `example.com`. → The same results; the panel opens in Brave's sidebar.
