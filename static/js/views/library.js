import { apiFetch } from '../api.js';
import { switchView } from '../ui.js';

// DOM Elements
let libraryTableBody, librarySearchInput;
let animeDetailView, detailViewImg, detailViewTitle, detailViewMeta, sourceDetailTableBody;
let episodeListView, danmakuListView;

// State
let currentEpisodes = [];

function initializeElements() {
    libraryTableBody = document.querySelector('#library-table tbody');
    librarySearchInput = document.getElementById('library-search-input');
    
    animeDetailView = document.getElementById('anime-detail-view');
    detailViewImg = document.getElementById('detail-view-img');
    detailViewTitle = document.getElementById('detail-view-title');
    detailViewMeta = document.getElementById('detail-view-meta');
    sourceDetailTableBody = document.getElementById('source-detail-table-body');

    episodeListView = document.getElementById('episode-list-view');
    danmakuListView = document.getElementById('danmaku-list-view');
}

async function loadLibrary() {
    if (!libraryTableBody) return;
    libraryTableBody.innerHTML = '<tr><td colspan="8">加载中...</td></tr>';
    try {
        const data = await apiFetch('/api/ui/library');
        renderLibrary(data.animes);
    } catch (error) {
        libraryTableBody.innerHTML = `<tr><td colspan="8" class="error">加载失败: ${(error.message || error)}</td></tr>`;
    }
}

function renderLibrary(animes) {
    libraryTableBody.innerHTML = '';
    if (animes.length === 0) {
        libraryTableBody.innerHTML = '<tr><td colspan="8">媒体库为空。</td></tr>';
        return;
    }

    animes.forEach(anime => {
        const row = libraryTableBody.insertRow();
        row.dataset.title = anime.title.toLowerCase();
        
        row.innerHTML = `
            <td class="poster-cell"><img src="${anime.imageUrl || '/static/placeholder.png'}" referrerpolicy="no-referrer" alt="${anime.title}"></td>
            <td>${anime.title}</td>
            <td>${{ 'tv_series': '电视节目', 'movie': '电影/剧场版', 'ova': 'OVA', 'other': '其他' }[anime.type] || anime.type}</td>
            <td>${anime.season}</td>
            <td>${anime.episodeCount}</td>
            <td>${anime.sourceCount}</td>
            <td>${new Date(anime.createdAt).toLocaleString()}</td>
            <td class="actions-cell">
                <div class="action-buttons-wrapper">
                    <button class="action-btn" data-action="edit" data-anime-id="${anime.animeId}" title="编辑">✏️</button>
                    <button class="action-btn" data-action="view" data-anime-id="${anime.animeId}" title="查看数据源">📖</button>
                    <button class="action-btn" data-action="delete" data-anime-id="${anime.animeId}" data-anime-title="${anime.title}" title="删除">🗑️</button>
                </div>
            </td>
        `;
    });
}

function handleLibrarySearch() {
    const searchTerm = librarySearchInput.value.toLowerCase();
    const rows = libraryTableBody.querySelectorAll('tr');
    rows.forEach(row => {
        const title = row.dataset.title || '';
        row.style.display = title.includes(searchTerm) ? '' : 'none';
    });
}

async function handleLibraryAction(e) {
    const button = e.target.closest('.action-btn');
    if (!button) return;

    const action = button.dataset.action;
    const animeId = parseInt(button.dataset.animeId, 10);
    const title = button.dataset.animeTitle;

    if (action === 'delete') {
        if (confirm(`您确定要删除番剧 '${title}' 吗？\n此操作将删除其所有分集和弹幕，且不可恢复。`)) {
            try {
                await apiFetch(`/api/ui/library/anime/${animeId}`, { method: 'DELETE' });
                loadLibrary();
            } catch (error) {
                alert(`删除失败: ${(error.message || error)}`);
            }
        }
    } else if (action === 'edit') {
        document.dispatchEvent(new CustomEvent('show:edit-anime', { detail: { animeId } }));
    } else if (action === 'view') {
        showAnimeDetailView(animeId);
    }
}

async function showAnimeDetailView(animeId) {
    switchView('anime-detail-view');
    detailViewTitle.textContent = '加载中...';
    detailViewMeta.textContent = '';
    detailViewImg.src = '/static/placeholder.png';
    sourceDetailTableBody.innerHTML = '';

    try {
        const [fullLibrary, sources] = await Promise.all([
            apiFetch('/api/ui/library'),
            apiFetch(`/api/ui/library/anime/${animeId}/sources`)
        ]);

        const anime = fullLibrary.animes.find(a => a.animeId === animeId);
        if (!anime) throw new Error("找不到该作品的信息。");

        detailViewImg.src = anime.imageUrl || '/static/placeholder.png';
        detailViewImg.alt = anime.title;
        detailViewTitle.textContent = anime.title;
        detailViewMeta.textContent = `季: ${anime.season} | 总集数: ${anime.episodeCount || 0} | 已关联 ${sources.length} 个源`;
        
        animeDetailView.dataset.animeId = anime.animeId; // Store for back button

        renderSourceDetailTable(sources, anime);
    } catch (error) {
        detailViewTitle.textContent = '加载详情失败';
        detailViewMeta.textContent = error.message || error;
    }
}

function renderSourceDetailTable(sources, anime) {
    sourceDetailTableBody.innerHTML = '';
    if (sources.length > 0) {
        sources.forEach(source => {
            const row = sourceDetailTableBody.insertRow();
            row.innerHTML = `
                <td>${source.provider_name}</td>
                <td>${source.media_id}</td>
                <td>${source.is_favorited ? '🌟' : ''}</td>
                <td>${new Date(source.created_at).toLocaleString()}</td>
                <td class="actions-cell">
                    <div class="action-buttons-wrapper" data-source-id="${source.source_id}" data-anime-title="${anime.title}" data-anime-id="${anime.animeId}">
                        <button class="action-btn" data-action="favorite" title="精确标记">${source.is_favorited ? '🌟' : '⭐'}</button>
                        <button class="action-btn" data-action="view_episodes" title="查看/编辑分集">📖</button>
                        <button class="action-btn" data-action="refresh" title="刷新此源">🔄</button>
                        <button class="action-btn" data-action="delete" title="删除此源">🗑️</button>
                    </div>
                </td>
            `;
        });
    } else {
        sourceDetailTableBody.innerHTML = `<tr><td colspan="5">未关联任何数据源。</td></tr>`;
    }
}

async function handleSourceAction(e) {
    const button = e.target.closest('.action-btn');
    if (!button) return;
    
    const wrapper = button.parentElement;
    const action = button.dataset.action;
    const sourceId = parseInt(wrapper.dataset.sourceId, 10);
    const animeTitle = wrapper.dataset.animeTitle;
    const animeId = parseInt(wrapper.dataset.animeId, 10);

    switch (action) {
        case 'favorite':
            try {
                await apiFetch(`/api/ui/library/source/${sourceId}/favorite`, { method: 'PUT' });
                showAnimeDetailView(animeId);
            } catch (error) {
                alert(`操作失败: ${error.message}`);
            }
            break;
        case 'view_episodes':
            showEpisodeListView(sourceId, animeTitle, animeId);
            break;
        case 'refresh':
            if (confirm(`您确定要为 '${animeTitle}' 的这个数据源执行全量刷新吗？`)) {
                apiFetch(`/api/ui/library/source/${sourceId}/refresh`, { method: 'POST' })
                    .then(response => alert(response.message || "刷新任务已开始。"))
                    .catch(error => alert(`启动刷新任务失败: ${error.message}`));
            }
            break;
        case 'delete':
            if (confirm(`您确定要删除这个数据源吗？\n此操作将删除其所有分集和弹幕，且不可恢复。`)) {
                try {
                    await apiFetch(`/api/ui/library/source/${sourceId}`, { method: 'DELETE' });
                    showAnimeDetailView(animeId);
                } catch (error) {
                    alert(`删除失败: ${error.message}`);
                }
            }
            break;
    }
}

async function showEpisodeListView(sourceId, animeTitle, animeId) {
    switchView('episode-list-view');
    episodeListView.innerHTML = '<div>加载中...</div>';

    try {
        const episodes = await apiFetch(`/api/ui/library/source/${sourceId}/episodes`);
        currentEpisodes = episodes;
        renderEpisodeListView(sourceId, animeTitle, episodes, animeId);
    } catch (error) {
        episodeListView.innerHTML = `<div class="error">加载分集列表失败: ${(error.message || error)}</div>`;
    }
}

function renderEpisodeListView(sourceId, animeTitle, episodes, animeId) {
    episodeListView.innerHTML = `
        <div class="episode-list-header">
            <h3>分集列表: ${animeTitle}</h3>
            <button id="back-to-detail-view-btn">&lt; 返回作品详情</button>
        </div>
        <table id="episode-list-table">
            <thead><tr><th>ID</th><th>剧集名</th><th>集数</th><th>弹幕数</th><th>采集时间</th><th>官方链接</th><th>剧集操作</th></tr></thead>
            <tbody></tbody>
        </table>
    `;
    episodeListView.dataset.sourceId = sourceId;
    episodeListView.dataset.animeTitle = animeTitle;
    episodeListView.dataset.animeId = animeId;

    const tableBody = episodeListView.querySelector('tbody');
    if (episodes.length > 0) {
        episodes.forEach(ep => {
            const row = tableBody.insertRow();
            row.innerHTML = `
                <td>${ep.id}</td><td>${ep.title}</td><td>${ep.episode_index}</td><td>${ep.comment_count}</td>
                <td>${ep.fetched_at ? new Date(ep.fetched_at).toLocaleString() : 'N/A'}</td>
                <td>${ep.source_url ? `<a href="${ep.source_url}" target="_blank">跳转</a>` : '无'}</td>
                <td class="actions-cell">
                    <div class="action-buttons-wrapper" data-episode-id="${ep.id}" data-episode-title="${ep.title}">
                        <button class="action-btn" data-action="edit" title="编辑剧集">✏️</button>
                        <button class="action-btn" data-action="refresh" title="刷新剧集">🔄</button>
                        <button class="action-btn" data-action="view_danmaku" title="查看具体弹幕">💬</button>
                        <button class="action-btn" data-action="delete" title="删除集">🗑️</button>
                    </div>
                </td>
            `;
        });
    } else {
        tableBody.innerHTML = `<tr><td colspan="7">未找到任何分集数据。</td></tr>`;
    }

    document.getElementById('back-to-detail-view-btn').addEventListener('click', () => showAnimeDetailView(animeId));
    tableBody.addEventListener('click', handleEpisodeAction);
}

function handleEpisodeAction(e) {
    const button = e.target.closest('.action-btn');
    if (!button) return;

    const wrapper = button.parentElement;
    const action = button.dataset.action;
    const episodeId = parseInt(wrapper.dataset.episodeId, 10);
    const episodeTitle = wrapper.dataset.episodeTitle;
    
    const sourceId = parseInt(episodeListView.dataset.sourceId, 10);
    const animeTitle = episodeListView.dataset.animeTitle;
    const animeId = parseInt(episodeListView.dataset.animeId, 10);

    switch (action) {
        case 'edit':
            const episode = currentEpisodes.find(ep => ep.id === episodeId);
            if (episode) {
                document.dispatchEvent(new CustomEvent('show:edit-episode', { detail: { episode, sourceId, animeTitle, animeId } }));
            }
            break;
        case 'refresh':
            if (confirm(`您确定要刷新分集 '${episodeTitle}' 的弹幕吗？`)) {
                apiFetch(`/api/ui/library/episode/${episodeId}/refresh`, { method: 'POST' })
                    .then(response => alert(response.message || "刷新任务已开始。"))
                    .catch(error => alert(`启动刷新任务失败: ${error.message}`));
            }
            break;
        case 'view_danmaku':
            showDanmakuListView(episodeId, episodeTitle, sourceId, animeTitle, animeId);
            break;
        case 'delete':
            if (confirm(`您确定要删除分集 '${episodeTitle}' 吗？`)) {
                apiFetch(`/api/ui/library/episode/${episodeId}`, { method: 'DELETE' })
                    .then(() => showEpisodeListView(sourceId, animeTitle, animeId))
                    .catch(error => alert(`删除失败: ${error.message}`));
            }
            break;
    }
}

async function showDanmakuListView(episodeId, episodeTitle, sourceId, animeTitle, animeId) {
    switchView('danmaku-list-view');
    danmakuListView.innerHTML = '<div>加载中...</div>';

    try {
        const data = await apiFetch(`/api/ui/comment/${episodeId}`);
        renderDanmakuListView(episodeId, episodeTitle, sourceId, animeTitle, animeId, data.comments);
    } catch (error) {
        danmakuListView.innerHTML = `<div class="error">加载弹幕失败: ${(error.message || error)}</div>`;
    }
}

function renderDanmakuListView(episodeId, episodeTitle, sourceId, animeTitle, animeId, comments) {
    danmakuListView.innerHTML = `
        <div class="episode-list-header">
            <h3>弹幕列表: ${animeTitle} - ${episodeTitle}</h3>
            <button id="back-to-episodes-from-danmaku-btn">&lt; 返回分集列表</button>
        </div>
        <pre id="danmaku-content-pre"></pre>
    `;
    const danmakuContentPre = document.getElementById('danmaku-content-pre');
    danmakuContentPre.textContent = comments.length > 0
        ? comments.map(c => `${c.p} | ${c.m}`).join('\n')
        : '该分集没有弹幕。';

    document.getElementById('back-to-episodes-from-danmaku-btn').addEventListener('click', () => {
        showEpisodeListView(sourceId, animeTitle, animeId);
    });
}

export function setupLibraryEventListeners() {
    initializeElements();
    librarySearchInput.addEventListener('input', handleLibrarySearch);
    libraryTableBody.addEventListener('click', handleLibraryAction);
    document.getElementById('back-to-library-from-detail-btn').addEventListener('click', () => switchView('library-view'));
    sourceDetailTableBody.addEventListener('click', handleSourceAction);
    
    document.addEventListener('viewchange', (e) => {
        if (e.detail.viewId === 'library-view') {
            loadLibrary();
        }
    });

    document.addEventListener('show:episode-list', (e) => {
        // 从事件中获取的值可能是字符串（例如从input.value读取），
        // 需要转换为数字以确保后续比较 (e.g., a.animeId === animeId) 的正确性。
        const sourceId = parseInt(e.detail.sourceId, 10);
        const animeId = parseInt(e.detail.animeId, 10);
        const animeTitle = e.detail.animeTitle;
        showEpisodeListView(sourceId, animeTitle, animeId);
    });
}
