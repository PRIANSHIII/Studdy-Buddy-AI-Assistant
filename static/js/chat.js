

// Ready Player Me Avatar URL (keep your URL here)
const AVATAR_URL = "https://models.readyplayer.me/68ef3b45216c45e46a663d63.glb";

// Globals (will be assigned after DOM ready)
let chatWindow, chatInput, sendButton, buddyAnimationContainer, loadingIndicator;
let chatModeBtn, companionModeBtn;

// THREE.js globals
let scene, camera, renderer, controls, model, mixer, clock;
let currentAction;
window.idleAction = null;
window.talkAction = null;

// Recognition
let recognition = null;
let isRecognizing = false;
let currentMode = 'chat'; // 'chat' or 'companion'

// Utility helpers
function safeLog(...args){ console.log('[StudyBuddy]', ...args); }

function base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}
function pcmToWav(pcm16, sampleRate) {
    const buffer = new ArrayBuffer(44 + pcm16.length * 2);
    const view = new DataView(buffer);
    function writeString(offset, str) {
        for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeString(0, 'RIFF');
    view.setUint32(4, 36 + pcm16.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, pcm16.length * 2, true);
    let offset = 44;
    for (let i = 0; i < pcm16.length; i++) {
        view.setInt16(offset, pcm16[i], true);
        offset += 2;
    }
    return new Blob([buffer], { type: 'audio/wav' });
}

function getColors() {
    const root = getComputedStyle(document.documentElement);
    return {
        listening: (root.getPropertyValue('--listening-color') || '#9c27b0').trim(),
        thinking: (root.getPropertyValue('--thinking-color') || '#ffeb3b').trim(),
        speaking: (root.getPropertyValue('--speaking-color') || '#4CAF50').trim(),
        midDark: (root.getPropertyValue('--mid-dark') || '#121212').trim(),
    };
}

/* ---------------- THREE.JS SETUP ---------------- */
function initThreeJS() {
    try {
        clock = new THREE.Clock();
        scene = new THREE.Scene();
        const colors = getColors();
        scene.background = new THREE.Color(colors.midDark);

        camera = new THREE.PerspectiveCamera(45, buddyAnimationContainer.clientWidth / Math.max(1, buddyAnimationContainer.clientHeight), 0.1, 1000);
        camera.position.set(0, 1.5, 3);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio || 1);
        renderer.setSize(buddyAnimationContainer.clientWidth, buddyAnimationContainer.clientHeight);
        // clear old canvas if present
        const existing = buddyAnimationContainer.querySelector('canvas');
        if (existing) existing.remove();
        buddyAnimationContainer.appendChild(renderer.domElement);

        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        scene.add(ambientLight);

        window.spotlight = new THREE.SpotLight(new THREE.Color(colors.listening), 5, 10, Math.PI * 0.2, 0.5, 2);
        spotlight.position.set(0, 4, 2);
        spotlight.target.position.set(0, 1.5, 0);
        scene.add(spotlight);
        scene.add(spotlight.target);

        controls = new THREE.OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 1.5, 0);
        controls.minDistance = 2;
        controls.maxDistance = 4;
        controls.enablePan = false;

        window.addEventListener('resize', onWindowResize);
        safeLog('ThreeJS initialized');
    } catch (err) {
        console.error('ThreeJS init error', err);
        loadingIndicator.textContent = 'ThreeJS init error';
    }
}

function onWindowResize() {
    if (!camera || !renderer || !buddyAnimationContainer) return;
    const w = buddyAnimationContainer.clientWidth, h = buddyAnimationContainer.clientHeight || 300;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

/* ---------------- Model Loading ---------------- */
function loadModel() {
    if (!THREE || !THREE.GLTFLoader) {
        console.error('Three or GLTFLoader missing');
        loadingIndicator.textContent = '3D loader not available';
        return;
    }
    const loader = new THREE.GLTFLoader();

    safeLog('Loading GLB:', AVATAR_URL);
    loader.load(
        AVATAR_URL,
        (gltf) => {
            try {
                model = gltf.scene;
                model.scale.set(1,1,1);
                model.position.set(0,0,0);
                model.traverse(obj => {
                    if(obj.isMesh){
                        obj.castShadow = true;
                        obj.receiveShadow = true;
                    }
                });
                scene.add(model);

                mixer = new THREE.AnimationMixer(model);
                const clips = gltf.animations || [];
                const idleClip = THREE.AnimationClip.findByName(clips, 'Idle') || clips[0] || null;
                const talkClip = THREE.AnimationClip.findByName(clips, 'Talk');

                if (idleClip) {
                    window.idleAction = mixer.clipAction(idleClip);
                    window.idleAction.play();
                    currentAction = window.idleAction;
                }
                if (talkClip) {
                    window.talkAction = mixer.clipAction(talkClip).setLoop(THREE.LoopOnce);
                }

                loadingIndicator.style.display = 'none';
                chatInput.disabled = false;
                sendButton.disabled = false;

                setTimeout(() => {
                    appendMessage("Hello! I'm your Study Buddy. I can help you with study plans, notes, flashcards, and answer your questions. How can I assist you today?", 'buddy-message');
                }, 500);

                safeLog('Model loaded successfully');
            } catch (err) {
                console.error('Error while processing loaded model', err);
                loadingIndicator.textContent = 'Model error';
            }
        },
        (xhr) => {
            if (xhr && xhr.total) {
                loadingIndicator.textContent = `Loading Buddy: ${Math.round(xhr.loaded / xhr.total * 100)}%`;
            }
        },
        (err) => {
            console.error('GLTF load error', err);
            loadingIndicator.textContent = 'Error loading Buddy (check URL/CORS)';
        }
    );
}

function animate() {
    requestAnimationFrame(animate);
    try {
        const delta = clock ? clock.getDelta() : 0.016;
        if (mixer) mixer.update(delta);
        if (controls) controls.update();
        if (renderer && scene && camera) renderer.render(scene, camera);
    } catch (err) {
        console.error('Render loop error', err);
    }
}

function playAnimation(nextAction, duration = 0.2) {
    if (currentAction === nextAction) return;
    if (currentAction) currentAction.fadeOut(duration);
    if (nextAction) {
        nextAction.reset().setEffectiveWeight(1).setEffectiveTimeScale(1).fadeIn(duration).play();
        currentAction = nextAction;
    }
}

/* ---------------- Buddy State ---------------- */
function setBuddyState(state, intensity = 1) {
    const colors = getColors();
    let color = colors.listening;
    if (state === 'thinking') { color = colors.thinking; intensity = 8; }
    else if (state === 'speaking') { color = colors.speaking; intensity = 10; if (window.talkAction) playAnimation(window.talkAction); }
    else if (state === 'listening') { color = colors.listening; intensity = 5; if (window.idleAction && currentAction !== window.idleAction) playAnimation(window.idleAction); }
    if (window.spotlight) {
        try { window.spotlight.color.set(color); window.spotlight.intensity = intensity; } catch(e){ /* ignore */ }
    }
}

/* ---------------- TTS (uses your server endpoint) ---------------- */
async function ttsAndAnimate(text){
    if(!text) return new Promise(res => setTimeout(res, 300));
    try {
        const resp = await fetch('/api/tts', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ text })
        });
        if(!resp.ok) throw new Error(`TTS failed ${resp.status}`);
        const data = await resp.json();
        if(!data.audioData) {
            console.warn('TTS returned no audioData, falling back to speechSynthesis');
            const utter = new SpeechSynthesisUtterance(text);
            speechSynthesis.speak(utter);
            return new Promise(res => {
                utter.onend = res;
                setTimeout(res, 4000);
            });
        }
        const pcmBuffer = base64ToArrayBuffer(data.audioData);
        const pcm16 = new Int16Array(pcmBuffer);
        const rateMatch = data.mimeType?.match(/rate=(\d+)/);
        const sampleRate = rateMatch ? parseInt(rateMatch[1]) : 24000;
        const wavBlob = pcmToWav(pcm16, sampleRate);
        const audio = new Audio(URL.createObjectURL(wavBlob));

        setBuddyState('speaking');
        return new Promise(resolve => {
            audio.onended = () => { setBuddyState('listening'); resolve(); };
            audio.onerror = () => { setBuddyState('listening'); resolve(); };
            audio.play().catch(err => { console.error('Audio play error', err); setBuddyState('listening'); resolve(); });
        });
    } catch (err) {
        console.error('TTS fetch error', err);
        // fallback to browser TTS
        try {
            const utter = new SpeechSynthesisUtterance(text);
            speechSynthesis.speak(utter);
            return new Promise(res => {
                utter.onend = res;
                setTimeout(res, 4000);
            });
        } catch (e) {
            return new Promise(res => setTimeout(res, 1000));
        }
    }
}

/* ---------------- Chat Helpers ---------------- */
function appendMessage(text, type){
    if(!chatWindow) return;
    const div = document.createElement('div');
    div.classList.add('chat-message', type);
    div.textContent = text;
    chatWindow.appendChild(div);
    chatWindow.scrollTop = chatWindow.scrollHeight;
    return div;
}

async function sendMessage(messageInput = null){
    const message = (typeof messageInput === 'string' && messageInput.length) ? messageInput : (chatInput?.value || '').trim();
    if(!message) return;

    appendMessage(message, 'user-message');
    if (chatInput) { chatInput.value = ''; chatInput.disabled = true; }
    if (sendButton) { sendButton.disabled = true; }

    setBuddyState('thinking');
    const buddyMsg = appendMessage('Thinking...', 'buddy-message');

    try {
        const res = await fetch('/api/chat', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ message })
        });
        if(!res.ok) {
            const text = await res.text().catch(()=>null);
            throw new Error('Chat API error: ' + res.status + ' ' + text);
        }
        const data = await res.json().catch(() => ({ response: "Sorry, I couldn't parse the reply." }));
        const aiResp = data.response || data.reply || "Hmm, I can't answer that right now.";
        buddyMsg.textContent = aiResp;

        await processAIResponse(aiResp);
        // Use server TTS fallback; if that fails, ttsAndAnimate falls back to browser TTS.
        await ttsAndAnimate(aiResp);
    } catch (err) {
        console.error('sendMessage error', err);
        buddyMsg.textContent = "Oops! Something went wrong. Please try again.";
    } finally {
        if (chatInput) { chatInput.disabled = false; chatInput.focus(); }
        if (sendButton) { sendButton.disabled = false; }
        chatWindow.scrollTop = chatWindow.scrollHeight;
        if (currentMode === 'companion' && recognition && !isRecognizing) {
            // restart recognition for companion mode
            try { recognition.start(); } catch(e) {}
        }
    }
}

/* ---------------- Companion Mode (Speech Recognition) ---------------- */
function setupRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        safeLog('SpeechRecognition not supported in this browser');
        return null;
    }
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
        isRecognizing = true;
        setBuddyState('listening');
        safeLog('Recognition started');
    };

    recognition.onresult = (event) => {
        try {
            const transcript = event.results[0][0].transcript;
            safeLog('Recognized:', transcript);
            appendMessage(transcript, 'user-message');
            // send to AI pipeline
            sendMessage(transcript);
        } catch (e) {
            console.error('onresult error', e);
        }
    };

    recognition.onerror = (ev) => {
        console.warn('Recognition error', ev.error);
        isRecognizing = false;
    };

    recognition.onend = () => {
        isRecognizing = false;
        safeLog('Recognition ended');
        // auto-restart if still in companion mode
        if (currentMode === 'companion') {
            try {
                recognition.start();
            } catch (e) {
                console.warn('Failed to restart recognition', e);
            }
        }
    };

    return recognition;
}

/* ---------------- Mode UI (create if missing) ---------------- */
function ensureModeButtons() {
    // if HTML already contains buttons with these ids, use them; otherwise create small UI
    chatModeBtn = document.getElementById('chat-mode-btn');
    companionModeBtn = document.getElementById('companion-mode-btn');

    if (!chatModeBtn || !companionModeBtn) {
        // create a minimal mode control at bottom of buddyAnimationContainer
        const container = document.createElement('div');
        container.style.position = 'absolute';
        container.style.bottom = '18px';
        container.style.left = '50%';
        container.style.transform = 'translateX(-50%)';
        container.style.display = 'flex';
        container.style.gap = '8px';
        container.style.zIndex = 20;

        const a = document.createElement('button');
        a.id = 'chat-mode-btn';
        a.className = 'mode-btn active';
        a.textContent = 'Chat Mode';
        const b = document.createElement('button');
        b.id = 'companion-mode-btn';
        b.className = 'mode-btn';
        b.textContent = 'Companion Mode';

        container.appendChild(a);
        container.appendChild(b);
        buddyAnimationContainer.style.position = buddyAnimationContainer.style.position || 'relative';
        buddyAnimationContainer.appendChild(container);

        chatModeBtn = a;
        companionModeBtn = b;
    }

    chatModeBtn.addEventListener('click', () => {
        currentMode = 'chat';
        chatModeBtn.classList.add('active');
        companionModeBtn.classList.remove('active');
        appendMessage('Switched to Chat Mode.', 'system-message');
        if (recognition && isRecognizing) {
            try { recognition.stop(); } catch(e){/*ignore*/ }
        }
    });

    companionModeBtn.addEventListener('click', () => {
        currentMode = 'companion';
        companionModeBtn.classList.add('active');
        chatModeBtn.classList.remove('active');
        appendMessage('Companion Mode activated — speak now.', 'system-message');
        if (!recognition) setupRecognition();
        try {
            if (recognition && !isRecognizing) recognition.start();
        } catch (e) { console.warn('Recognition start failed', e); }
    });
}

/* ---------------- Process AI Response (emotion mapping) ---------------- */
async function processAIResponse(message) {
    const lowerMsg = (message || '').toLowerCase();
    if (lowerMsg.includes('great') || lowerMsg.includes('excellent') || lowerMsg.includes('awesome')) {
        setBuddyState('speaking', 1.5);
    } else if (lowerMsg.includes('?') || lowerMsg.includes('explain') || lowerMsg.includes('what is')) {
        setBuddyState('thinking');
    } else {
        setBuddyState('speaking');
    }
}

/* ---------------- Initialization ---------------- */
async function initializeApp() {
    // query DOM
    chatWindow = document.getElementById('chat-window');
    chatInput = document.getElementById('chat-input');
    sendButton = document.getElementById('send-button');
    buddyAnimationContainer = document.getElementById('buddy-animation');
    loadingIndicator = document.getElementById('loading-indicator');

    if (!buddyAnimationContainer) {
        console.error('Missing #buddy-animation element in DOM');
        return;
    }
    // ensure chat window exists
    if (!chatWindow) {
        console.warn('Missing #chat-window; creating fallback');
        chatWindow = document.createElement('div');
        chatWindow.id = 'chat-window';
        document.body.appendChild(chatWindow);
    }
    // ensure basic controls exist
    if (!chatInput || !sendButton) {
        safeLog('Chat input or send button missing — chat input will not be usable until present');
    }

    // initialize THREE
    initThreeJS();
    loadModel();
    animate();

    // mode UI
    ensureModeButtons();

    // hook send button / input if available
    if (sendButton) sendButton.addEventListener('click', () => sendMessage());
    if (chatInput) chatInput.addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

    // enable inputs after short delay (safe)
    setTimeout(() => {
        if (chatInput) chatInput.disabled = false;
        if (sendButton) sendButton.disabled = false;
    }, 1200);

    safeLog('App initialized — waiting for model and backend.');
}

// Run initializer after DOM ready
document.addEventListener('DOMContentLoaded', () => {
    initializeApp().catch(err => console.error('InitializeApp error', err));
});
