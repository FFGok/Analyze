# Analyze V2.1 — OpenRouter

Analyze supports:

- Image analysis
- PDF analysis
- Text analysis
- Code analysis
- Up to 3 uploaded files
- Structured metrics
- Findings and recommendations
- JSON and Markdown downloads
- Browser PDF export

## Render settings

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Required environment variable:

```text
OPENROUTER_API_KEY=sk-or-v1-...
```

Optional variables:

```text
OPENROUTER_MODEL=openai/gpt-5-mini
OPENROUTER_SITE_URL=https://analyze.ffgok.com
RATE_LIMIT_PER_MINUTE=20
```

The default model is:

```text
openai/gpt-5-mini
```

## GitHub structure

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
