# Canvi

A design editor that Claude can drive. You ask for a poster, an infographic, an Instagram post, a slide or an A4 document; Claude builds it, looks at its own result, fixes it, and exports a PNG, JPEG or PDF. At any point you can open the design in a visual editor (drag, restyle, add things) and Claude will see your changes.

Canvi es un editor de diseño que Claude puede manejar. Le pides un afiche, una infografía, una publicación, una diapositiva o un documento A4; Claude lo arma, revisa su propio resultado, lo corrige y lo exporta a PNG, JPEG o PDF. Cuando quieras, abres el diseño en el editor visual para tocarlo a mano y Claude ve tus cambios.

Everything runs on your computer. No account, no API key, no dependencies to install.

## Requirements

- Node.js 22 or newer
- Google Chrome, Microsoft Edge or Chromium (used invisibly to render the designs; set `CHROME_PATH` if it is not found)
- Internet access for the fonts (Google Fonts)

## Install

### Claude Code (two commands)

```bash
claude plugin marketplace add sebaschavesm2005-web/canvi-mcp
claude plugin install canvi@canvi
```

Start a new session and type `/canvi`, for example:

```
/canvi infographic comparing two bus systems, 1080x1350, blue palette
```

### Claude Desktop, Cursor and other MCP clients

Download this repository and add the server to the client's MCP configuration:

```json
{
  "mcpServers": {
    "canvi": { "command": "node", "args": ["/full/path/to/canvi-mcp/server.mjs"] }
  }
}
```

On Windows write the path with double backslashes, for example `C:\\Users\\you\\canvi-mcp\\server.mjs`.

## What Claude can do with it

| Tool | What it does |
| --- | --- |
| `get_schema` | Element types, fonts, presets, shapes, icons, effects and templates |
| `create_design` | New design from pages and elements, a preset size or a template; returns a preview |
| `read_design` | Outline of a design (ids, positions, texts) plus a preview, including your manual changes |
| `edit_design` | Replace text, move or restyle elements, add or delete elements and pages, resize the canvas |
| `export_design` | PNG, JPEG or PDF (each PDF page has exactly the canvas size) |
| `open_editor` | Opens the design in the visual editor in your browser |
| `list_designs`, `duplicate_design`, `delete_design` | Housekeeping (delete moves to a trash folder) |

Elements: shapes (16 kinds), text with effects, lines, images, icons, tables, charts (column, bar, line, pie, donut) and free drawing. Text height is automatic and reported back, so Claude can detect overlaps.

## Where things live

By default in `~/Canvi`: `designs/` (one `.canvi.json` per design), `exports/`, `trash/`. Change it with the `CANVI_DIR` environment variable. The visual editor is served only on `127.0.0.1` (port 8787, or the next free one; `CANVI_PORT` changes it) and exists while the MCP server is running, that is, while Claude is open. A design file can also be opened directly in `editor/canvi.html` with the open button.

## Limits

- It is a local connector. It does not work in the claude.ai web chat, which cannot reach your computer.
- PDFs contain the rendered pages as images, so the text in them cannot be selected.
- Fonts come from Google Fonts; offline, the editor falls back to a system font.

## Development

The editor is a single HTML file (`editor/canvi.html`); the server is a single file with no dependencies (`server.mjs`). Run `node server.mjs --version` to check the install.

## License

MIT
