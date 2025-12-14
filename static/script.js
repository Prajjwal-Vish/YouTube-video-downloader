let currentFormats = [];
let selectedFormat = null;
let isAudioMode = false;

// --- Video Player Logic ---
function getVideoId(url) {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function loadVideoPreview() {
    const url = document.getElementById('urlInput').value;
    const videoId = getVideoId(url);
    if (!videoId) return;

    const playerDiv = document.getElementById('videoPlayer');
    playerDiv.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen class="w-full h-full"></iframe>`;
    
    playerDiv.classList.remove('hidden');
    document.getElementById('playOverlay').classList.add('hidden');
}

function resetPlayer() {
    const playerDiv = document.getElementById('videoPlayer');
    playerDiv.innerHTML = '';
    playerDiv.classList.add('hidden');
    document.getElementById('playOverlay').classList.remove('hidden');
}

// --- Main Logic ---

async function fetchInfo() {
    const url = document.getElementById('urlInput').value;
    if(!url) return;

    toggleLoading(true);
    document.getElementById('resultArea').classList.add('hidden');
    document.getElementById('fetchBtn').disabled = true;
    document.getElementById('searchContainer').classList.remove('mt-32'); 
    resetPlayer();
    
    try {
        const res = await fetch('/api/info', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({url})
        });

        if(!res.ok) throw new Error(await res.text());
        const data = await res.json();
        
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
    if (!+bytes) return 'Size unknown';
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

    currentFormats = data.formats;
    switchTab('video');
    
    document.getElementById('resultArea').classList.remove('hidden');
}

function switchTab(mode) {
    isAudioMode = mode === 'audio';
    
    const activeClass = "bg-slate-100 text-black shadow-lg";
    const inactiveClass = "text-slate-400 hover:text-white";
    
    const btnVideo = document.getElementById('tabVideo');
    const btnAudio = document.getElementById('tabAudio');
    
    if(mode === 'video') {
        btnVideo.className = `flex-1 py-2 rounded-lg text-sm font-bold transition-all duration-300 ${activeClass}`;
        btnAudio.className = `flex-1 py-2 rounded-lg text-sm font-bold transition-all duration-300 ${inactiveClass}`;
    } else {
        btnVideo.className = `flex-1 py-2 rounded-lg text-sm font-bold transition-all duration-300 ${inactiveClass}`;
        btnAudio.className = `flex-1 py-2 rounded-lg text-sm font-bold transition-all duration-300 ${activeClass}`;
    }

    const container = document.getElementById('formatList');
    container.innerHTML = '';
    selectedFormat = null;
    updateDownloadBtn(false);

    if (isAudioMode) {
        // ... (Logic for Audio Cards) ...
        const div = document.createElement('div');
        div.className = "p-4 bg-white/5 hover:bg-white/10 rounded-xl cursor-pointer border border-white/5 hover:border-blue-400/50 transition-all flex items-center justify-between group";
        div.innerHTML = `
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400 group-hover:scale-110 transition-transform">
                    <i class="fas fa-music"></i>
                </div>
                <div>
                    <div class="font-bold text-white">Best Audio</div>
                    <div class="text-xs text-slate-400">MP3 / High Quality</div>
                </div>
            </div>
            <div class="w-6 h-6 rounded-full border-2 border-slate-600 flex items-center justify-center check-circle">
                <div class="w-3 h-3 bg-blue-500 rounded-full opacity-0 transform scale-0 transition-all"></div>
            </div>
        `;
        div.onclick = () => selectFormat(div, 'best');
        container.appendChild(div);
    } else {
        if(currentFormats.length === 0) {
                container.innerHTML = `<div class="text-slate-400 text-center py-10">No compatible formats found.</div>`;
                return;
        }
        currentFormats.forEach(fmt => {
            const div = document.createElement('div');
            div.className = "p-3 bg-white/5 hover:bg-white/10 rounded-xl cursor-pointer border border-white/5 hover:border-red-400/50 transition-all flex items-center justify-between group";
            
            const isHD = fmt.resolution.includes('1080') || fmt.resolution.includes('720') || fmt.resolution.includes('4K');
            const badgeColor = isHD ? 'text-red-400 bg-red-400/10' : 'text-slate-300 bg-slate-700/50';

            const sizeStr = formatBytes(fmt.filesize);

            div.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="w-12 text-center">
                        <span class="block font-bold text-lg ${badgeColor} px-2 rounded font-mono">${fmt.resolution.replace('p','')}</span>
                    </div>
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-white uppercase tracking-wider">${fmt.ext}</span>
                        <span class="text-xs text-slate-400">${sizeStr}</span>
                    </div>
                </div>
                    <div class="w-6 h-6 rounded-full border-2 border-slate-600 flex items-center justify-center check-circle">
                    <div class="w-3 h-3 bg-red-500 rounded-full opacity-0 transform scale-0 transition-all"></div>
                </div>
            `;
            div.onclick = () => selectFormat(div, fmt.format_id);
            container.appendChild(div);
        });
    }
}

function selectFormat(el, id) {
    document.querySelectorAll('#formatList > div').forEach(d => {
        d.classList.remove('border-red-500', 'bg-white/10', 'border-blue-500');
        d.querySelector('.check-circle div').classList.add('opacity-0', 'scale-0');
    });

    const colorClass = isAudioMode ? 'border-blue-500' : 'border-red-500';
    el.classList.add(colorClass, 'bg-white/10');
    el.querySelector('.check-circle div').classList.remove('opacity-0', 'scale-0');

    selectedFormat = id;
    updateDownloadBtn(true);
}

function updateDownloadBtn(enabled) {
    const btn = document.getElementById('downloadBtn');
    btn.disabled = !enabled;
    if(enabled) {
        btn.innerHTML = `<span class="relative z-10 flex items-center justify-center gap-3 text-lg"><i class="fas fa-bolt"></i><span>Download Now</span></span><div class="absolute inset-0 h-full w-full bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:animate-[shimmer_1.5s_infinite]"></div>`;
        btn.classList.remove('cursor-wait');
    }
}

async function startDownload() {
    // ... (Your startDownload logic here, same as original) ...
    // Note: Copied for brevity, ensure you copy the full function body
    const url = document.getElementById('urlInput').value;
    const btn = document.getElementById('downloadBtn');
    const statusArea = document.getElementById('statusArea');
    const statusText = document.getElementById('statusText');
    const progressBar = document.getElementById('progressBar');

    btn.disabled = true;
    btn.classList.add('cursor-wait');
    btn.innerHTML = `<span class="flex items-center gap-2"><i class="fas fa-circle-notch fa-spin"></i> Converting...</span>`;
    
    statusArea.classList.remove('hidden');
    statusText.textContent = "Server is merging streams...";
    statusText.className = "text-sm font-mono text-yellow-400 animate-pulse";
    progressBar.className = "bg-gradient-to-r from-yellow-500 to-orange-500 h-full w-full animate-[shimmer_2s_infinite_linear]";

    try {
        const res = await fetch('/api/queue', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                url, 
                format_id: selectedFormat,
                is_audio_only: isAudioMode
            })
        });
        
        const data = await res.json();
        const jobId = data.job_id;

        const pollInterval = setInterval(async () => {
            try {
                const statusRes = await fetch(`/api/status/${jobId}`);
                const statusData = await statusRes.json();

                if (statusData.status === 'completed') {
                    clearInterval(pollInterval);
                    
                    statusText.textContent = "Finalizing Download...";
                    statusText.className = "text-sm font-mono text-emerald-400";
                    progressBar.className = "bg-gradient-to-r from-emerald-400 to-green-500 h-full w-full";
                    btn.innerHTML = `<span class="flex items-center gap-2"><i class="fas fa-check"></i> Complete</span>`;
                    
                    window.location.href = `/api/download/${jobId}`;
                    
                    setTimeout(() => {
                        updateDownloadBtn(true);
                        statusArea.classList.add('hidden');
                    }, 4000);

                } else if (statusData.status === 'failed') {
                    clearInterval(pollInterval);
                    throw new Error(statusData.error);
                }
            } catch (pollErr) {
                clearInterval(pollInterval);
                handleError(pollErr.message);
            }
        }, 1000);

    } catch (e) {
        handleError(e.message);
    }

    function handleError(msg) {
        statusText.textContent = "Error: " + msg;
        statusText.className = "text-sm font-mono text-red-500";
        progressBar.className = "bg-red-500 h-full w-full";
        btn.innerHTML = `<span class="flex items-center gap-2"><i class="fas fa-times"></i> Failed</span>`;
        setTimeout(() => updateDownloadBtn(true), 3000);
    }
}

function toggleLoading(show) {
    document.getElementById('loading').classList.toggle('hidden', !show);
}

function formatTime(seconds) {
    if(!seconds) return "00:00";
    const date = new Date(seconds * 1000);
    const substrStart = seconds >= 3600 ? 11 : 14;
    return date.toISOString().substr(substrStart, 19 - substrStart);
}
