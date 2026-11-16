(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const pageContent = $('#page-content');
  const contentScroll = $('#content-scroll');
  const playbackStage = $('#playback-stage');
  const suggestionsBox = $('#suggestions');
  const toastBox = $('#toast');
  const paletteNames = ['art-amber', 'art-blue', 'art-pink', 'art-green', 'art-orange', 'art-indigo'];
  const defaultPlaylists = ['Cover', 'Night drive', 'Soft focus', 'Sunday morning'];
  const featuredArtists = [
    ['JB', 'Justin Bieber', '#b985cd', '#f2b7bd', '52M plays'],
    ['BTS', 'BTS', '#59b7c7', '#e3d986', '48M plays'],
    ['BE', 'Billie Eilish', '#cbbd54', '#f1e899', '36M plays'],
    ['CP', 'Charlie Puth', '#eab09a', '#b2d7d5', '31M plays'],
    ['ES', 'Ed Sheeran', '#7196c5', '#d9aa9a', '28M plays'],
    ['BP', 'BLACKPINK', '#ba7d9d', '#26253d', '25M plays'],
  ];
  const collections = [
    ['art-amber', 'Velvet Hours', 'A quiet kind of glow', 'MIDNIGHT MIX · 01', 'The softer side of the night'],
    ['art-blue', 'Blue in Green', 'Late night essentials', 'MIDNIGHT MIX · 02', 'Warm piano and after-hours soul'],
    ['art-pink', 'Soft Focus', 'Ease into the evening', 'MIDNIGHT MIX · 03', 'Gentle songs for a slower pace'],
    ['art-green', 'Open Air', 'A little room to breathe', 'MIDNIGHT MIX · 04', 'Acoustic favourites and fresh air'],
  ];
  const weeklySongs = [
    ['Anyone', 'Justin Bieber', '3:11', 'art-indigo'],
    ['What Other People Say', 'Demi Lovato', '3:47', 'art-blue'],
    ['Dynamite', 'BTS', '4:05', 'art-orange'],
    ['Selfish Love', 'Selena Gomez', '3:31', 'art-pink'],
  ];
  const genres = ['Hip Hop', 'Electro Pop', 'Jazz', 'Indie', 'Dance Beat', 'Classical', 'Metal', 'Rock', 'Country'];

  let activePage = 'Discover';
  let resultItems = [];
  let trackMap = new Map();
  let queue = [];
  let currentIndex = -1;
  let currentSong = null;
  let player = null;
  let playerReady = false;
  let requestedVideoId = null;
  let autoPlayWhenReady = false;
  let youtubeApiLoaded = false;
  let userMuted = false;
  let isPlaying = false;
  let repeatCurrent = false;
  let shuffleEnabled = false;
  let suggestTimer = null;
  let suggestGeneration = 0;
  let toastTimer = null;
  let progressTimer = null;
  let playlistSongId = null;
  let bridgePromise = null;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function readJSON(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value ?? fallback;
    } catch (_error) { return fallback; }
  }

  function getPlaylists() {
    const stored = readJSON('midnight.playlists', {});
    const playlists = {};
    for (const name of defaultPlaylists) playlists[name] = Array.isArray(stored[name]) ? stored[name] : [];
    for (const [name, songs] of Object.entries(stored)) {
      if (name && Array.isArray(songs)) playlists[name] = songs;
    }
    return playlists;
  }

  function savePlaylists(playlists) {
    localStorage.setItem('midnight.playlists', JSON.stringify(playlists));
    renderPlaylistNav();
  }

  function readTrackList(key) {
    const value = readJSON(key, []);
    return Array.isArray(value) ? value.filter((item) => item && item.video_id) : [];
  }

  function rememberTrack(key, song, max = 60) {
    const items = readTrackList(key).filter((item) => item.video_id !== song.video_id);
    items.unshift(song);
    localStorage.setItem(key, JSON.stringify(items.slice(0, max)));
  }

  function isLiked(song) {
    return readTrackList('midnight.liked').some((item) => item.video_id === song?.video_id);
  }

  function coverMarkup(palette = 'art-amber', extra = '') {
    return `<span class="cover-art ${palette} ${extra}"><span class="cover-sun"></span><span class="cover-orbit"></span><span class="cover-line"></span><b>M / 01</b></span>`;
  }

  function setArtwork(element, song, palette = 'art-amber') {
    if (!element) return;
    const extraClasses = [...element.classList].filter((name) => name !== 'cover-art' && !paletteNames.includes(name));
    element.className = ['cover-art', palette, ...extraClasses].join(' ');
    const url = String(song?.thumbnail_url || '');
    if (/^https:\/\/(i\.ytimg\.com|yt3\.ggpht\.com)\//i.test(url)) {
      element.innerHTML = `<img alt="" src="${esc(url)}">`;
    } else {
      element.innerHTML = '<span class="cover-sun"></span><span class="cover-orbit"></span><span class="cover-line"></span><b>M / 01</b>';
    }
  }

  function prettyTime(value) {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const seconds = Math.floor(value);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function updateRangeLook(input) {
    if (!input) return;
    const min = Number(input.min) || 0;
    const max = Number(input.max) || 100;
    const value = Number(input.value) || 0;
    const percentage = Math.max(0, Math.min(100, (value - min) / Math.max(1, max - min) * 100));
    input.style.setProperty('--range-progress', `${percentage}%`);
  }

  function showToast(message) {
    toastBox.textContent = message;
    toastBox.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastBox.classList.add('hidden'), 2600);
  }

  function getBridge() {
    if (window.pywebview?.api) return Promise.resolve(window.pywebview.api);
    if (!bridgePromise) {
      bridgePromise = new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 8000);
        window.addEventListener('pywebviewready', () => {
          clearTimeout(timeout);
          resolve(window.pywebview?.api || null);
        }, { once: true });
      });
    }
    return bridgePromise;
  }

  function renderDiscover() {
    pageContent.className = 'page-content discover-view';
    pageContent.innerHTML = `
      <div class="page-heading"><div><span class="eyebrow">YOUR PERSONAL SOUNDTRACK</span><h1>Good evening.</h1></div><button class="text-button" data-page="My Music">Your library <span>↗</span></button></div>
      <section class="hero">
        <div class="hero-copy"><span class="eyebrow">MIDNIGHT SELECTS · 01</span><h2>Music that meets you where you are.</h2><p>Find the songs you love, build a playlist, and let the evening find its rhythm.</p><button class="primary-button" data-page="Search">Explore music&nbsp; ↗</button></div>
        <div class="hero-shape" aria-hidden="true"></div><span class="hero-note">MADE FOR THE MOMENT</span>
      </section>
      <section class="section-block"><div class="section-header"><h2>Top artists</h2><button class="text-button" data-page="Artists">More list <span>↗</span></button></div><div class="artist-row">${featuredArtists.map(([initials, name, a, b, plays]) => `<button class="artist-card" data-search-query="${esc(name)}"><span class="artist-avatar" style="--color-a:${a};--color-b:${b}">${esc(initials)}</span><strong>${esc(name)}</strong><small>${esc(plays)}</small></button>`).join('')}</div></section>
      <section class="section-block"><div class="section-header"><h2>Top collection</h2><button class="text-button" data-page="Explorer">More list <span>↗</span></button></div><div class="collection-grid">${collections.map(([palette, title, subtitle, eyebrow, description]) => `<button class="collection-card" data-search-query="${esc(title)} music mix"><span class="cover-art collection-art ${palette}"><span class="cover-sun"></span><span class="cover-orbit"></span><span class="cover-line"></span><b>M / 01</b></span><span class="collection-copy"><span class="eyebrow">${esc(eyebrow)}</span><h3>${esc(title)}</h3><p>${esc(description || subtitle)}</p></span><span class="collection-play">▶</span></button>`).join('')}</div></section>
      <section class="section-block"><div class="section-header"><h2>Find your genre</h2><button class="text-button" data-page="Explorer">Explore all <span>↗</span></button></div><div class="genre-row">${genres.map((genre) => `<button class="genre-chip" data-search-query="${esc(genre)} music">${esc(genre)}</button>`).join('')}</div></section>
      <section class="section-block"><div class="section-header"><h2>Recently played</h2><button class="text-button" data-page="My Music">View all <span>↗</span></button></div>${trackRows(readTrackList('midnight.recent').slice(0, 4), 'Your recent listening will show up here.')}</section>`;
  }

  function trackRows(items, emptyMessage) {
    if (!items.length) return `<div class="state-box empty-library"><div><span class="state-icon">♫</span>${esc(emptyMessage)}</div></div>`;
    return `<div class="result-list">${items.map((song, index) => {
      trackMap.set(song.video_id, song);
      return `<div class="result-row"><img class="result-thumb" src="${esc(song.thumbnail_url || '')}" alt="" onerror="this.style.visibility='hidden'"><div class="result-copy"><h3>${esc(song.title)}</h3><p>${esc(song.artist || 'YouTube')}</p></div><button class="round-add" data-add="${esc(song.video_id)}" title="Add to playlist">＋</button><button class="play-small" data-play="${esc(song.video_id)}">▶ PLAY</button></div>`;
    }).join('')}</div>`;
  }

  function renderSearch(items = null, query = '') {
    pageContent.className = 'page-content search-view';
    const showResults = Array.isArray(items);
    pageContent.innerHTML = `<div class="page-heading"><div><span class="eyebrow">FIND YOUR NEXT FAVOURITE</span><h1>Search</h1><p class="subtitle">Find songs and music videos from YouTube.</p></div></div><div class="search-explainer"><strong id="search-message">${showResults ? `${items.length} results for “${esc(query)}”` : 'Search for a song, artist, album, or mood.'}</strong><span>${showResults ? 'Choose Play to listen in this window.' : 'Suggestions appear as you type above.'}</span></div><div id="search-results" class="result-list">${showResults ? resultRows(items) : `<div class="state-box"><div><span class="state-icon">⌕</span>Start with a song title or artist name.<br>Try “jazz for a rainy evening” or “Frank Ocean”.</div></div>`}</div>`;
  }

  function resultRows(items) {
    if (!items.length) return '<div class="state-box"><div><span class="state-icon">♫</span>No playable matches for that search. Try a different song or artist.</div></div>';
    return items.map((song) => {
      trackMap.set(song.video_id, song);
      return `<div class="result-row"><img class="result-thumb" src="${esc(song.thumbnail_url || '')}" alt="" onerror="this.style.visibility='hidden'"><div class="result-copy"><h3>${esc(song.title)}</h3><p>${esc(song.artist || 'YouTube')}</p></div><button class="round-add" data-add="${esc(song.video_id)}" title="Add to a playlist">＋</button><button class="play-small" data-play="${esc(song.video_id)}">▶ PLAY</button></div>`;
    }).join('');
  }

  function renderPlaylistNav() {
    const nav = $('#playlist-nav');
    if (!nav) return;
    const playlists = getPlaylists();
    const colors = ['dot-purple', 'dot-blue', 'dot-pink'];
    nav.innerHTML = Object.keys(playlists).filter((name) => name !== 'Cover').map((name, index) => `<button class="nav-item" data-playlist="${esc(name)}"><span class="playlist-dot ${colors[index % colors.length]}"></span>${esc(name)}</button>`).join('');
  }

  function updateActiveNav(name) {
    document.querySelectorAll('.nav-item[data-page], .top-link[data-page]').forEach((button) => {
      button.classList.toggle('active', button.dataset.page === name && button.classList.contains('nav-item'));
      button.classList.toggle('selected', button.dataset.page === name && button.classList.contains('top-link'));
    });
    document.querySelectorAll('.nav-item[data-playlist]').forEach((button) => button.classList.remove('active'));
  }

  function showPage(name, options = {}) {
    activePage = name;
    updateActiveNav(name);
    suggestionsBox.classList.add('hidden');
    if (name === 'Discover' || name === 'Home') renderDiscover();
    else if (name === 'Search') renderSearch(resultItems.length ? resultItems : null, $('#global-search').value.trim());
    else if (name === 'My Music' || name === 'Favorites' || name === 'Liked songs') renderLibrary(name === 'Favorites' || name === 'Liked songs' ? 'liked' : 'recent', name);
    else if (name === 'Shared') renderLibrary('shared', 'Shared');
    else if (name === 'Downloads') renderDownloads();
    else if (name === 'Albums') renderAlbums();
    else if (name === 'Artists') renderArtists();
    else if (name === 'Explorer' || name === 'Radio') renderExplorer(name);
    else if (name === 'Settings') renderSettings();
    else if (['Podcasts', 'Live'].includes(name)) renderExplorer(name);
    else renderDiscover();
    if (!options.keepScroll) contentScroll.scrollTop = 0;
    if (name === 'Search') setTimeout(() => $('#global-search').focus(), 0);
  }

  function renderLibrary(key, label) {
    const items = readTrackList(key === 'liked' ? 'midnight.liked' : key === 'shared' ? 'midnight.shared' : 'midnight.recent');
    pageContent.className = 'page-content library-view';
    const description = key === 'liked' ? 'Songs you have saved with the heart button.' : key === 'shared' ? 'Songs you have copied or shared from MIDNIGHT.' : 'Tracks you have played recently.';
    const empty = key === 'liked' ? 'Tap the heart beside a song to save it here.' : key === 'shared' ? 'Use the share arrow beside the player to copy and save a song link.' : 'Play a song and it will appear in this list.';
    pageContent.innerHTML = `<div class="page-heading"><div><span class="eyebrow">YOUR LIBRARY</span><h1>${esc(label)}</h1><p class="subtitle">${description}</p></div></div>${trackRows(items, empty)}`;
  }

  function renderDownloads() {
    pageContent.className = 'page-content library-view';
    pageContent.innerHTML = `<div class="page-heading"><div><span class="eyebrow">YOUR LIBRARY</span><h1>Downloads</h1><p class="subtitle">Offline listening</p></div></div><div class="settings-card"><h3>Use YouTube's official offline options</h3><p>This app streams videos through YouTube's official player and does not download or save audio files. If offline listening is available for your account and region, use YouTube's own download feature.</p><button class="primary-button" data-page="Search">Find music</button></div>`;
  }

  function renderAlbums() {
    pageContent.className = 'page-content library-view';
    pageContent.innerHTML = `<div class="page-heading"><div><span class="eyebrow">YOUR LIBRARY</span><h1>Albums & collections</h1><p class="subtitle">Explore a mood or search for a specific album.</p></div></div><div class="tile-grid">${collections.map(([palette, title, subtitle, eyebrow]) => `<button class="library-tile" data-search-query="${esc(title)} album"><span class="cover-art ${palette}"><span class="cover-sun"></span><span class="cover-orbit"></span><span class="cover-line"></span><b>M / 01</b></span><h3>${esc(title)}</h3><p>${esc(subtitle)} · ${esc(eyebrow)}</p></button>`).join('')}</div>`;
  }

  function renderArtists() {
    pageContent.className = 'page-content library-view';
    pageContent.innerHTML = `<div class="page-heading"><div><span class="eyebrow">YOUR LIBRARY</span><h1>Artists</h1><p class="subtitle">Choose an artist to see their music.</p></div></div><div class="artist-row">${featuredArtists.map(([initials, name, a, b, plays]) => `<button class="artist-card" data-search-query="${esc(name)}"><span class="artist-avatar" style="--color-a:${a};--color-b:${b}">${esc(initials)}</span><strong>${esc(name)}</strong><small>${esc(plays)}</small></button>`).join('')}</div><section class="section-block"><div class="section-header"><h2>More artists</h2></div><div class="genre-row">${['Frank Ocean', 'Phoebe Bridgers', 'The Weeknd', 'SZA', 'James Blake', 'Tracy Chapman'].map((artist) => `<button class="genre-chip" data-search-query="${esc(artist)}">${esc(artist)}</button>`).join('')}</div></section>`;
  }

  function renderExplorer(title = 'Explorer') {
    pageContent.className = 'page-content library-view';
    const prompt = title === 'Radio' ? 'Choose a sound and start a radio-like mix.' : 'Pick a genre, mood, or artist to discover music.';
    pageContent.innerHTML = `<div class="page-heading"><div><span class="eyebrow">EXPLORE SOMETHING NEW</span><h1>${esc(title)}</h1><p class="subtitle">${esc(prompt)}</p></div></div><section class="hero"><div class="hero-copy"><span class="eyebrow">A GOOD PLACE TO START</span><h2>Let a new sound find you.</h2><p>Search a genre or artist to explore videos and songs.</p><button class="primary-button" data-page="Search">Search music&nbsp; ↗</button></div><div class="hero-shape" aria-hidden="true"></div></section><section class="section-block"><div class="section-header"><h2>Browse genres</h2></div><div class="genre-row">${genres.map((genre) => `<button class="genre-chip" data-search-query="${esc(genre)} music">${esc(genre)}</button>`).join('')}</div></section><section class="section-block"><div class="section-header"><h2>Moods to explore</h2></div><div class="collection-grid">${collections.map(([palette, name, desc, eye]) => `<button class="collection-card" data-search-query="${esc(name)} ${esc(desc)} playlist"><span class="cover-art collection-art ${palette}"><span class="cover-sun"></span><span class="cover-orbit"></span><span class="cover-line"></span><b>M / 01</b></span><span class="collection-copy"><span class="eyebrow">${esc(eye)}</span><h3>${esc(name)}</h3><p>${esc(desc)}</p></span><span class="collection-play">↗</span></button>`).join('')}</div></section>`;
  }

  function renderPlaylist(name) {
    activePage = name;
    updateActiveNav('');
    document.querySelectorAll('.nav-item[data-playlist]').forEach((button) => button.classList.toggle('active', button.dataset.playlist === name));
    const items = getPlaylists()[name] || [];
    pageContent.className = 'page-content library-view';
    pageContent.innerHTML = `<div class="page-heading"><div><span class="eyebrow">YOUR PLAYLIST</span><h1>${esc(name)}</h1><p class="subtitle">${items.length} ${items.length === 1 ? 'song' : 'songs'} saved here.</p></div><button class="text-button" id="rename-playlist">Playlist options <span>•••</span></button></div>${trackRows(items, 'Add songs from Search using the plus button.')}`;
    contentScroll.scrollTop = 0;
  }

  function renderSettings() {
    pageContent.className = 'page-content library-view';
    pageContent.innerHTML = `<div class="page-heading"><div><span class="eyebrow">PREFERENCES</span><h1>Settings</h1><p class="subtitle">MIDNIGHT keeps your library on this device.</p></div></div><div class="settings-card"><h3>YouTube search</h3><p>Your API key stays in the project's private <strong>.env</strong> file. Search suggestions use query completion; searching for tracks uses the YouTube Data API.</p><p>Playback opens inside this window in the official YouTube player. Some videos cannot be played in embedded players because of their owner or region settings.</p><button id="clear-library" class="primary-button">Clear saved library</button></div><div class="settings-card tkinter-card"><h3>Python and Tkinter</h3><p>Open a small native companion window that demonstrates Tkinter labels, text fields, a list, and Python button callbacks. The main music player stays in this window.</p><button id="open-tkinter-showcase" class="primary-button">Open Tkinter showcase</button></div>`;
  }

  function buildWeeklyChart() {
    const chart = $('#weekly-chart');
    chart.innerHTML = weeklySongs.map(([title, artist, duration, palette], index) => `<button class="chart-track" data-search-query="${esc(title)} ${esc(artist)}" data-autoplay="true"><span class="chart-rank">${String(index + 1).padStart(2, '0')}</span>${coverMarkup(palette, 'chart-cover')}<span class="chart-info"><b>${esc(title)}</b><span>${esc(artist)}</span></span><span class="chart-time">${esc(duration)}</span><span class="chart-more">···</span></button>`).join('');
  }

  function doSearch(query, autoplayFirst = false) {
    query = String(query || '').trim();
    if (!query) { showPage('Search'); showToast('Type a song, artist, or album to search.'); return; }
    $('#global-search').value = query;
    suggestionsBox.classList.add('hidden');
    resultItems = [];
    showPage('Search');
    $('#search-message').innerHTML = '<span class="loading-dot"></span>Looking for music…';
    $('#search-results').innerHTML = '<div class="state-box"><div><span class="loading-dot"></span>Searching YouTube for “' + esc(query) + '”…</div></div>';
    const recent = readJSON('midnight.searches', []);
    localStorage.setItem('midnight.searches', JSON.stringify([query, ...recent.filter((q) => q !== query)].slice(0, 12)));
    getBridge().then(async (api) => {
      if (!api) throw new Error('The music service is still starting. Try again in a moment.');
      return api.search(query);
    }).then((payload) => {
      if (String($('#global-search').value).trim() !== query || activePage !== 'Search') return;
      const error = payload?.error || '';
      if (error) {
        $('#search-message').textContent = error;
        $('#search-results').innerHTML = `<div class="state-box"><div><span class="state-icon">!</span>${esc(error)}</div></div>`;
        return;
      }
      resultItems = Array.isArray(payload?.items) ? payload.items : [];
      trackMap = new Map([...trackMap, ...resultItems.map((song) => [song.video_id, song])]);
      $('#search-message').textContent = `${resultItems.length} results for “${query}”`;
      $('#search-results').innerHTML = resultRows(resultItems);
      if (autoplayFirst && resultItems.length) {
        queue = resultItems.slice();
        currentIndex = 0;
        playTrack(resultItems[0]);
      }
    }).catch((error) => {
      if (String($('#global-search').value).trim() !== query || activePage !== 'Search') return;
      $('#search-message').textContent = error?.message || 'Search could not finish. Please try again.';
      $('#search-results').innerHTML = `<div class="state-box"><div><span class="state-icon">!</span>${esc(error?.message || 'Search could not finish. Please try again.')}</div></div>`;
    });
  }

  function renderSuggestions(items, query) {
    const unique = [...new Set(items.map((item) => String(item).trim()).filter(Boolean))].slice(0, 7);
    if (!unique.length) { suggestionsBox.classList.add('hidden'); return; }
    suggestionsBox.innerHTML = `<div class="suggestion-label">${query ? 'SEARCH SUGGESTIONS' : 'POPULAR SEARCHES'}</div>${unique.map((item, index) => `<button class="suggestion-item" data-suggestion="${index}"><span>⌕</span>${esc(item)}</button>`).join('')}`;
    suggestionsBox.dataset.options = JSON.stringify(unique);
    suggestionsBox.classList.remove('hidden');
  }

  async function requestSuggestions(query) {
    const token = ++suggestGeneration;
    const recent = readJSON('midnight.searches', []);
    if (query.length < 2) {
      renderSuggestions([...recent, 'calm evening music', 'jazz for studying', 'indie pop'], query);
      return;
    }
    renderSuggestions([query, ...recent.filter((item) => item.toLowerCase().includes(query.toLowerCase()))], query);
    try {
      const api = await getBridge();
      if (!api || token !== suggestGeneration) return;
      const matches = await api.suggestions(query);
      if (token === suggestGeneration && $('#global-search').value.trim() === query && matches?.length) renderSuggestions(matches, query);
    } catch (_error) { /* Recent and typed-query suggestions remain available offline. */ }
  }

  function storeTrack(song) {
    currentSong = song;
    rememberTrack('midnight.recent', song);
    $('#stage-title').textContent = song.title || 'Now playing';
    $('#stage-artist').textContent = song.artist || 'YouTube';
    $('#right-title').textContent = song.title || 'Now playing';
    $('#right-artist').textContent = song.artist || 'YouTube';
    $('#bar-title').textContent = song.title || 'Now playing';
    $('#bar-artist').textContent = song.artist || 'YouTube';
    $('#room-status').textContent = 'Playing in this window';
    setArtwork($('#stage-art'), song);
    setArtwork($('#right-art'), song);
    setArtwork($('#bar-art'), song);
    const liked = isLiked(song);
    $('#right-like').classList.toggle('liked', liked);
    $('#right-like').textContent = liked ? '♥' : '♡';
    $('#bar-like').classList.toggle('liked', liked);
    $('#bar-like').textContent = liked ? '♥' : '♡';
    playbackStage.classList.remove('hidden');
    renderQueue();
  }

  function playTrack(song) {
    if (!song?.video_id) return;
    if (currentIndex < 0 || queue[currentIndex]?.video_id !== song.video_id) {
      const found = queue.findIndex((item) => item.video_id === song.video_id);
      if (found >= 0) currentIndex = found;
      else { queue.push(song); currentIndex = queue.length - 1; }
    }
    trackMap.set(song.video_id, song);
    storeTrack(song);
    isPlaying = false;
    autoPlayWhenReady = true;
    setPlayButton();
    $('#room-status').textContent = 'Loading the official player…';
    startYouTube(song.video_id);
    contentScroll.scrollTop = 0;
  }

  function renderQueue() {
    const queueElement = $('#queue-items');
    const count = $('#queue-count');
    count.textContent = `${queue.length} ${queue.length === 1 ? 'track' : 'tracks'} in this queue`;
    if (!queue.length) { queueElement.innerHTML = '<div class="state-box">Play a search result to build your queue.</div>'; return; }
    queueElement.innerHTML = queue.map((song, index) => {
      trackMap.set(song.video_id, song);
      const palette = paletteNames[index % paletteNames.length];
      const image = /^https:\/\/(i\.ytimg\.com|yt3\.ggpht\.com)\//i.test(song.thumbnail_url || '')
        ? `<img alt="" src="${esc(song.thumbnail_url)}">` : `<span class="cover-sun"></span><span class="cover-orbit"></span><span class="cover-line"></span><b>M / 01</b>`;
      return `<button class="queue-item ${song.video_id === currentSong?.video_id ? 'current' : ''}" data-play="${esc(song.video_id)}"><span class="cover-art ${palette}">${image}</span><span class="queue-item-copy"><b>${esc(song.title)}</b><span>${esc(song.artist || 'YouTube')}</span></span><span class="queue-num">${song.video_id === currentSong?.video_id && isPlaying ? '♫' : String(index + 1).padStart(2, '0')}</span></button>`;
    }).join('');
  }

  function setPlayButton() {
    for (const button of [$('#play-button'), $('#right-play-button'), $('#stage-play-button')]) {
      button.classList.toggle('is-playing', isPlaying);
      button.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
      button.title = isPlaying ? 'Pause' : 'Play';
    }
  }

  function startYouTube(videoId) {
    requestedVideoId = videoId;
    const mountOrLoad = (ready) => {
      if (!ready || !window.YT?.Player) {
        $('#room-status').textContent = 'YouTube player could not load. Check your internet connection.';
        showToast('The YouTube player did not load. Check your internet connection and try again.');
        return;
      }
      if (!player) {
        player = new YT.Player('youtube-player', {
          width: '1280', height: '720', videoId: requestedVideoId,
          playerVars: { autoplay: 1, controls: 1, playsinline: 1, rel: 0, origin: window.location.origin },
          events: {
            onReady: (event) => {
              playerReady = true;
              beginProgressUpdates();
              event.target.setVolume(Number($('#volume-slider').value));
              if (!userMuted) event.target.unMute();
              const loadedId = event.target.getVideoData()?.video_id;
              if (requestedVideoId && loadedId !== requestedVideoId) {
                event.target.loadVideoById(requestedVideoId);
              } else if (autoPlayWhenReady) {
                event.target.playVideo();
              }
            },
            onStateChange: onPlayerState,
            onError: onPlayerError,
            onAutoplayBlocked: () => {
              isPlaying = false; autoPlayWhenReady = false; setPlayButton();
              $('#room-status').textContent = 'Autoplay was blocked. Press Play in the video or player bar.';
              showToast('Autoplay was blocked. Press the play button in the video or MIDNIGHT player bar.');
            },
          },
        });
      } else if (playerReady && player.getVideoData()?.video_id !== requestedVideoId) {
        player.setVolume(Number($('#volume-slider').value));
        if (!userMuted) player.unMute();
        player.loadVideoById(requestedVideoId);
      } else if (playerReady && autoPlayWhenReady) {
        playPlayer();
      }
    };
    if (youtubeApiLoaded) mountOrLoad(true);
    else youtubeReady.then(mountOrLoad);
  }

  function onPlayerState(event) {
    const state = event.data;
    isPlaying = state === YT.PlayerState.PLAYING;
    if (isPlaying) autoPlayWhenReady = false;
    setPlayButton();
    if (state === YT.PlayerState.PLAYING) $('#room-status').textContent = 'Playing in this window';
    else if (state === YT.PlayerState.PAUSED) $('#room-status').textContent = 'Paused';
    else if (state === YT.PlayerState.BUFFERING) $('#room-status').textContent = 'Buffering…';
    else if (state === YT.PlayerState.ENDED) advanceTrack();
    renderQueue();
  }

  function onPlayerError(event) {
    const messages = {
      2: 'YouTube could not load this video.',
      5: 'This video is not available in the embedded player.',
      100: 'This video is unavailable or private.',
      101: 'The video owner does not allow playback in embedded players.',
      150: 'The video owner does not allow playback in embedded players.',
      153: 'YouTube could not verify this app window. Please try another result.',
    };
    isPlaying = false; setPlayButton();
    const message = messages[event.data] || 'YouTube could not play this video.';
    $('#room-status').textContent = message;
    showToast(message);
  }

  function beginProgressUpdates() {
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(updateProgress, 600);
  }

  function updateProgress() {
    if (!playerReady || !player) return;
    try {
      const duration = Number(player.getDuration()) || 0;
      const elapsed = Number(player.getCurrentTime()) || 0;
      const percentage = duration > 0 ? Math.min(100, elapsed / duration * 100) : 0;
      $('#seek-slider').value = String(Math.round(percentage * 10));
      updateRangeLook($('#seek-slider'));
      $('#elapsed-time').textContent = prettyTime(elapsed);
      $('#total-time').textContent = prettyTime(duration);
      $('#right-current-time').textContent = prettyTime(elapsed);
      $('#right-duration').textContent = prettyTime(duration);
      $('#right-progress-fill').style.width = `${percentage}%`;
      $('#stage-current-time').textContent = prettyTime(elapsed);
      $('#stage-duration').textContent = prettyTime(duration);
      $('#stage-progress-fill').style.width = `${percentage}%`;
    } catch (_error) { /* The iframe can briefly be between states. */ }
  }

  function togglePlayback() {
    if (!currentSong) { showPage('Search'); showToast('Search for a song, then press Play.'); return; }
    if (!playerReady) {
      autoPlayWhenReady = true;
      startYouTube(currentSong.video_id);
      return;
    }
    if (isPlaying) player.pauseVideo(); else playPlayer();
  }

  function playPlayer() {
    if (!playerReady || !player) return;
    player.setVolume(Number($('#volume-slider').value));
    if (!userMuted) player.unMute();
    player.playVideo();
  }

  function advanceTrack(direction = 1) {
    if (!queue.length) return;
    if (repeatCurrent && direction > 0) { player?.seekTo(0, true); player?.playVideo(); return; }
    if (queue.length === 1 && direction > 0) {
      isPlaying = false; setPlayButton();
      $('#room-status').textContent = 'Queue complete';
      return;
    }
    let nextIndex = currentIndex + direction;
    if (nextIndex < 0) nextIndex = queue.length - 1;
    if (nextIndex >= queue.length) nextIndex = 0;
    currentIndex = nextIndex;
    playTrack(queue[currentIndex]);
  }

  function toggleLike() {
    if (!currentSong) { showToast('Choose a song before saving it.'); return; }
    const songs = readTrackList('midnight.liked');
    const exists = songs.some((song) => song.video_id === currentSong.video_id);
    localStorage.setItem('midnight.liked', JSON.stringify(exists ? songs.filter((song) => song.video_id !== currentSong.video_id) : [currentSong, ...songs]));
    const liked = !exists;
    for (const button of [$('#right-like'), $('#bar-like')]) {
      button.classList.toggle('liked', liked);
      button.textContent = liked ? '♥' : '♡';
    }
    showToast(liked ? 'Added to Liked songs.' : 'Removed from Liked songs.');
    if (activePage === 'My Music' || activePage === 'Favorites' || activePage === 'Liked songs') showPage(activePage, { keepScroll: true });
  }

  async function shareCurrent() {
    if (!currentSong) { showToast('Choose a song before sharing it.'); return; }
    const url = `https://www.youtube.com/watch?v=${encodeURIComponent(currentSong.video_id)}`;
    rememberTrack('midnight.shared', currentSong);
    try {
      await navigator.clipboard.writeText(url);
      showToast('Song link copied. It is also saved under Shared.');
    } catch (_error) {
      window.prompt('Copy this YouTube link:', url);
      showToast('Song saved under Shared.');
    }
  }

  function openPlaylistDialog(videoId) {
    if (!trackMap.has(videoId)) return;
    playlistSongId = videoId;
    const choices = $('#playlist-choices');
    choices.innerHTML = Object.keys(getPlaylists()).map((name) => `<button class="playlist-choice" data-add-to-playlist="${esc(name)}"><span>＋</span>${esc(name)}</button>`).join('');
    $('#playlist-dialog').showModal();
  }

  function addSongToPlaylist(name) {
    const song = trackMap.get(playlistSongId);
    if (!song) return;
    const playlists = getPlaylists();
    playlists[name] ||= [];
    if (playlists[name].some((item) => item.video_id === song.video_id)) showToast(`Already in ${name}.`);
    else { playlists[name].unshift(song); savePlaylists(playlists); showToast(`Added to ${name}.`); }
    $('#playlist-dialog').close();
    if (activePage === name) renderPlaylist(name);
  }

  function createPlaylist() {
    const name = window.prompt('Name your playlist');
    if (!name || !name.trim()) return;
    const clean = name.trim().slice(0, 42);
    const playlists = getPlaylists();
    if (playlists[clean]) { showToast('A playlist with that name already exists.'); return; }
    playlists[clean] = [];
    savePlaylists(playlists);
    showToast(`Created ${clean}.`);
    if (playlistSongId && $('#playlist-dialog').open) {
      $('#playlist-choices').innerHTML += `<button class="playlist-choice" data-add-to-playlist="${esc(clean)}"><span>＋</span>${esc(clean)}</button>`;
    } else renderPlaylist(clean);
  }

  function selectedSuggestion(index) {
    try {
      const options = JSON.parse(suggestionsBox.dataset.options || '[]');
      const query = options[index];
      if (query) doSearch(query);
    } catch (_error) { /* Suggestions are only local display state. */ }
  }

  function searchAndMaybePlay(query, autoplay) {
    doSearch(query, autoplay);
  }

  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target.closest('#home-logo')) {
      $('#global-search').value = '';
      resultItems = [];
      showPage('Discover');
      return;
    }
    const navButton = target.closest('[data-page]');
    if (navButton) { showPage(navButton.dataset.page); return; }
    const playlistButton = target.closest('[data-playlist]');
    if (playlistButton) { renderPlaylist(playlistButton.dataset.playlist); return; }
    const suggestion = target.closest('[data-suggestion]');
    if (suggestion) { selectedSuggestion(Number(suggestion.dataset.suggestion)); return; }
    const addToPlaylist = target.closest('[data-add-to-playlist]');
    if (addToPlaylist) { addSongToPlaylist(addToPlaylist.dataset.addToPlaylist); return; }
    const add = target.closest('[data-add]');
    if (add) { openPlaylistDialog(add.dataset.add); return; }
    const play = target.closest('[data-play]');
    if (play) {
      if (activePage === 'Search' && play.closest('#search-results')) {
        queue = resultItems.slice();
        currentIndex = queue.findIndex((song) => song.video_id === play.dataset.play);
      }
      playTrack(trackMap.get(play.dataset.play)); return;
    }
    const queryButton = target.closest('[data-search-query]');
    if (queryButton) { searchAndMaybePlay(queryButton.dataset.searchQuery, queryButton.dataset.autoplay === 'true'); return; }
    if (target.closest('#header-favorites')) { showPage('Favorites'); return; }
    if (target.closest('#right-like, #bar-like')) { toggleLike(); return; }
    if (target.closest('#new-playlist, #dialog-new-playlist')) { createPlaylist(); return; }
    if (target.closest('#play-button, #right-play-button, #stage-play-button')) { togglePlayback(); return; }
    if (target.closest('#next-button, #right-next-button, #stage-next-button')) { advanceTrack(1); return; }
    if (target.closest('#previous-button, #right-previous-button, #stage-previous-button')) {
      if (playerReady && Number(player.getCurrentTime()) > 3) player.seekTo(0, true);
      else advanceTrack(-1);
      return;
    }
    if (target.closest('#shuffle-button')) {
      shuffleEnabled = !shuffleEnabled;
      $('#shuffle-button').classList.toggle('active', shuffleEnabled);
      if (shuffleEnabled && queue.length > 2 && currentIndex >= 0) {
        const current = queue[currentIndex];
        const rest = queue.filter((_, index) => index !== currentIndex).sort(() => Math.random() - .5);
        queue = [current, ...rest]; currentIndex = 0; renderQueue();
      }
      return;
    }
    if (target.closest('#repeat-button')) {
      repeatCurrent = !repeatCurrent;
      $('#repeat-button').classList.toggle('active', repeatCurrent);
      showToast(repeatCurrent ? 'Repeat current song is on.' : 'Repeat is off.');
      return;
    }
    if (target.closest('#queue-button, #queue-toggle')) {
      playbackStage.classList.remove('hidden');
      contentScroll.scrollTop = 0;
      return;
    }
    if (target.closest('#expand-player')) {
      playbackStage.classList.remove('hidden');
      contentScroll.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (target.closest('#chart-more')) { showPage('Explorer'); return; }
    if (target.closest('#profile-button')) { showPage('My Music'); return; }
    if (target.closest('#notification-button')) { showToast('You are all caught up.'); return; }
    if (target.closest('#share-current, #right-more')) { shareCurrent(); return; }
    if (target.closest('#mute-button')) {
      if (!playerReady) return;
      if (player.isMuted()) {
        userMuted = false;
        player.unMute();
        player.setVolume(Number($('#volume-slider').value));
      } else {
        userMuted = true;
        player.mute();
      }
      return;
    }
    if (target.closest('#logout-button')) { showToast('No account is connected to this app.'); return; }
    if (target.closest('#clear-queue')) {
      if (currentSong) queue = [currentSong]; else queue = [];
      currentIndex = queue.length ? 0 : -1; renderQueue(); showToast('Queue cleared.'); return;
    }
    if (target.closest('#clear-library')) {
      localStorage.removeItem('midnight.liked'); localStorage.removeItem('midnight.recent'); localStorage.removeItem('midnight.shared'); localStorage.removeItem('midnight.playlists');
      renderPlaylistNav(); showPage('My Music'); showToast('Saved music cleared from this device.'); return;
    }
    if (target.closest('#open-tkinter-showcase')) {
      const button = target.closest('#open-tkinter-showcase');
      button.disabled = true;
      getBridge()
        .then((api) => api ? api.open_tkinter_showcase() : { ok: false, message: 'The Python app bridge is not ready. Restart MIDNIGHT and try again.' })
        .then((result) => showToast(result?.message || (result?.ok ? 'Tkinter showcase opened.' : 'Could not open the Tkinter showcase.')))
        .catch(() => showToast('Could not open the Tkinter showcase.'))
        .finally(() => { button.disabled = false; });
      return;
    }
    if (target.closest('#rename-playlist')) { showToast('Playlist names can be set when you create them.'); return; }
    if (target === suggestionsBox || target.closest('.global-search')) return;
    suggestionsBox.classList.add('hidden');
  });

  $('#global-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    doSearch($('#global-search').value);
  });

  $('#global-search').addEventListener('input', () => {
    clearTimeout(suggestTimer);
    const query = $('#global-search').value.trim();
    suggestTimer = setTimeout(() => requestSuggestions(query), query.length < 2 ? 80 : 320);
  });

  $('#global-search').addEventListener('focus', () => {
    requestSuggestions($('#global-search').value.trim());
  });

  $('#seek-slider').addEventListener('change', (event) => {
    if (!playerReady) return;
    const duration = Number(player.getDuration()) || 0;
    player.seekTo(duration * Number(event.target.value) / 1000, true);
    updateProgress();
  });
  $('#seek-slider').addEventListener('input', (event) => updateRangeLook(event.target));

  $('#volume-slider').addEventListener('input', (event) => {
    updateRangeLook(event.target);
    if (playerReady) player.setVolume(Number(event.target.value));
  });

  $('#playlist-dialog').addEventListener('click', (event) => {
    if (event.target === $('#playlist-dialog')) $('#playlist-dialog').close();
  });

  renderPlaylistNav();
  buildWeeklyChart();
  showPage('Discover');
  renderQueue();
  setPlayButton();
  updateRangeLook($('#seek-slider'));
  updateRangeLook($('#volume-slider'));

  const youtubeReady = new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = () => {
      youtubeApiLoaded = true;
      resolve(true);
    };
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
})();
