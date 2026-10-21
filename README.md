# claude-opener

Two ways to open a [Claude Code](https://claude.com/claude-code) project from the places you already are:

- **`ccopen`** – a bash script with an ncurses project picker for the terminal.
- **Claude Code Projects** – a Cinnamon panel applet that opens a terminal in a project and starts Claude Code there.

Both read the projects Claude Code keeps in `~/.claude/projects`, list them by last access (newest first) and
resume the project's last session (`--continue`) when one exists.

## ccopen

Without arguments it shows a list of your Claude Code projects (name, age, path). Pick one and Claude Code
starts in that folder. The menu is drawn on the alternate screen, so your terminal is restored on exit.

```
ccopen                 # pick from a list
ccopen NAME|PATH       # open a project directly
ccopen -l              # print the projects, last used first
ccopen -n [NAME]       # create NAME in ~/Codeprojects (default: date and time) and open it
ccopen -f              # start a fresh session instead of continuing the last one
ccopen -h              # help
```

Environment variables:

| Variable         | Default           | Meaning                          |
|------------------|-------------------|----------------------------------|
| `CCOPEN_CLAUDE`  | `claude`          | Command used to start Claude Code |
| `CCOPEN_NEW_DIR` | `~/Codeprojects`  | Base folder for new projects      |

Requirements: bash, `claude` on the PATH, and `dialog` or `whiptail` for the menu (a plain numbered menu is used
if neither is installed).

### Install

```sh
git clone https://github.com/AnonTester/claude-opener.git
cd claude-opener
mkdir -p ~/.local/bin
ln -s "$PWD/ccopen" ~/.local/bin/ccopen     # or copy the file
```

Make sure `~/.local/bin` is in your `PATH`.

## Cinnamon applet

Panel applet that lists the projects, opens a terminal in the real project folder and starts Claude Code there.

- New projects are discovered automatically when the menu opens; the real folder is taken from the session
  logs' `cwd` (fallback: filesystem walk, since the folder encoding is lossy).
- Settings > Projects: hide projects and rename them. Settings > Extra folders: add arbitrary folders.
- Menu entries to edit `~/.claude/CLAUDE.md` and `~/.claude/settings.json`.
- *New project...* asks for a name, creates the folder in the configured base folder (default `~/Codeprojects`)
  and starts Claude Code there.
- Configurable Claude command, terminal command template (`{dir}`, `{cmd}`) and editor command.

### Install

```sh
git clone https://github.com/AnonTester/claude-opener.git
cd claude-opener
ln -s "$PWD/claude-code-projects@AnonTester" ~/.local/share/cinnamon/applets/claude-code-projects@AnonTester
```

Then right-click the panel > Applets and add *Claude Code Projects*. After changing the code, reload with:

```sh
cinnamon-dbus-command ReloadXlet claude-code-projects@AnonTester APPLET
```
