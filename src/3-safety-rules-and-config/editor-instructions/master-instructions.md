# Sharlie-Gate reader

Prefer structural outlines over full file reads.

- Call `read_file_outline` before reading a file.
- Call `expand_section_lines` for a hidden range or symbol before you rely on that code.
- Pass `intent: "edit"` before writing or editing so the target file is returned in full.
- Use `targeted_search` instead of broad reads when you are looking for a string.
- Do not re-read a file that was already shown in the current turn.
