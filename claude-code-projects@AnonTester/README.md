# Claude Code Projects (Cinnamon applet)

Panel applet that lists the projects in `~/.claude/projects`, opens a terminal in the real
project folder and starts Claude Code there.

- New projects are discovered automatically when the menu opens; the real folder is taken from
  the session logs' `cwd` (fallback: filesystem walk, since the folder encoding is lossy).
- Settings > Projects: hide projects (untick *Show*) and rename them (default: last folder name).
- Settings > Extra folders: add arbitrary folders to start Claude Code in.
- Menu entries to edit `~/.claude/CLAUDE.md` and `~/.claude/settings.json` in the preferred text editor.
- *New project...* (bottom of the menu) asks for a name, creates the folder in the configured base
  folder (Settings > General > New project, default `~/Codeprojects`) and starts Claude Code there.
  Spaces become `_`, non-ASCII characters are dropped; an empty name uses `YYYY-MM-DD_HH-MM`.
- Resumes the project's last session by default (`--continue`, only if one exists); switch off in
  Settings > General > Launching.
- Configurable Claude command, terminal template (`{dir}`, `{cmd}`) and editor command.

Install: symlink this folder to `~/.local/share/cinnamon/applets/claude-code-projects@AnonTester`.

Reload using:
'cinnamon-dbus-command ReloadXlet claude-code-projects@AnonTester APPLET'