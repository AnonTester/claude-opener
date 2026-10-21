/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */

const Lang = imports.lang;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const St = imports.gi.St;
const Applet = imports.ui.applet;
const ModalDialog = imports.ui.modalDialog;
const PopupMenu = imports.ui.popupMenu;
const Settings = imports.ui.settings;

const UUID = "claude-code-projects@AnonTester";
const TITLE = "Claude Code Projects";

function _(str) { return str; }

function _quote(arg) {
    return "'" + String(arg).replace(/'/g, "'\\''") + "'";
}

function _stripFileUri(path) {
    path = String(path || "");
    if (/^file:\/\//.test(path)) path = decodeURIComponent(path.substr(7));
    return path;
}

function _basename(path) {
    let trimmed = String(path).replace(/\/+$/, "");
    if (trimmed === "") return "/";
    return trimmed.substr(trimmed.lastIndexOf("/") + 1);
}

// Claude Code names a project folder after the project path, with every
// character that is not a letter or digit replaced by "-".
function _encodePath(path) {
    return String(path).replace(/[^a-zA-Z0-9]/g, "-");
}

function _listDirs(path) {
    let names = [];
    try {
        let enumerator = Gio.file_new_for_path(path).enumerate_children("standard::name,standard::type", Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) != null) {
            if (info.get_file_type() == Gio.FileType.DIRECTORY) names.push(info.get_name());
        }
        enumerator.close(null);
    } catch (e) {
        // unreadable directory: nothing to descend into
    }
    return names;
}

// The encoding is lossy ("/", "-", "." and "_" all become "-"). The session
// logs record the real working directory, so use that when it matches.
function _cwdFromSessions(projectPath, encoded) {
    try {
        let dir = Gio.file_new_for_path(projectPath);
        let enumerator = dir.enumerate_children("standard::name,time::modified", Gio.FileQueryInfoFlags.NONE, null);
        let files = [];
        let info;
        while ((info = enumerator.next_file(null)) != null) {
            if (/\.jsonl$/.test(info.get_name())) files.push({ name: info.get_name(), time: info.get_modification_time().tv_sec });
        }
        enumerator.close(null);
        files.sort(function(a, b) { return b.time - a.time; });

        for (let i = 0; i < files.length && i < 3; i++) {
            let stream = dir.get_child(files[i].name).read(null);
            let bytes = stream.read_bytes(65536, null);
            stream.close(null);
            let text = imports.byteArray.toString(bytes.get_data());
            let re = /"cwd":\s*("(?:[^"\\]|\\.)*")/g;
            let m;
            while ((m = re.exec(text)) !== null) {
                let cwd = JSON.parse(m[1]);
                if (cwd.charAt(0) == "/" && _encodePath(cwd) == encoded) return cwd;
            }
        }
    } catch (e) {
        // no usable session log
    }
    return null;
}

// Fallback: walk the filesystem and match encoded folder names. When the
// folder no longer exists, the deepest existing parent plus the remainder
// (as a single folder name) is the most likely path.
function _walkProjectDir(encoded) {
    let best = { depth: -1, path: null };

    function walk(base, depth, rest) {
        if (depth > best.depth) best = { depth: depth, path: (base == "/" ? "" : base) + "/" + rest };

        let candidates = _listDirs(base).map(function(name) {
            return { name: name, enc: _encodePath(name) };
        }).filter(function(c) {
            return rest == c.enc || rest.indexOf(c.enc + "-") === 0;
        });
        candidates.sort(function(a, b) { return b.enc.length - a.enc.length; });

        for (let i = 0; i < candidates.length; i++) {
            let c = candidates[i];
            let child = (base == "/" ? "" : base) + "/" + c.name;
            if (rest == c.enc) return child;
            let found = walk(child, depth + 1, rest.substr(c.enc.length + 1));
            if (found !== null) return found;
        }
        return null;
    }

    let found = walk("/", 0, encoded.substr(1));
    return found !== null ? found : best.path;
}

function _decodeProjectDir(projectsDir, encoded) {
    if (encoded.charAt(0) != "-") return null;
    let cwd = _cwdFromSessions(GLib.build_filenamev([projectsDir, encoded]), encoded);
    return cwd !== null ? cwd : _walkProjectDir(encoded);
}

function _latestModification(path) {
    let latest = 0;
    try {
        let dir = Gio.file_new_for_path(path);
        let enumerator = dir.enumerate_children("time::modified", Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) != null) {
            let t = info.get_modification_time().tv_sec;
            if (t > latest) latest = t;
        }
        enumerator.close(null);
        if (latest == 0) latest = dir.query_info("time::modified", Gio.FileQueryInfoFlags.NONE, null).get_modification_time().tv_sec;
    } catch (e) {
        // ignore, sorts last
    }
    return latest;
}

function _hasSessions(projectsDir, path) {
    try {
        let dir = Gio.file_new_for_path(GLib.build_filenamev([projectsDir, _encodePath(path)]));
        let enumerator = dir.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) != null) {
            if (info.get_name().slice(-6) == ".jsonl") {
                enumerator.close(null);
                return true;
            }
        }
        enumerator.close(null);
    } catch (e) {
        // no session folder for this path
    }
    return false;
}

function _isDir(path) {
    return GLib.file_test(path, GLib.FileTest.IS_DIR);
}

// Folder name for a new project: accents are dropped (é -> e), whitespace
// becomes "_" and everything that is not printable ASCII (or is "/") is removed.
function _normalizeProjectName(name) {
    return String(name || "")
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .replace(/[^\x21-\x7e]|\//g, "")
        .replace(/^[._]+|[._]+$/g, "");
}

function _timestampName() {
    return GLib.DateTime.new_now_local().format("%Y-%m-%d_%H-%M");
}

function FolderMenuItem(applet, entry) {
    this._init(applet, entry);
}

FolderMenuItem.prototype = {
    __proto__: PopupMenu.PopupMenuItem.prototype,

    _init: function(applet, entry) {
        PopupMenu.PopupMenuItem.prototype._init.call(this, entry.name);
        this.applet = applet;
        this.entry = entry;

        if (applet.showpaths) {
            let pathLabel = new St.Label({ text: entry.path, style_class: "claude-code-projects-path" });
            this.addActor(pathLabel, { span: -1, align: St.Align.END });
        }

        this.connect("activate", Lang.bind(this, function() {
            this.applet.openClaude(this.entry);
        }));
    }
};

function MyApplet(metadata, orientation, panelHeight, instance_id) {
    this._init(metadata, orientation, panelHeight, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function(metadata, orientation, panelHeight, instance_id) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panelHeight, instance_id);

        this.metadata = metadata;
        this.settings = new Settings.AppletSettings(this, metadata.uuid, this.instance_id);
        this.settings.bind("claudecommand", "claudecommand");
        this.settings.bind("resumelast", "resumelast");
        this.settings.bind("keepterminalopen", "keepterminalopen");
        this.settings.bind("terminalcommand", "terminalcommand");
        this.settings.bind("editorcommand", "editorcommand");
        this.settings.bind("sortmode", "sortmode");
        this.settings.bind("showpaths", "showpaths");
        this.settings.bind("projects", "projects");
        this.settings.bind("extrafolders", "extrafolders");
        this.settings.bind("newprojectsdir", "newprojectsdir");

        this.projectsDir = GLib.build_filenamev([GLib.get_home_dir(), ".claude", "projects"]);

        this._setAppletIcon();
        this.set_applet_label("");
        this.set_applet_tooltip(_(TITLE));

        try {
            this.menuManager = new PopupMenu.PopupMenuManager(this);
            this.menu = new Applet.AppletPopupMenu(this, orientation);
            this.menuManager.addMenu(this.menu);
        } catch (e) {
            global.logError(e);
        }
    },

    on_applet_removed_from_panel: function() {
        this.settings.finalize();
    },

    _setAppletIcon: function() {
        let iconPath = GLib.build_filenamev([this.metadata.path, "icon.svg"]);
        if (GLib.file_test(iconPath, GLib.FileTest.EXISTS)) this.set_applet_icon_path(iconPath);
        else this.set_applet_icon_name("utilities-terminal");
    },

    on_applet_clicked: function(event) {
        if (!this.menu.isOpen) this._updateMenu();
        this.menu.toggle();
    },

    _showNotify: function(message) {
        try {
            GLib.spawn_command_line_async("notify-send " + _quote(_(TITLE)) + " " + _quote(String(message)));
        } catch (e) {
            global.logError(e);
        }
    },

    // ---- data ---------------------------------------------------------

    // Adds newly discovered ~/.claude/projects folders to the settings list
    // and returns the ones that should be shown, with their last-use time.
    _collectProjects: function() {
        let known = {};
        let list = (this.projects || []).slice();
        for (let i = 0; i < list.length; i++) {
            list[i].path = _stripFileUri(list[i].path);
            known[_encodePath(list[i].path)] = list[i];
        }

        let found = {};
        let added = false;
        let projectsDir = this.projectsDir;
        _listDirs(projectsDir).forEach(function(dirName) {
            found[dirName] = true;
            if (known[dirName]) return;
            let path = _decodeProjectDir(projectsDir, dirName);
            if (path === null) return;
            let entry = { enabled: true, name: _basename(path), path: path };
            list.push(entry);
            known[dirName] = entry;
            added = true;
        });
        if (added) this.projects = list;

        let result = [];
        for (let dirName in found) {
            let entry = known[dirName];
            if (!entry || !entry.enabled || !_isDir(entry.path)) continue;
            result.push({
                name: entry.name || _basename(entry.path),
                path: entry.path,
                recent: _latestModification(GLib.build_filenamev([this.projectsDir, dirName]))
            });
        }
        return result;
    },

    _collectExtraFolders: function() {
        let result = [];
        let list = this.extrafolders || [];
        for (let i = 0; i < list.length; i++) {
            let path = _stripFileUri(list[i].path);
            if (!list[i].enabled || path === "" || !_isDir(path)) continue;
            result.push({ name: list[i].name || _basename(path), path: path });
        }
        return result;
    },

    // ---- menu ---------------------------------------------------------

    _updateMenu: function() {
        this.menu.removeAll();

        let projects = [];
        try {
            projects = this._collectProjects();
        } catch (e) {
            global.logError(e);
        }
        if (this.sortmode == "name") {
            projects.sort(function(a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : (a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0); });
        } else {
            projects.sort(function(a, b) { return b.recent - a.recent; });
        }
        let extras = this._collectExtraFolders();

        projects.forEach(Lang.bind(this, function(entry) {
            this.menu.addMenuItem(new FolderMenuItem(this, entry));
        }));
        if (projects.length > 0 && extras.length > 0) this._addSeparator();
        extras.forEach(Lang.bind(this, function(entry) {
            this.menu.addMenuItem(new FolderMenuItem(this, entry));
        }));
        if (projects.length == 0 && extras.length == 0) this._addInfoItem(_("No Claude Code projects found"));

        this._addSeparator();
        this._addActionItem(_("Edit ~/.claude/CLAUDE.md"), "document-edit-symbolic", Lang.bind(this, function() {
            this._editFile(GLib.build_filenamev([GLib.get_home_dir(), ".claude", "CLAUDE.md"]));
        }));
        this._addActionItem(_("Edit ~/.claude/settings.json"), "document-edit-symbolic", Lang.bind(this, function() {
            this._editFile(GLib.build_filenamev([GLib.get_home_dir(), ".claude", "settings.json"]));
        }));

        this._addSeparator();
        this._addActionItem(_("New project..."), "folder-new-symbolic", Lang.bind(this, this._newProject));
    },

    _addSeparator: function() {
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    },

    _addInfoItem: function(text) {
        let item = new PopupMenu.PopupMenuItem(text, { reactive: false });
        item.label.add_style_class_name("claude-code-projects-info");
        this.menu.addMenuItem(item);
    },

    _addActionItem: function(text, iconName, callback) {
        let item = new PopupMenu.PopupIconMenuItem(text, iconName, St.IconType.SYMBOLIC);
        item.connect("activate", callback);
        this.menu.addMenuItem(item);
    },

    // ---- actions ------------------------------------------------------

    openClaude: function(entry) {
        try {
            let claude = (this.claudecommand || "").trim() || "claude";
            // --continue fails in a folder without sessions, so only add it where one exists.
            if (this.resumelast && !/\s(--continue|-c|--resume|-r)(\s|=|$)/.test(" " + claude) &&
                _hasSessions(this.projectsDir, entry.path)) {
                claude += " --continue";
            }
            let command = this.keepterminalopen ? claude + "; exec \"${SHELL:-bash}\"" : claude;
            let argv;

            let template = (this.terminalcommand || "").trim();
            if (template != "") {
                let line = template.replace(/\{dir\}/g, _quote(entry.path)).replace(/\{cmd\}/g, _quote(command));
                argv = GLib.shell_parse_argv(line)[1];
            } else {
                argv = this._defaultTerminalArgv(entry.path, command);
            }
            GLib.spawn_async(entry.path, argv, this._spawnEnvironment(), GLib.SpawnFlags.SEARCH_PATH, null);
        } catch (e) {
            global.logError(e);
            this._showNotify(e);
        }
    },

    _newProjectsBase: function() {
        let base = _stripFileUri(this.newprojectsdir).trim();
        if (base == "") base = "~/Codeprojects";
        if (base == "~" || base.indexOf("~/") === 0) base = GLib.get_home_dir() + base.substr(1);
        return base.replace(/(.)\/+$/, "$1");
    },

    _newProject: function() {
        this._promptProjectName(Lang.bind(this, function(input) {
            try {
                let name = _normalizeProjectName(input);
                if (name == "") name = _timestampName();

                let path = GLib.build_filenamev([this._newProjectsBase(), name]);
                GLib.mkdir_with_parents(path, 493);
                if (!_isDir(path)) throw new Error(_("Could not create folder ") + path);

                this.openClaude({ name: name, path: path });
            } catch (e) {
                global.logError(e);
                this._showNotify(e);
            }
        }));
    },

    _promptProjectName: function(callback) {
        let dialog = new ModalDialog.ModalDialog();

        dialog.contentLayout.add_child(new St.Label({ text: _("New project") }));
        let entry = new St.Entry({
            hint_text: _("Project name (empty = current date and time)"),
            style_class: "claude-code-projects-entry",
            can_focus: true
        });
        dialog.contentLayout.add_child(entry);

        let submit = function() {
            let text = entry.get_text();
            dialog.close();
            callback(text);
        };
        entry.clutter_text.connect("activate", submit);

        dialog.setButtons([
            { label: _("Cancel"), action: function() { dialog.close(); }, key: Clutter.KEY_Escape },
            { label: _("Create"), action: submit, default: true }
        ]);
        dialog.setInitialKeyFocus(entry.clutter_text);
        dialog.open();
    },

    // When Cinnamon was (re)started from a gnome-terminal tab it keeps that
    // tab's GNOME_TERMINAL_* variables. Once the tab is closed they are stale
    // and gnome-terminal refuses to open any window ("Failed to get screen
    // from object path"), so do not pass them on. Likewise, if Cinnamon was
    // restarted from inside a Claude Code session it carries that session's
    // CLAUDE_* markers, which make every new claude think it is a child
    // session and disable transcript saving.
    _spawnEnvironment: function() {
        let envp = GLib.get_environ();
        ["GNOME_TERMINAL_SCREEN", "GNOME_TERMINAL_SERVICE",
         "CLAUDECODE", "AI_AGENT", "CLAUDE_PID", "CLAUDE_EFFORT",
         "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ATTENDED",
         "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH",
         "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN"].forEach(function(name) {
            envp = GLib.environ_unsetenv(envp, name);
        });
        return envp;
    },

    _defaultTerminalArgv: function(dir, command) {
        let terminal = "x-terminal-emulator";
        let execArg = "-e";
        try {
            let schema = "org.cinnamon.desktop.default-applications.terminal";
            let source = Gio.SettingsSchemaSource.get_default();
            if (source.lookup(schema, true)) {
                let s = new Gio.Settings({ schema_id: schema });
                if (s.get_string("exec") != "") {
                    terminal = s.get_string("exec");
                    execArg = s.get_string("exec-arg");
                }
            }
        } catch (e) {
            global.logError(e);
        }

        let argv = terminal.split(/\s+/);
        if (_basename(argv[0]) == "gnome-terminal") {
            argv.push("--working-directory=" + dir);
            execArg = "--";
        }
        if (execArg != "") argv.push(execArg);
        return argv.concat(["bash", "-ic", command]);
    },

    _editFile: function(path) {
        try {
            if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
                GLib.mkdir_with_parents(GLib.path_get_dirname(path), 493);
                Gio.file_new_for_path(path).create(Gio.FileCreateFlags.NONE, null).close(null);
            }

            let editor = (this.editorcommand || "").trim();
            if (editor != "") {
                GLib.spawn_command_line_async(editor + " " + _quote(path));
                return;
            }

            let app = Gio.AppInfo.get_default_for_type("text/plain", false);
            if (app) app.launch([Gio.file_new_for_path(path)], null);
            else GLib.spawn_command_line_async("xdg-open " + _quote(path));
        } catch (e) {
            global.logError(e);
            this._showNotify(e);
        }
    }
};

function main(metadata, orientation, panelHeight, instance_id) {
    return new MyApplet(metadata, orientation, panelHeight, instance_id);
}
