/* ULTIMATE NEON RUNNER 3D 
   Powered by Three.js & Post-Processing
*/

// Importation dynamique des modules Three.js (via CDN pour fonctionnement immédiat)
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { EffectComposer } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/ShaderPass.js';

// --- CONFIGURATION & CONSTANTES ---
const CONFIG = {
    gravity: 0.6, // Gravité légèrement ajustée pour la 3D
    jumpForce: 0.85,
    speed: 0.8,
    maxSpeed: 2.2,
    acceleration: 0.0005,
    coyoteTime: 150,
    jumpBuffer: 150,
    laneWidth: 0, // Pour l'instant on reste sur une ligne, extensible plus tard
    colors: {
        background: 0x050505,
        player: 0x00ffff,
        obstacle: 0xff0055,
        ground: 0x220033,
        grid: 0xff00ff,
        bonus: 0xffd700
    }
};

// --- DOM ELEMENTS ---
const scoreVal = document.getElementById('score-val');
const highScoreVal = document.getElementById('high-score-val');
const startScreen = document.getElementById('start-screen');
const deathScreen = document.getElementById('death-screen');
const finalScore = document.getElementById('final-score');
// On ignore canvas 2d, three.js va créer son propre canvas ou utiliser l'existant en WebGL

// --- VARIABLES GLOBALES ---
let scene, camera, renderer, composer;
let player, floor, gridHelper;
let obstacles = [];
let particles = [];
let bonuses = [];
let gameState = 'START';
let score = 0;
let highScore = localStorage.getItem('neon_3d_highscore') || 0;
let runTime = 0;
let speed = CONFIG.speed;

// Variables Physique
let velocityY = 0;
let isGrounded = true;
let canDoubleJump = true;
let lastGroundedTime = 0;
let lastJumpRequestTime = 0;
let cameraShake = 0;

highScoreVal.textContent = Math.floor(highScore);

// --- INITIALISATION DU MOTEUR 3D ---
function initEngine() {
    const container = document.body;
    
    // 1. Scène & Caméra
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.background);
    scene.fog = new THREE.FogExp2(CONFIG.colors.background, 0.02); // Brouillard pour cacher l'apparition des objets

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(-8, 5, 8); // Vue de côté/arrière dynamique
    camera.lookAt(0, 2, 0);

    // 2. Renderer
    const existingCanvas = document.getElementById('gameCanvas');
    renderer = new THREE.WebGLRenderer({ 
        canvas: existingCanvas || undefined, 
        antialias: false, // Désactivé pour perf, le bloom compense
        powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    if(!existingCanvas) document.body.appendChild(renderer.domElement);

    // 3. Lumières
    const ambientLight = new THREE.AmbientLight(0x404040, 2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 2);
    dirLight.position.set(-10, 20, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // 4. Post-Processing (Le secret du look "Game of the Year")
    composer = new EffectComposer(renderer);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    // Bloom (Lueur Néon)
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.1;
    bloomPass.strength = 2.0; // Intensité du néon
    bloomPass.radius = 0.5;
    composer.addPass(bloomPass);

    // 5. Création du Monde
    createWorld();
    createPlayer();

    // Event Listeners
    window.addEventListener('resize', onWindowResize);
    window.addEventListener('keydown', handleInput);
    window.addEventListener('touchstart', () => handleInput({code: 'Space'}), {passive: false});
    window.addEventListener('mousedown', () => handleInput({code: 'Space'}));

    // Loop
    requestAnimationFrame(animate);
}

function createWorld() {
    // Sol infini (illusion)
    const geometry = new THREE.PlaneGeometry(200, 200);
    const material = new THREE.MeshStandardMaterial({ 
        color: CONFIG.colors.ground, 
        roughness: 0.1, 
        metalness: 0.8 
    });
    floor = new THREE.Mesh(geometry, material);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -1; // Juste sous le joueur
    scene.add(floor);

    // Grille Néon Mouvante
    gridHelper = new THREE.GridHelper(200, 100, CONFIG.colors.grid, CONFIG.colors.grid);
    gridHelper.position.y = -0.9;
    scene.add(gridHelper);
}

function createPlayer() {
    // Le joueur est un Cube émissif
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial({ 
        color: CONFIG.colors.player,
        emissive: CONFIG.colors.player,
        emissiveIntensity: 2,
        roughness: 0.2,
        metalness: 0.8
    });
    player = new THREE.Mesh(geometry, material);
    player.position.y = 0;
    player.castShadow = true;
    scene.add(player);

    // Reset physics
    resetPlayer();
}

function resetPlayer() {
    if(!player) return;
    player.position.set(0, 0, 0);
    player.rotation.set(0, 0, 0);
    velocityY = 0;
    isGrounded = true;
    canDoubleJump = true;
    score = 0;
    speed = CONFIG.speed;
    
    // Nettoyage
    obstacles.forEach(o => scene.remove(o.mesh));
    obstacles = [];
    bonuses.forEach(b => scene.remove(b.mesh));
    bonuses = [];
    particles.forEach(p => scene.remove(p.mesh));
    particles = [];
}

// --- LOGIQUE DU JEU ---

function handleInput(e) {
    if (e.type === 'keydown' && e.code !== 'Space' && e.code !== 'ArrowUp') return;

    if (gameState === 'START' || gameState === 'DEAD') {
        startGame();
    } else if (gameState === 'PLAYING') {
        jump();
    }
}

function startGame() {
    gameState = 'PLAYING';
    startScreen.classList.add('hidden');
    deathScreen.classList.add('hidden');
    resetPlayer();
}

function jump() {
    const now = Date.now();
    const canCoyote = (now - lastGroundedTime) < CONFIG.coyoteTime;

    if (isGrounded || canCoyote) {
        velocityY = CONFIG.jumpForce;
        isGrounded = false;
        canDoubleJump = true;
        spawnParticles(player.position, 10, CONFIG.colors.player);
        cameraShake = 0.5;
    } else if (canDoubleJump) {
        velocityY = CONFIG.jumpForce * 0.9; // Double saut un peu plus faible
        canDoubleJump = false;
        spawnParticles(player.position, 15, 0xffffff); // Particules blanches
        
        // Effet visuel : Rotation rapide du cube
        const spinAnim = setInterval(() => {
            player.rotation.x -= 0.4;
            if(player.rotation.x < -Math.PI * 2) clearInterval(spinAnim);
        }, 16);
    } else {
        lastJumpRequestTime = now; // Buffer
    }
}

function spawnObstacle() {
    // Création d'obstacle aléatoire
    const isTall = Math.random() > 0.6;
    const geometry = new THREE.BoxGeometry(1, isTall ? 3 : 1.2, 1);
    const material = new THREE.MeshStandardMaterial({ 
        color: CONFIG.colors.obstacle,
        emissive: CONFIG.colors.obstacle,
        emissiveIntensity: 1.5
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    
    // Positionnement : Loin devant (Z positif)
    // Dans ce moteur, le joueur reste à Z=0, le monde avance vers lui (Z négatif)
    // OU le joueur avance (Z positif). Choisissons: Le joueur avance.
    
    const spawnZ = player.position.z + 60 + Math.random() * 20;
    mesh.position.set(0, isTall ? 1 : 0, spawnZ); 
    
    // Type Fly (Obstacle volant)
    if (!isTall && Math.random() > 0.7) {
        mesh.position.y = 2.5;
    }

    scene.add(mesh);
    obstacles.push({ mesh, passed: false });
}

function spawnParticles(pos, count, colorHex) {
    const geom = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    const mat = new THREE.MeshBasicMaterial({ color: colorHex });

    for(let i=0; i<count; i++) {
        const mesh = new THREE.Mesh(geom, mat);
        mesh.position.copy(pos);
        // Dispersion aléatoire
        mesh.position.x += (Math.random() - 0.5);
        mesh.position.y += (Math.random() - 0.5);
        
        const vel = new THREE.Vector3(
            (Math.random() - 0.5) * 0.3,
            (Math.random() - 0.5) * 0.3 + 0.2, // Tendance vers le haut
            (Math.random() - 0.5) * 0.3
        );
        
        scene.add(mesh);
        particles.push({ mesh, vel, life: 1.0 });
    }
}

function updatePhysics() {
    // 1. Gravité & Saut
    velocityY -= CONFIG.gravity * 0.05; // Ajustement pour 60fps
    player.position.y += velocityY;

    // Sol
    if (player.position.y <= 0) {
        player.position.y = 0;
        velocityY = 0;
        if (!isGrounded) {
            isGrounded = true;
            lastGroundedTime = Date.now();
            spawnParticles(player.position, 5, CONFIG.colors.player);
            // Jump Buffer Check
            if (Date.now() - lastJumpRequestTime < CONFIG.jumpBuffer) {
                jump();
            }
        }
    } else {
        isGrounded = false;
        // Légère rotation pendant le saut
        player.rotation.x -= 0.05;
    }

    // 2. Mouvement vers l'avant
    player.position.z += speed;
    
    // Accélération progressive
    if (speed < CONFIG.maxSpeed) speed += CONFIG.acceleration;

    // 3. Caméra Follow (Smooth)
    // La caméra suit le joueur en Z, mais avec un retard pour l'effet de vitesse
    const targetZ = player.position.z - 8;
    const targetY = player.position.y + 4;
    
    camera.position.z += (targetZ - camera.position.z) * 0.1;
    camera.position.y += (targetY - camera.position.y) * 0.1;
    
    // Camera Shake
    if (cameraShake > 0) {
        camera.position.x = -8 + (Math.random() - 0.5) * cameraShake;
        camera.position.y += (Math.random() - 0.5) * cameraShake;
        cameraShake *= 0.9;
    } else {
        camera.position.x += (-8 - camera.position.x) * 0.05; // Retour au centre
    }
    
    camera.lookAt(player.position.x, player.position.y + 1, player.position.z + 5);

    // 4. Endless World Logic
    // Déplace le sol et la grille pour qu'ils suivent le joueur
    floor.position.z = player.position.z;
    // Astuce pour la grille : on la déplace par pas pour donner l'illusion de mouvement infini
    const gridSize = 10; // taille d'une case
    gridHelper.position.z = Math.floor(player.position.z / gridSize) * gridSize;
}

function updateEntities() {
    // Gestion des obstacles
    // Spawn
    const lastObs = obstacles[obstacles.length - 1];
    if (!lastObs || (lastObs.mesh.position.z - player.position.z < 80)) {
        if(Math.random() > 0.05) spawnObstacle(); // Petite chance de vide
    }

    // Collision & Cleanup
    const playerBox = new THREE.Box3().setFromObject(player);
    // Réduire un peu la hitbox du joueur pour être gentil (plus fun)
    playerBox.expandByScalar(-0.2); 

    for (let i = obstacles.length - 1; i >= 0; i--) {
        const obs = obstacles[i];
        
        // Cleanup si derrière
        if (obs.mesh.position.z < player.position.z - 10) {
            scene.remove(obs.mesh);
            obstacles.splice(i, 1);
            continue;
        }

        // Collision Check
        const obsBox = new THREE.Box3().setFromObject(obs.mesh);
        if (playerBox.intersectsBox(obsBox)) {
            triggerDeath();
        }
    }

    // Particules
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= 0.02;
        p.mesh.position.add(p.vel);
        p.mesh.scale.setScalar(p.life);
        
        if (p.life <= 0) {
            scene.remove(p.mesh);
            particles.splice(i, 1);
        }
    }
}

function triggerDeath() {
    gameState = 'DEAD';
    cameraShake = 2.0;
    
    // Explosion finale
    spawnParticles(player.position, 50, CONFIG.colors.player);
    
    deathScreen.classList.remove('hidden');
    finalScore.textContent = `SCORE: ${Math.floor(score)}`;
    
    if (score > highScore) {
        highScore = Math.floor(score);
        localStorage.setItem('neon_3d_highscore', highScore);
        highScoreVal.textContent = highScore;
    }
}

function updateScore() {
    // Le score est basé sur la distance parcourue
    score = Math.floor(player.position.z);
    scoreVal.textContent = score;
}

function animate() {
    requestAnimationFrame(animate);

    if (gameState === 'PLAYING') {
        updatePhysics();
        updateEntities();
        updateScore();
    } else {
        // Animation Idle dans le menu (rotation caméra autour du joueur)
        if(player) {
            player.rotation.y += 0.01;
            player.rotation.x += 0.01;
        }
    }

    // Le rendu passe par le Composer (pour le Bloom) au lieu du Renderer direct
    composer.render();
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
}

// Lancement
initEngine();
