/* NEON ODYSSEY: ULTIMATE GOTY EDITION
   Engine: Three.js r160
   Audio: WebAudio API (Procedural)
   Dev: AI Architect
*/

import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { EffectComposer } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/ShaderPass.js';

// --- CONFIGURATION ---
const CONFIG = {
    gravity: 0.65,
    jumpForce: 0.9,
    baseSpeed: 0.9,
    maxSpeed: 3.5,
    acceleration: 0.0003,
    coyoteTime: 150,
    jumpBuffer: 150,
    colors: {
        bg: 0x020205,
        playerDefault: 0x00ffff,
        playerGold: 0xffd700,
        playerMatrix: 0x00ff00,
        obstacle: 0xff0044,
        coin: 0xffd700,
        grid: 0x220044,
        building: 0x110022
    }
};

// --- ETAT DU JEU & SAUVEGARDE ---
const STATE = {
    score: 0,
    coins: parseInt(localStorage.getItem('neon_coins')) || 0,
    highScore: parseInt(localStorage.getItem('neon_highscore')) || 0,
    unlockedSkins: JSON.parse(localStorage.getItem('neon_skins')) || ['cyan'],
    currentSkin: localStorage.getItem('neon_equipped') || 'cyan',
    isPremium: localStorage.getItem('neon_premium') === 'true',
    isPlaying: false,
    speed: CONFIG.baseSpeed
};

// --- AUDIO ENGINE (Synthétiseur Procédural) ---
class SoundManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3;
        this.masterGain.connect(this.ctx.destination);
    }

    playTone(freq, type, duration, vol = 1) {
        if(this.ctx.state === 'suspended') this.ctx.resume();
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
        
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);

        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }

    playJump() {
        this.playTone(400, 'square', 0.1, 0.5);
        setTimeout(() => this.playTone(600, 'square', 0.2, 0.5), 50);
    }

    playCoin() {
        this.playTone(1200, 'sine', 0.1, 0.3);
        setTimeout(() => this.playTone(1800, 'sine', 0.3, 0.3), 80);
    }

    playCrash() {
        this.playTone(100, 'sawtooth', 0.5, 0.8);
        this.playTone(50, 'square', 0.8, 0.8);
    }

    playMusic() {
        // Musique d'ambiance basique (Drone)
        if(this.musicOsc) return;
        this.musicOsc = this.ctx.createOscillator();
        this.musicOsc.type = 'sawtooth';
        this.musicOsc.frequency.value = 50; // Basse
        this.musicGain = this.ctx.createGain();
        this.musicGain.gain.value = 0.05;
        
        // Filtre pour effet étouffé
        this.filter = this.ctx.createBiquadFilter();
        this.filter.type = 'lowpass';
        this.filter.frequency.value = 400;

        this.musicOsc.connect(this.filter);
        this.filter.connect(this.masterGain);
        this.musicOsc.start();
        
        // Modulation LFO
        setInterval(() => {
            if(STATE.isPlaying) {
                this.filter.frequency.rampToValueAtTime(800 + Math.random()*500, this.ctx.currentTime + 1);
            } else {
                this.filter.frequency.rampToValueAtTime(200, this.ctx.currentTime + 1);
            }
        }, 2000);
    }
}
const audio = new SoundManager();

// --- VARIABLES 3D ---
let scene, camera, renderer, composer;
let player, gridHelper, floor;
let obstacles = [];
let coins = [];
let buildings = []; // Ville décorative
let particles = [];

// Physique
let velocityY = 0;
let isGrounded = true;
let canDoubleJump = true;
let lastGroundedTime = 0;
let lastJumpRequestTime = 0;
let cameraShake = 0;

// DOM Cache
const dom = {
    score: document.getElementById('score-val'),
    coins: document.getElementById('coin-val'),
    highScore: document.getElementById('high-score-val'),
    startScreen: document.getElementById('start-screen'),
    deathScreen: document.getElementById('death-screen'),
    finalScore: document.getElementById('final-score'),
    finalCoins: document.getElementById('final-coins'),
    shopModal: document.getElementById('shop-modal'),
    paymentModal: document.getElementById('payment-modal')
};

// --- INITIALISATION ---
function init() {
    // 1. Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.bg);
    scene.fog = new THREE.FogExp2(CONFIG.colors.bg, 0.015);

    // 2. Camera
    camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(-6, 5, 8);

    // 3. Renderer
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.domElement.id = 'gameCanvas';
    document.body.appendChild(renderer.domElement);

    // 4. Lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 1);
    dirLight.position.set(-10, 20, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // 5. Post-Processing (Bloom + FilmGrain)
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloom.strength = 2.0;
    bloom.radius = 0.5;
    bloom.threshold = 0.1;
    composer.addPass(bloom);

    // 6. World Generation
    createWorld();
    createPlayer();

    // 7. Update UI
    updateCurrencyUI();

    // 8. Events
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', handleInput);
    document.addEventListener('touchstart', (e) => { 
        if(e.target.tagName !== 'BUTTON') { e.preventDefault(); handleInput({code:'Space'}); }
    }, {passive:false});

    // Boutons UI
    document.getElementById('btn-shop').onclick = openShop;
    document.getElementById('btn-premium').onclick = openPayment;
    document.getElementById('btn-menu').onclick = resetToMenu;
    document.getElementById('confirm-payment').onclick = processPayment;

    // Loop
    animate();
}

function createWorld() {
    // Sol Miroir
    const planeGeo = new THREE.PlaneGeometry(500, 500);
    const planeMat = new THREE.MeshStandardMaterial({ 
        color: 0x050011, 
        roughness: 0.1, 
        metalness: 0.8 
    });
    floor = new THREE.Mesh(planeGeo, planeMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1;
    scene.add(floor);

    // Grille
    gridHelper = new THREE.GridHelper(500, 100, CONFIG.colors.grid, 0x000000);
    gridHelper.position.y = -0.9;
    scene.add(gridHelper);

    // Ville Initiale
    for(let i=0; i<40; i++) {
        spawnBuilding(Math.random() * 200 - 50);
    }
}

function spawnBuilding(zPos) {
    const height = 10 + Math.random() * 40;
    const geo = new THREE.BoxGeometry(5 + Math.random()*10, height, 5 + Math.random()*10);
    const mat = new THREE.MeshStandardMaterial({ 
        color: CONFIG.colors.building, 
        emissive: Math.random()>0.8 ? 0x00ff00 : 0x000044, // Fenêtres
        emissiveIntensity: 0.5 
    });
    const mesh = new THREE.Mesh(geo, mat);
    
    // Positionner sur les côtés (hors piste)
    const xPos = (Math.random() > 0.5 ? 1 : -1) * (15 + Math.random() * 40);
    mesh.position.set(xPos, height/2 - 5, zPos);
    
    scene.add(mesh);
    buildings.push(mesh);
}

function createPlayer() {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    let color = CONFIG.colors.playerDefault;
    if(STATE.currentSkin === 'gold') color = CONFIG.colors.playerGold;
    if(STATE.currentSkin === 'matrix') color = CONFIG.colors.playerMatrix;

    const mat = new THREE.MeshStandardMaterial({ 
        color: color, 
        emissive: color, 
        emissiveIntensity: 2 
    });
    player = new THREE.Mesh(geo, mat);
    scene.add(player);
    resetPlayerPhysics();
}

function resetPlayerPhysics() {
    player.position.set(0, 0, 0);
    player.rotation.set(0,0,0);
    velocityY = 0;
    isGrounded = true;
    STATE.speed = CONFIG.baseSpeed;
    
    // Clean entities
    obstacles.forEach(o => scene.remove(o.mesh));
    obstacles = [];
    coins.forEach(c => scene.remove(c.mesh));
    coins = [];
}

// --- GAMEPLAY LOGIC ---

function handleInput(e) {
    if (e.code && e.code !== 'Space' && e.code !== 'ArrowUp') return;
    
    if (!STATE.isPlaying && dom.startScreen.classList.contains('hidden') === false) {
        startGame();
    } else if (STATE.isPlaying) {
        jump();
    } else if (!dom.deathScreen.classList.contains('hidden')) {
        startGame(); // Quick restart
    }
}

function startGame() {
    STATE.isPlaying = true;
    STATE.score = 0;
    
    audio.playMusic();
    dom.startScreen.classList.add('hidden');
    dom.deathScreen.classList.add('hidden');
    resetPlayerPhysics();
}

function jump() {
    const now = Date.now();
    if (isGrounded || (now - lastGroundedTime < CONFIG.coyoteTime)) {
        velocityY = CONFIG.jumpForce;
        isGrounded = false;
        canDoubleJump = true;
        cameraShake = 0.2;
        spawnParticles(player.position, 10, player.material.color);
        audio.playJump();
    } else if (canDoubleJump) {
        velocityY = CONFIG.jumpForce * 0.9;
        canDoubleJump = false;
        spawnParticles(player.position, 15, 0xffffff);
        audio.playJump();
        // Spin effect
        player.rotation.x = 0;
        const spin = setInterval(() => {
            player.rotation.x -= 0.4;
            if(player.rotation.x < -6.28) clearInterval(spin);
        }, 16);
    } else {
        lastJumpRequestTime = now;
    }
}

function updatePhysics() {
    // Gravity
    velocityY -= CONFIG.gravity * 0.05;
    player.position.y += velocityY;

    // Ground Collision
    if (player.position.y <= 0) {
        player.position.y = 0;
        velocityY = 0;
        if (!isGrounded) {
            isGrounded = true;
            lastGroundedTime = Date.now();
            spawnParticles(player.position, 5, player.material.color);
            if (Date.now() - lastJumpRequestTime < CONFIG.jumpBuffer) jump();
        }
    } else {
        isGrounded = false;
        player.rotation.x -= 0.05 * STATE.speed;
    }

    // Forward Movement
    STATE.speed = Math.min(CONFIG.maxSpeed, STATE.speed + CONFIG.acceleration);
    player.position.z += STATE.speed;

    // Camera Logic
    const targetZ = player.position.z - 8 - (STATE.speed * 2); // Dynamic Zoom
    camera.position.z += (targetZ - camera.position.z) * 0.1;
    camera.position.y += (5 - camera.position.y) * 0.1;
    
    // Camera Shake
    if(cameraShake > 0) {
        camera.position.x = -6 + (Math.random()-0.5)*cameraShake;
        camera.position.y += (Math.random()-0.5)*cameraShake;
        cameraShake *= 0.9;
    } else {
        camera.position.x += (-6 - camera.position.x)*0.05;
    }
    camera.lookAt(0, 1, player.position.z + 10);
}

function updateEntities() {
    // 1. Grid Infinite Loop
    gridHelper.position.z = Math.floor(player.position.z / 20) * 20;

    // 2. Obstacles Spawning
    if (obstacles.length < 6) {
        const zPos = player.position.z + 60 + Math.random() * 40;
        spawnObstacle(zPos);
    }

    // 3. Coins Spawning
    if (Math.random() < 0.05 && coins.length < 3) {
        const zPos = player.position.z + 60 + Math.random() * 20;
        spawnCoin(zPos);
    }

    // 4. Buildings Spawning
    const lastBuilding = buildings[buildings.length-1];
    if(lastBuilding.position.z < player.position.z + 200) {
        spawnBuilding(lastBuilding.position.z + 20 + Math.random()*20);
    }

    // 5. Cleanup & Collision
    const pBox = new THREE.Box3().setFromObject(player);
    pBox.expandByScalar(-0.2); // Hitbox plus clémente

    // Obstacles Loop
    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        if (obs.mesh.position.z < player.position.z - 10) {
            scene.remove(obs.mesh);
            obstacles.splice(i, 1);
            continue;
        }
        if (pBox.intersectsBox(new THREE.Box3().setFromObject(obs.mesh))) {
            gameOver();
        }
    }

    // Coins Loop
    for (let i = coins.length - 1; i >= 0; i--) {
        const coin = coins[i];
        coin.mesh.rotation.y += 0.05;
        if (coin.mesh.position.z < player.position.z - 10) {
            scene.remove(coin.mesh);
            coins.splice(i, 1);
            continue;
        }
        if (pBox.intersectsBox(new THREE.Box3().setFromObject(coin.mesh))) {
            collectCoin(coin, i);
        }
    }

    // Buildings Cleanup
    if(buildings.length > 50) {
        scene.remove(buildings[0]);
        buildings.shift();
    }
}

function spawnObstacle(z) {
    const isTall = Math.random() > 0.7;
    const isFly = !isTall && Math.random() > 0.7;
    const geo = new THREE.BoxGeometry(1, isTall?3:1.2, 1);
    const mat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.obstacle, emissive: CONFIG.colors.obstacle, emissiveIntensity: 2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, isFly?2.5:(isTall?1.5:0.6), z);
    scene.add(mesh);
    obstacles.push({mesh});
}

function spawnCoin(z) {
    const geo = new THREE.OctahedronGeometry(0.4);
    const mat = new THREE.MeshStandardMaterial({ color: CONFIG.colors.coin, emissive: CONFIG.colors.coin, emissiveIntensity: 1 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 1 + Math.sin(z)*0.5, z);
    scene.add(mesh);
    coins.push({mesh});
}

function spawnParticles(pos, count, color) {
    const geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const mat = new THREE.MeshBasicMaterial({ color: color });
    for(let i=0; i<count; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(pos);
        mesh.position.x += (Math.random()-0.5);
        scene.add(mesh);
        particles.push({
            mesh, 
            vel: new THREE.Vector3((Math.random()-0.5)*0.5, Math.random()*0.5, (Math.random()-0.5)*0.5),
            life: 1.0
        });
    }
}

function collectCoin(coin, index) {
    scene.remove(coin.mesh);
    coins.splice(index, 1);
    
    // Logic
    const gain = STATE.isPremium ? 10 : 1; // Bonus premium
    STATE.coins += gain;
    updateCurrencyUI();
    audio.playCoin();
    
    // Visual
    spawnParticles(player.position, 5, 0xffff00);
}

// --- GAME STATES ---

function gameOver() {
    STATE.isPlaying = false;
    audio.playCrash();
    cameraShake = 1.5;
    
    // Save
    localStorage.setItem('neon_coins', STATE.coins);
    if(STATE.score > STATE.highScore) {
        STATE.highScore = STATE.score;
        localStorage.setItem('neon_highscore', STATE.highScore);
    }

    // UI
    dom.finalScore.textContent = `SCORE: ${Math.floor(STATE.score)}`;
    dom.finalCoins.textContent = STATE.coins;
    dom.deathScreen.classList.remove('hidden');
}

function resetToMenu() {
    dom.deathScreen.classList.add('hidden');
    dom.startScreen.classList.remove('hidden');
    dom.highScore.textContent = STATE.highScore;
    resetPlayerPhysics();
}

// --- BOUTIQUE SYSTEM ---

window.openShop = function() {
    dom.startScreen.classList.add('hidden');
    dom.shopModal.classList.remove('hidden');
    updateShopUI();
}

window.openPayment = function() {
    dom.startScreen.classList.add('hidden');
    dom.paymentModal.classList.remove('hidden');
}

window.buySkin = function(skinName, price) {
    if (STATE.unlockedSkins.includes(skinName)) {
        // Equip
        STATE.currentSkin = skinName;
        localStorage.setItem('neon_equipped', skinName);
        updatePlayerSkin();
        updateShopUI();
    } else {
        // Buy
        if (STATE.coins >= price) {
            STATE.coins -= price;
            STATE.unlockedSkins.push(skinName);
            localStorage.setItem('neon_coins', STATE.coins);
            localStorage.setItem('neon_skins', JSON.stringify(STATE.unlockedSkins));
            updateCurrencyUI();
            updateShopUI();
            audio.playCoin(); // Success sound
        } else {
            alert("PAS ASSEZ DE COINS ! JOUE PLUS !");
        }
    }
}

function updateShopUI() {
    // Met à jour les boutons (Equip / Owned / Buy)
    const items = ['cyan', 'gold', 'matrix'];
    items.forEach(skin => {
        const btn = document.querySelector(`#skin-${skin} .buy-btn`);
        if(STATE.unlockedSkins.includes(skin)) {
            if(STATE.currentSkin === skin) {
                btn.textContent = "EQUIPPED";
                btn.className = "buy-btn owned";
            } else {
                btn.textContent = "EQUIP";
                btn.className = "buy-btn";
            }
        }
    });
}

function updatePlayerSkin() {
    scene.remove(player);
    createPlayer();
}

// --- PAIEMENT SIMULATION ---

window.processPayment = function() {
    const status = document.getElementById('payment-status');
    const btn = document.getElementById('confirm-payment');
    
    btn.disabled = true;
    status.textContent = "Connecting to Bank...";
    status.style.color = "#0ff";

    setTimeout(() => {
        status.textContent = "Verifying Transaction...";
    }, 1500);

    setTimeout(() => {
        status.textContent = "PAYMENT SUCCESSFUL !";
        status.style.color = "#0f0";
        
        // Unlock Premium
        STATE.isPremium = true;
        localStorage.setItem('neon_premium', 'true');
        STATE.coins += 5000; // Bonus cash
        STATE.unlockedSkins.push('gold');
        localStorage.setItem('neon_skins', JSON.stringify(STATE.unlockedSkins));
        updateCurrencyUI();
        
        audio.playCoin();
        audio.playCoin();
        
        setTimeout(() => {
            dom.paymentModal.classList.add('hidden');
            dom.startScreen.classList.remove('hidden');
            alert("THANK YOU! PREMIUM MODE UNLOCKED.\n+5000 COINS ADDED.");
        }, 1000);
    }, 3500);
}

function updateCurrencyUI() {
    dom.coins.textContent = STATE.coins;
    dom.highScore.textContent = STATE.highScore;
}

// --- LOOP ---

function animate() {
    requestAnimationFrame(animate);

    if (STATE.isPlaying) {
        updatePhysics();
        updateEntities();
        
        // Particles
        for (let i = particles.length - 1; i >= 0; i--) {
            let p = particles[i];
            p.life -= 0.03;
            p.mesh.position.add(p.vel);
            p.mesh.scale.setScalar(p.life);
            if(p.life <= 0) { scene.remove(p.mesh); particles.splice(i,1); }
        }

        // Score
        STATE.score = player.position.z;
        dom.score.textContent = Math.floor(STATE.score);
    } else {
        // Idle Animation in Menu
        if(player) {
            player.rotation.y += 0.01;
            player.rotation.z = Math.sin(Date.now()*0.001)*0.1;
        }
        if(floor) floor.position.z = (Date.now() * 0.01) % 20; // Scrolling floor preview
    }

    composer.render();
}

function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

init();
