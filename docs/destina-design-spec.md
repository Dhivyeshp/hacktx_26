# Destina: Design Spec for the Web App

Apply this to the existing web app. Keep the current layout and the charcoal and cream palette. Change only what is listed here.

## 1. Color tokens

Sampled from the current Profile page. Do not introduce new colors.

```css
:root {
  /* Surfaces */
  --bg: #262722;          /* page background, charcoal */
  --bg-raised: #2F302A;   /* dark cards, hover rows */
  --line: #45463F;        /* hairlines and dividers on dark */
  --cream: #ECE8DD;       /* light panel */
  --cream-2: #DEDCD1;     /* second light panel */
  --line-light: #C9C6BA;  /* hairlines on cream */

  /* Text */
  --text: #EEEAE0;        /* primary text on dark */
  --text-muted: #A8A69B;  /* secondary text on dark */
  --ink: #26271F;         /* primary text on cream */
  --ink-muted: #5C5B52;   /* secondary text on cream */

  /* Accents */
  --tan: #C49A63;         /* brand accent on dark: star, active tab, primary button */
  --tan-hover: #D8B27F;
  --tan-deep: #9A7244;    /* brand accent on cream */
  --sage: #8E9C7E;        /* status dots: connected, saved */
}
```

Rules:
- Use tan sparingly: the logo star, the active tab underline, the primary button, and focus rings. Nothing else.
- Use sage only for status indicators.
- Never put `--text-muted` on cream or `--ink-muted` on charcoal.

## 2. Fonts

Three fonts, one role each. Do not add more.

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Unicase:wght@500;600&family=Cormorant+Garamond:ital,wght@0,500;1,500&family=Space+Grotesk:wght@400;500&display=swap">
```

```css
:root {
  --font-title: 'Cormorant Unicase', serif;   /* wordmark and capsule names only */
  --font-head: 'Cormorant Garamond', serif;   /* page and section headlines, italic */
  --font-ui: 'Space Grotesk', sans-serif;     /* everything else */
}
body { font-family: var(--font-ui); background: var(--bg); color: var(--text); }
```

| Role | Font | Size | Weight and style | Used for |
| --- | --- | --- | --- | --- |
| Wordmark | Cormorant Unicase | 40px | 500 | Header logo |
| Capsule title | Cormorant Unicase | 48 to 64px | 500, letter-spacing 0.03em | Capsule names (Duel, Bounty, Golden) |
| H1 | Cormorant Garamond | clamp(44px, 6vw, 72px) | 500 italic, letter-spacing -0.01em | Page headline ("A little about you.") |
| H2 | Cormorant Garamond | 40px | 500 italic | Panel headlines ("The things you're into.") |
| Eyebrow label | Space Grotesk | 12px | 500, uppercase, letter-spacing 0.2em | YOUR PROFILE, INSTAGRAM, YOUR INTERESTS |
| Body | Space Grotesk | 17px | 400, line-height 1.6 | Paragraphs |
| UI | Space Grotesk | 15 to 16px | 500 | Tabs, buttons, list items |
| Small | Space Grotesk | 13px | 400 | Footnotes, helper text |

```css
h1, h2 { font-family: var(--font-head); font-style: italic; font-weight: 500; letter-spacing: -0.01em; line-height: 1.1; }
h1 { font-size: clamp(44px, 6vw, 72px); }
h2 { font-size: 40px; }
.eyebrow { font-family: var(--font-ui); font-size: 12px; font-weight: 500; letter-spacing: 0.2em; text-transform: uppercase; }
.brand { font-family: var(--font-title); font-size: 40px; font-weight: 500; letter-spacing: 0.03em; }
```

## 3. Page fixes (Profile page)

1. **Headline.** Set "A little about you." in H1 style. Remove the bold on "A little". For emphasis, italicize nothing extra: the whole headline is already italic serif.
2. **Panel headlines.** "The things you're into." and "The things you chose." use H2 style, in `--ink` on cream.
3. **Header logo.** Replace the text wordmark with the logo lockup (section 4) at 40px wordmark height. Mark sits left of the wordmark, 12px gap.
4. **Active tab.** Underline in `--tan`, 2px. Inactive tabs in `--text-muted`.
5. **Avatar.** Wrap the initial in a 32px circle: `--bg-raised` fill, 1px `--line` border, initial in `--font-ui` 500 14px.
6. **Interest list.**
    - Normalize to sentence case: "Climbing", "Hiking", "Software engineering".
    - Each interest becomes a removable row or pill with an × button (`aria-label="Remove <interest>"`) so approval is visible.
    - Add a count above the list: "8 of 10 kept".
7. **Pluralization.** Replace "1 profile excerpt(s) and 12 captions" with proper plurals, or with "We found your bio and 12 captions."
8. **Callout box.** Remove the left tan border on the saved-profile callout. Use a plain inset box: `--cream-2` background, 1px `--line-light` border, 8px radius.
9. **Panels.** Keep the right (interests) panel cream. Optional: make the left (Instagram) panel a dark card (`--bg-raised`, 1px `--line` border) so the interests are the focus.
10. **Buttons.** Primary: `--tan` fill, `--bg` text, 999px radius, min-height 44px. Secondary: transparent, 1px border in `--ink` on cream or `--line` on dark.

## 4. Logo assets

Mark: a hand-drawn ring that tapers and breaks at the top, pierced by a lopsided four-point star, with three constellation dots. Use these SVGs as-is. Give each inline copy a unique mask id.

### Mark on dark (`logo-mark-dark.svg`)

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Destina">
  <defs>
    <mask id="destina-gap"><rect width="100" height="100" fill="#fff"/><circle cx="55" cy="11" r="7.5" fill="#000"/></mask>
  </defs>
  <path d="M50 10 A40 40 0 1 1 49.9 10 Z M47.5 14 A37.5 37.5 0 1 0 47.6 14 Z" fill="#C49A63" fill-rule="evenodd" mask="url(#destina-gap)"/>
  <path d="M54 9 C55 40 60 49 83 53 C61 57 56 62 53 93 C50 62 45 58 25 55 C46 51 51 42 54 9Z" fill="#C49A63"/>
  <circle cx="79" cy="24" r="2.4" fill="#EEEAE0"/>
  <circle cx="86" cy="33" r="1.3" fill="#EEEAE0"/>
  <circle cx="20" cy="77" r="1.7" fill="#EEEAE0"/>
</svg>
```

### Mark on cream (`logo-mark-light.svg`)

Same paths. Ring and dots `#26271F`, star `#9A7244`.

### App icon (`app-icon.svg`, 512 x 512)

Charcoal rounded square (`#262722`, radius 22.5% of size) with the dark mark centered at 73% of the square's width. At 96px and below, drop the three dots.

### Favicon (`favicon.svg`)

Star only, no ring, on a charcoal rounded square:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#262722"/>
  <svg x="3" y="3" width="26" height="26" viewBox="0 0 100 100">
    <path d="M54 3 C56 38 63 47 95 52 C63 57 56 63 52 97 C48 63 42 58 5 55 C42 50 50 40 54 3Z" fill="#C49A63"/>
  </svg>
</svg>
```

### Wordmark

"Destina" in Cormorant Unicase 500, letter-spacing 0.03em, `--text` on dark or `--ink` on cream. Optional: a small star (the favicon star path, 20% of font size, rotated 8deg) over the "i" in `--tan`. If positioning is fiddly, skip the star on the "i"; the mark carries it.

### Tagline

"It's in the stars" in Space Grotesk 400, uppercase, letter-spacing 0.34em, `--text-muted`.

## 5. Accessibility checks

- Body text contrast at least 4.5:1. `--text-muted` on `--bg` passes; check any new combination before shipping.
- Touch targets at least 44px tall, including the × on interest pills.
- Icon-only buttons get an `aria-label`.
