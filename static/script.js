let currentVideoFormats = [];
let currentAudioFormats = [];
let selectedFormat = null;
let isAudioMode = false;
let isDownloading = false;



// --- Video Player Logic ---
function getVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function loadVideoPreview() {
    if(isDownloading) return;
    const url = document.getElementById('urlInput').value;
    const videoId = getVideoId(url);
    if (!videoId) return;

    const playerDiv = document.getElementById('videoPlayer');
    playerDiv.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1" 
        frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; 
        gyroscope; picture-in-picture" allowfullscreen class="w-full h-full"></iframe>`;
    
    playerDiv.classList.remove('hidden');
    document.getElementById('playOverlay').classList.add('hidden');
}

function resetPlayer() {
    const playerDiv = document.getElementById('videoPlayer');
    playerDiv.innerHTML = '';
    playerDiv.classList.add('hidden');
    document.getElementById('playOverlay').classList.remove('hidden');
}

// --- MAIN LOGIC ---
async function fetchInfo() {
    const url = document.getElementById('urlInput').value;
    if(!url || isDownloading) return;

    toggleLoading(true);
    document.getElementById('resultArea').classList.add('hidden');
    document.getElementById('fetchBtn').disabled = true;
    resetPlayer();
    
    try {
        const res = await fetch('/api/info', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({url})
        });

        if(!res.ok) throw new Error(await res.text());
        const data = await res.json();

        // extract formats
        currentVideoFormats = data.formats || [];
        currentAudioFormats = data.audio_formats || [];

        renderInfo(data);
    } catch (e) {
        alert("Error: " + e.message);
        document.getElementById('video-bg').style.opacity = '0';
    } finally {
        toggleLoading(false);
        document.getElementById('fetchBtn').disabled = false;
    }
}

function formatBytes(bytes, decimals = 2) {
    if (!+bytes) return 'Unknown';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

function renderInfo(data) {
    const thumbUrl = data.thumbnail;
    document.getElementById('thumb').src = thumbUrl;
    document.getElementById('videoTitle').textContent = data.title;
    document.getElementById('durationBadge').textContent = formatTime(data.duration);
    document.getElementById('uploader').textContent = data.uploader || "YouTube Video";

    const videoBg = document.getElementById('video-bg');
    videoBg.style.backgroundImage = `url('${thumbUrl}')`;
    videoBg.style.opacity = '0.4';

    switchTab('video');
    document.getElementById('resultArea').classList.remove('hidden');
}

// --- TABS (VIDEO / AUDIO) ---
function switchTab(mode) {
    if(isDownloading) return;

    isAudioMode = (mode === 'audio');

    const activeClass = "bg-slate-100 text-black shadow-lg";
    const inactiveClass = "text-slate-400 hover:text-white";

    document.getElementById('tabVideo').className =
        `flex-1 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'video' ? activeClass : inactiveClass}`;

    document.getElementById('tabAudio').className =
        `flex-1 py-2 rounded-lg text-sm font-bold transition-all ${mode === 'audio' ? activeClass : inactiveClass}`;

    const container = document.getElementById('formatList');
    container.innerHTML = '';
    selectedFormat = null;
    updateDownloadBtn(false);

    // AUDIO TAB
    if (isAudioMode) {
        if (currentAudioFormats.length === 0) {
            container.innerHTML = `<div class="text-slate-400 text-center py-10">No audio formats found.</div>`;
            return;
        }

        currentAudioFormats.forEach(fmt => {
            const sizeStr = formatBytes(fmt.filesize);

            const div = document.createElement('div');
            div.className =
                "p-4 bg-white/5 hover:bg-white/10 rounded-xl cursor-pointer border border-white/5 " +
                "hover:border-blue-400/50 transition-all flex items-center justify-between group";

            div.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-full bg-blue-500/20 flex items-center 
                                justify-center text-blue-400 group-hover:scale-110 transition-transform">
                        <i class="fas fa-music"></i>
                    </div>
                    <div>
                        <div class="font-bold text-white">${fmt.abr || "HQ"} kbps</div>
                        <div class="text-xs text-slate-400">${fmt.ext.toUpperCase()} • ${sizeStr}</div>
                    </div>
                </div>
                <div class="w-6 h-6 rounded-full border-2 border-slate-600 flex items-center 
                            justify-center check-circle">
                    <div class="w-3 h-3 bg-blue-500 rounded-full opacity-0 scale-0 transition-all"></div>
                </div>
            `;

            div.onclick = () => selectFormat(div, fmt);
            container.appendChild(div);
        });

        return;
    }

    // VIDEO TAB
    if (currentVideoFormats.length === 0) {
        container.innerHTML = `<div class="text-slate-400 text-center py-10">No video formats found.</div>`;
        return;
    }

    currentVideoFormats.forEach(fmt => {
        const sizeStr = formatBytes(fmt.filesize);
        const isHD = fmt.resolution.includes("1080") || fmt.resolution.includes("720") || fmt.resolution.includes("4K");
        const badgeColor = isHD ? "text-red-400 bg-red-400/10" : "text-slate-300 bg-slate-700/50";

        const div = document.createElement('div');
        div.className =
            "p-3 bg-white/5 hover:bg-white/10 rounded-xl cursor-pointer border border-white/5 " +
            "hover:border-red-400/50 transition-all flex items-center justify-between group";

        div.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="w-12 text-center">
                    <span class="block font-bold text-lg ${badgeColor} px-2 rounded font-mono">
                        ${fmt.resolution.replace("p", "")}
                    </span>
                </div>
                <div class="flex flex-col">
                    <span class="text-sm font-bold text-white uppercase tracking-wider">${fmt.ext}</span>
                    <span class="text-xs text-slate-400">${sizeStr}</span>
                </div>
            </div>
            <div class="w-6 h-6 rounded-full border-2 border-slate-600 flex items-center justify-center check-circle">
                <div class="w-3 h-3 bg-red-500 rounded-full opacity-0 scale-0 transition-all"></div>
            </div>
        `;

        div.onclick = () => selectFormat(div, fmt);
        container.appendChild(div);
    });
}

// --- SELECT FORMAT ---
function selectFormat(el, fmtObject) {
    if(isDownloading) return;

    document.querySelectorAll('#formatList > div').forEach(d => {
        d.classList.remove('border-red-500', 'bg-white/10', 'border-blue-500');
        d.querySelector('.check-circle div').classList.add('opacity-0', 'scale-0');
    });

    const colorClass = isAudioMode ? 'border-blue-500' : 'border-red-500';
    el.classList.add(colorClass, 'bg-white/10');
    el.querySelector('.check-circle div').classList.remove('opacity-0', 'scale-0');

    selectedFormat = fmtObject;
    updateDownloadBtn(true);
}

function updateDownloadBtn(enabled) {
    const btn = document.getElementById('downloadBtn');
    btn.disabled = !enabled;

    if (enabled) {
        btn.innerHTML =
            `<span class="relative z-10 flex items-center justify-center gap-3 text-lg">
                <i class="fas fa-bolt"></i><span>Download Now</span>
            </span>
            <div class="absolute inset-0 h-full w-full bg-gradient-to-r 
                 from-transparent via-white/20 to-transparent 
                 -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>`;
    }
}

// --- DOWNLOAD ---
async function startDownload() {
    if (!selectedFormat) return;

    const url = selectedFormat.direct_url;

    // Create a temporary hidden <a> tag
    const a = document.createElement('a');
    a.href = url;

    // Optional: better file name
    a.download = (selectedFormat.resolution || selectedFormat.abr + "kbps") + "." + (selectedFormat.ext || "mp4");

    // Required for programmatic clicking
    document.body.appendChild(a);

    // Trigger download
    a.click();

    // Clean up
    document.body.removeChild(a);
}


// --- Helpers ---
function toggleLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
}

function formatTime(seconds) {
    if(!seconds) return "00:00";
    const date = new Date(seconds * 1000);
    const start = seconds >= 3600 ? 11 : 14;
    return date.toISOString().substr(start, 19 - start);
}
