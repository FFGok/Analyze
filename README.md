# Analyze V2.2 — Final Feature Release

## Added in V2.2

- English / Türkçe / Other report language
- Human Designed / AI Assisted / Fully AI probability bars
- Advanced file information
- Image resolution, aspect ratio and dominant colors
- PDF pages, word count and PDF version
- Code lines, comments and encoding
- Text words, characters and lines
- JSON, Markdown, TXT, CSV, DOCX and PDF export
- Analysis speed
- AI model and provider information
- Local analysis history
- "Analyze Ready" status
- Improved errors, history limit and safer exports

## Render

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Required:

```text
OPENROUTER_API_KEY=sk-or-v1-...
```

Optional:

```text
OPENROUTER_MODEL=openai/gpt-5-mini
OPENROUTER_SITE_URL=https://analyze.ffgok.com
RATE_LIMIT_PER_MINUTE=20
```

## Project structure

```text
Analyze/
├── public/
│   ├── analyze-logo.png
│   ├── index.html
│   ├── script.js
│   └── style.css
├── .env.example
├── .gitignore
├── package.json
├── README.md
└── server.js
```
