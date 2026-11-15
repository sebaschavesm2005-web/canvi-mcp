---
description: Design anything with Canvi (poster, infographic, social post, slide, A4 document)
argument-hint: <what to design, or the id of a design to edit>
---

Use the Canvi connector (the `canvi` MCP server, tools `get_schema`, `create_design`, `read_design`, `edit_design`, `export_design`, `open_editor`, `list_designs`) to do this: $ARGUMENTS

If no request was given, call `list_designs` and ask what to design or which existing design to continue.

Workflow:
1. New design: call `get_schema` once, then `create_design` with real content. Use the exact texts the person gave you, never paraphrase numbers or names. Give elements readable ids such as "title" or "chart" so later edits are precise.
2. Look at the preview image that comes back. Check for overlapping boxes (the reply lists the measured height of every text box), text that is too small to read, and unbalanced spacing. Fix problems with `edit_design`.
3. Existing design: call `read_design` first, because the person may have changed it by hand in the editor. Then edit.
4. When it looks right, offer `open_editor` so they can adjust it by hand, and `export_design` (png, jpeg or pdf) when they want a file.

Answer in the language the person writes in.
