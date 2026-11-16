"""Primary MIDNIGHT music browser UI, implemented with Python's Tkinter."""

from __future__ import annotations

import json
import threading
import webbrowser
from pathlib import Path
from tkinter import messagebox, simpledialog, ttk
import tkinter as tk
from urllib.parse import quote
from urllib.request import Request, urlopen

from services.youtube_service import YouTubeSearchError, search_music


class MidnightMusicApp(tk.Tk):
    """Tkinter desktop UI for YouTube search, playlists, and track launching."""

    BG = "#111218"
    SIDEBAR = "#0b0c10"
    PANEL = "#191a22"
    PANEL_LIGHT = "#22232d"
    TEXT = "#f2f1f7"
    MUTED = "#a4a3b2"
    ACCENT = "#b7a8ff"
    PROJECT_ROOT = Path(__file__).resolve().parent
    LIBRARY_FILE = PROJECT_ROOT / ".midnight_library.json"

    def __init__(self) -> None:
        super().__init__()
        self.title("MIDNIGHT — Music, after dark")
        self.geometry("1180x760")
        self.minsize(900, 620)
        self.configure(bg=self.BG)
        self.style = ttk.Style(self)
        self.style.theme_use("clam")
        self._configure_styles()

        self.query = tk.StringVar()
        self.status = tk.StringVar(value="Search YouTube for a song, artist, or album.")
        self.now_playing = tk.StringVar(value="Choose a song to open its official YouTube player.")
        self.library = self._load_library()
        self.results: dict[str, dict[str, str]] = {}
        self.queue: list[dict[str, str]] = []
        self.suggestions: list[str] = []
        self.suggest_after: str | None = None
        self.suggest_generation = 0
        self.current_view = "Discover"
        self._build_ui()
        self._show_view("Discover")

    def _configure_styles(self) -> None:
        self.style.configure("Treeview", background=self.PANEL, fieldbackground=self.PANEL,
                             foreground=self.TEXT, rowheight=46, borderwidth=0,
                             font=("Helvetica Neue", 11))
        self.style.configure("Treeview.Heading", background=self.PANEL_LIGHT,
                             foreground=self.MUTED, relief="flat",
                             font=("Helvetica Neue", 9, "bold"))
        self.style.map("Treeview", background=[("selected", "#40386b")],
                       foreground=[("selected", "white")])
        self.style.configure("TButton", background=self.PANEL_LIGHT, foreground=self.TEXT,
                             bordercolor=self.PANEL_LIGHT, padding=(10, 7),
                             font=("Helvetica Neue", 10))
        self.style.map("TButton", background=[("active", "#3b3655"), ("pressed", "#51477e")],
                       foreground=[("active", "white"), ("pressed", "white")])
        self.style.configure("TScrollbar", background=self.PANEL_LIGHT,
                             troughcolor=self.BG, arrowcolor=self.MUTED,
                             bordercolor=self.BG)

    def _build_ui(self) -> None:
        shell = tk.Frame(self, bg=self.BG)
        shell.pack(fill="both", expand=True)
        self.sidebar = tk.Frame(shell, bg=self.SIDEBAR, width=220, padx=18, pady=22)
        self.sidebar.pack(side="left", fill="y")
        self.sidebar.pack_propagate(False)

        tk.Label(self.sidebar, text="◉  MIDNIGHT", bg=self.SIDEBAR, fg=self.TEXT,
                 font=("Helvetica Neue", 18, "bold")).pack(anchor="w", pady=(2, 30))
        tk.Label(self.sidebar, text="YOUR SPACE", bg=self.SIDEBAR, fg=self.MUTED,
                 font=("Helvetica Neue", 9, "bold")).pack(anchor="w", pady=(0, 8))
        for name in ("Discover", "Search", "Recently Played", "Liked Songs"):
            self._nav_button(name)
        tk.Label(self.sidebar, text="YOUR PLAYLISTS", bg=self.SIDEBAR, fg=self.MUTED,
                 font=("Helvetica Neue", 9, "bold")).pack(anchor="w", pady=(24, 8))
        self.playlist_list = tk.Frame(self.sidebar, bg=self.SIDEBAR)
        self.playlist_list.pack(fill="x")
        ttk.Button(self.sidebar, text="＋  New playlist", command=self._create_playlist).pack(fill="x", pady=(12, 0))
        tk.Label(self.sidebar, text="PYTHON  ·  TKINTER", bg=self.SIDEBAR, fg=self.ACCENT,
                 font=("Helvetica Neue", 8, "bold")).pack(side="bottom", anchor="w")

        main = tk.Frame(shell, bg=self.BG, padx=28, pady=22)
        main.pack(side="left", fill="both", expand=True)
        toolbar = tk.Frame(main, bg=self.BG)
        toolbar.pack(fill="x")
        self.toolbar = toolbar
        tk.Label(toolbar, text="YOUR PERSONAL SOUNDTRACK", bg=self.BG, fg=self.MUTED,
                 font=("Helvetica Neue", 9, "bold")).pack(side="left")
        ttk.Button(toolbar, text="Search", command=self.search).pack(side="right")
        self.search_entry = tk.Entry(toolbar, textvariable=self.query, bg=self.PANEL,
                                     fg=self.TEXT, insertbackground=self.TEXT, relief="flat",
                                     font=("Helvetica Neue", 12), width=34)
        self.search_entry.pack(side="right", ipady=9, padx=(8, 0))
        self.search_entry.bind("<Return>", lambda _event: self.search())
        self.search_entry.bind("<KeyRelease>", self._schedule_suggestions)

        self.suggestion_box = tk.Listbox(main, height=4, bg=self.PANEL_LIGHT, fg=self.TEXT,
                                         selectbackground="#40386b", selectforeground="white",
                                         relief="flat", highlightthickness=0,
                                         font=("Helvetica Neue", 10), activestyle="none")
        self.suggestion_box.bind("<Double-Button-1>", self._use_suggestion)
        self.suggestion_box.bind("<Return>", self._use_suggestion)

        tk.Label(main, text="Find your next favourite", bg=self.BG, fg=self.TEXT,
                 font=("Helvetica Neue", 27, "bold")).pack(anchor="w", pady=(32, 5))
        self.view_label = tk.Label(main, text="Discover music and manage your library.",
                                   bg=self.BG, fg=self.MUTED, font=("Helvetica Neue", 11))
        self.view_label.pack(anchor="w", pady=(0, 18))
        tk.Label(main, textvariable=self.status, bg=self.BG, fg=self.ACCENT,
                 font=("Helvetica Neue", 10)).pack(anchor="w", pady=(0, 10))

        results_frame = tk.Frame(main, bg=self.PANEL, padx=12, pady=12)
        results_frame.pack(fill="both", expand=True)
        self.tree = ttk.Treeview(results_frame, columns=("title", "artist"), show="headings", selectmode="browse")
        self.tree.heading("title", text="TRACK", anchor="w")
        self.tree.heading("artist", text="ARTIST / CHANNEL", anchor="w")
        self.tree.column("title", width=540, anchor="w")
        self.tree.column("artist", width=250, anchor="w")
        scrollbar = ttk.Scrollbar(results_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)
        self.tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        self.tree.bind("<Double-1>", lambda _event: self.play_selected())

        queue_frame = tk.Frame(main, bg=self.BG, pady=8)
        queue_frame.pack(fill="x")
        tk.Label(queue_frame, text="UP NEXT", bg=self.BG, fg=self.MUTED,
                 font=("Helvetica Neue", 9, "bold")).pack(anchor="w", pady=(0, 5))
        queue_row = tk.Frame(queue_frame, bg=self.BG)
        queue_row.pack(fill="x")
        self.queue_list = tk.Listbox(queue_row, height=2, bg=self.PANEL, fg=self.TEXT,
                                     selectbackground="#40386b", selectforeground="white",
                                     relief="flat", highlightthickness=0,
                                     font=("Helvetica Neue", 9), activestyle="none")
        self.queue_list.pack(side="left", fill="x", expand=True, padx=(0, 10))
        queue_actions = tk.Frame(queue_row, bg=self.BG)
        queue_actions.pack(side="right")
        ttk.Button(queue_actions, text="Add selected", command=self._queue_selected).pack(side="left", padx=2)
        ttk.Button(queue_actions, text="Open next", command=self._play_next).pack(side="left", padx=2)
        ttk.Button(queue_actions, text="Remove", command=self._remove_from_queue).pack(side="left", padx=2)
        ttk.Button(queue_actions, text="Clear", command=self._clear_queue).pack(side="left", padx=2)

        actions = tk.Frame(main, bg=self.BG, pady=13)
        actions.pack(fill="x")
        tk.Label(actions, textvariable=self.now_playing, bg=self.BG, fg=self.TEXT,
                 font=("Helvetica Neue", 10, "bold"), anchor="w").pack(side="left", fill="x", expand=True)
        ttk.Button(actions, text="Add to playlist", command=self._add_selected_to_playlist).pack(side="right", padx=(8, 0))
        ttk.Button(actions, text="Like", command=self._like_selected).pack(side="right", padx=(8, 0))
        ttk.Button(actions, text="Open YouTube player", command=self.play_selected).pack(side="right")

        self._refresh_queue()
        self._refresh_playlists()

    def _nav_button(self, name: str) -> None:
        ttk.Button(self.sidebar, text=name, command=lambda: self._show_view(name)).pack(fill="x", pady=2)

    def _load_library(self) -> dict:
        try:
            value = json.loads(self.LIBRARY_FILE.read_text(encoding="utf-8"))
            if isinstance(value, dict):
                value.setdefault("playlists", {})
                value.setdefault("liked", [])
                value.setdefault("recent", [])
                return value
        except (OSError, ValueError):
            pass
        return {"playlists": {"Night drive": [], "Soft focus": [], "Sunday morning": []},
                "liked": [], "recent": []}

    def _save_library(self) -> None:
        try:
            self.LIBRARY_FILE.write_text(json.dumps(self.library, ensure_ascii=False, indent=2), encoding="utf-8")
        except OSError as exc:
            self.status.set(f"Could not save library: {exc}")

    def _refresh_playlists(self) -> None:
        for child in self.playlist_list.winfo_children():
            child.destroy()
        for name in self.library["playlists"]:
            ttk.Button(self.playlist_list, text=f"♫  {name}",
                       command=lambda playlist=name: self._show_view(playlist)).pack(fill="x", pady=2)

    def _show_view(self, name: str) -> None:
        self.current_view = name
        self.view_label.configure(text=f"Browse {name.lower()} in your MIDNIGHT library.")
        if name == "Liked Songs":
            songs = self.library["liked"]
        elif name == "Recently Played":
            songs = self.library["recent"]
        elif name in self.library["playlists"]:
            songs = self.library["playlists"][name]
        else:
            songs = []
        self._populate(songs)
        if songs:
            self.status.set(f"Showing {len(songs)} tracks from {name}.")
        elif name in self.library["playlists"]:
            self.status.set(f"{name} is empty. Search for music, select a result, then add it to a playlist.")
        elif name in {"Liked Songs", "Recently Played"}:
            self.status.set(f"No tracks here yet. Search for music to build {name.lower()}.")
        else:
            self.status.set("Search YouTube for music, or choose a playlist from the left.")

    def _populate(self, songs: list[dict[str, str]]) -> None:
        self.tree.delete(*self.tree.get_children())
        self.results.clear()
        for index, song in enumerate(songs):
            key = f"track-{index}"
            self.results[key] = song
            self.tree.insert("", "end", iid=key, values=(song.get("title", "Untitled"), song.get("artist", "YouTube")))

    def _schedule_suggestions(self, event: tk.Event) -> None:
        if event.keysym in {"Return", "Escape", "Up", "Down"}:
            return
        if self.suggest_after:
            self.after_cancel(self.suggest_after)
            self.suggest_after = None
        query = self.query.get().strip()
        self.suggest_generation += 1
        generation = self.suggest_generation
        if len(query) < 2:
            self.suggestion_box.pack_forget()
            return
        self.suggest_after = self.after(300, lambda: self._fetch_suggestions(query, generation))

    def _fetch_suggestions(self, query: str, generation: int) -> None:
        self.suggest_after = None

        def worker() -> None:
            url = "https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=" + quote(query)
            request = Request(url, headers={"User-Agent": "MIDNIGHT-Tkinter/1.0", "Accept": "application/json"})
            try:
                with urlopen(request, timeout=4) as response:
                    payload = json.loads(response.read().decode("utf-8"))
                items = payload[1] if isinstance(payload, list) and len(payload) > 1 else []
                suggestions = [str(item) for item in items[:6] if str(item).strip()]
            except Exception:
                suggestions = []
            self.after(0, lambda: self._display_suggestions(query, generation, suggestions))

        threading.Thread(target=worker, daemon=True).start()

    def _display_suggestions(self, query: str, generation: int, suggestions: list[str]) -> None:
        if generation != self.suggest_generation or self.query.get().strip() != query:
            return
        self.suggestion_box.delete(0, "end")
        self.suggestions = suggestions
        for suggestion in suggestions:
            self.suggestion_box.insert("end", f"⌕  {suggestion}")
        if suggestions:
            self.suggestion_box.pack(after=self.toolbar, fill="x", pady=(7, 0))
        else:
            self.suggestion_box.pack_forget()

    def _use_suggestion(self, _event: tk.Event | None = None) -> str:
        selection = self.suggestion_box.curselection()
        if selection:
            self.query.set(self.suggestions[selection[0]])
            self.suggestion_box.pack_forget()
            self.search()
        return "break"

    def search(self) -> None:
        query = self.query.get().strip()
        if not query:
            self.status.set("Type a song, artist, or album to search.")
            return
        self.suggestion_box.pack_forget()
        self.current_view = "Search"
        self.view_label.configure(text=f'Search results for “{query}”')
        self.status.set("Searching YouTube…")
        self._populate([])

        def worker() -> None:
            try:
                songs = search_music(query, max_results=18)
                error = ""
            except YouTubeSearchError as exc:
                songs, error = [], str(exc)
            self.after(0, lambda: self._show_search_results(query, songs, error))

        threading.Thread(target=worker, daemon=True).start()

    def _show_search_results(self, query: str, songs: list[dict[str, str]], error: str) -> None:
        if self.query.get().strip() != query:
            return
        self._populate(songs)
        self.status.set(error or f"{len(songs)} playable results. Double-click a track or select it and open YouTube.")

    def _selected_song(self) -> dict[str, str] | None:
        selection = self.tree.selection()
        return self.results.get(selection[0]) if selection else None

    def _refresh_queue(self) -> None:
        self.queue_list.delete(0, "end")
        for index, song in enumerate(self.queue, start=1):
            title = song.get("title", "Untitled")
            artist = song.get("artist", "YouTube")
            self.queue_list.insert("end", f"{index:02d}   {title}  ·  {artist}")

    def _queue_selected(self) -> None:
        song = self._selected_song()
        if not song:
            self.status.set("Select a search result to add it to Up Next.")
            return
        self.queue.append(song)
        self._refresh_queue()
        self.status.set(f"Added to Up Next: {song.get('title', 'Untitled')}")

    def _play_next(self) -> None:
        if not self.queue:
            self.status.set("Your Up Next queue is empty.")
            return
        song = self.queue.pop(0)
        self._refresh_queue()
        self._open_song(song)

    def _remove_from_queue(self) -> None:
        selection = self.queue_list.curselection()
        if not selection:
            self.status.set("Select a queued track to remove it.")
            return
        self.queue.pop(selection[0])
        self._refresh_queue()
        self.status.set("Removed the selected track from Up Next.")

    def _clear_queue(self) -> None:
        self.queue.clear()
        self._refresh_queue()
        self.status.set("Up Next queue cleared.")

    def play_selected(self) -> None:
        song = self._selected_song()
        if not song:
            self.status.set("Select a track first.")
            return
        self._open_song(song)

    def _open_song(self, song: dict[str, str]) -> None:
        video_id = song.get("video_id", "")
        if not video_id:
            return
        url = f"https://www.youtube.com/watch?v={video_id}"
        webbrowser.open(url)
        self.now_playing.set(f"Opened: {song.get('title', 'YouTube track')}")
        self.library["recent"] = [song] + [item for item in self.library["recent"] if item.get("video_id") != video_id]
        self.library["recent"] = self.library["recent"][:60]
        self._save_library()
        self.status.set("The official YouTube player opened in your browser.")

    def _like_selected(self) -> None:
        song = self._selected_song()
        if not song:
            self.status.set("Select a track to like.")
            return
        liked = self.library["liked"]
        if not any(item.get("video_id") == song.get("video_id") for item in liked):
            liked.insert(0, song)
            self._save_library()
        self.status.set("Added to Liked Songs.")

    def _create_playlist(self) -> None:
        name = simpledialog.askstring("New playlist", "Playlist name:", parent=self)
        if not name or not name.strip():
            return
        name = name.strip()
        if name in self.library["playlists"]:
            messagebox.showinfo("MIDNIGHT", "That playlist already exists.", parent=self)
            return
        self.library["playlists"][name] = []
        self._save_library()
        self._refresh_playlists()
        self.status.set(f"Created playlist: {name}")

    def _add_selected_to_playlist(self) -> None:
        song = self._selected_song()
        if not song:
            self.status.set("Select a track to add.")
            return
        names = list(self.library["playlists"])
        if not names:
            self._create_playlist()
            names = list(self.library["playlists"])
        if not names:
            return
        name = simpledialog.askstring("Add to playlist", "Enter playlist name:\n" + ", ".join(names), parent=self)
        if not name or name not in self.library["playlists"]:
            self.status.set("Playlist not found. Use New playlist to create one.")
            return
        playlist = self.library["playlists"][name]
        if not any(item.get("video_id") == song.get("video_id") for item in playlist):
            playlist.append(song)
            self._save_library()
        self.status.set(f"Added to {name}.")


if __name__ == "__main__":
    MidnightMusicApp().mainloop()
