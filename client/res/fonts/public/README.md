# Public website fonts

Locally hosted Latin WOFF2 subsets downloaded from Google Fonts on 2026-10-30:

- Instrument Sans: variable weights 400–700
- JetBrains Mono: variable weights 400–500
- Lexend: variable weights 400–800
- Montserrat: variable weights 400–700

Each font's SIL Open Font License is included alongside its binary. Source families and licenses: https://github.com/google/fonts/tree/main/ofl (instrumentsans, jetbrainsmono, lexend, montserrat).

`client/publicFonts.scss` declares these files with `font-display: swap`. The main application and server-rendered landing pages share the generated `main.css`; font files are requested only when used. Characters outside the Latin subsets use the existing system fallback stack.
