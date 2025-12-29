const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const scoreVal = document.getElementById('score-val');
const highScoreVal = document.getElementById('high-score-val');
const startScreen = document.getElementById('start-screen');
const deathScreen = document.getElementById('death-screen');
const finalScore = document.getElementById('final-score');

let width, height, lastTime;
let gameState = 'START';
let score = 0;
let highScore = localStorage.getItem('neon_high_score_v2') || 0;
highScoreVal.textContent = highScore;

const CONFIG = {
    gravity: 0.7,
    jumpForce: -15,
    speed: 8,
    maxSpeed: 22,
    acceleration: 0.001,
    coyoteTime: 120,
    jumpBuffer: 120,
    playerSize: 35,
    groundHeight: 120
};

class Particle {
    constructor(x, y, color, type = 'normal') {
        this.x = x;
        this.y = y;
        this.color = color;
        this.size = type === 'explosion' ? Math.random() * 6 + 2 : Math.random() * 3 + 1;
        const angle = Math.random() * Math.PI * 2;
        const force = type === 'explosion' ? Math.random() * 12 : Math.random() * 4;
        this.vx = Math.cos(angle) * force;
        this.vy = Math.sin(angle) * force;
        this.life = 1.0;
        this.decay = type === 'explosion' ? 0.015 : 0.03;
    }
    update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= this.decay;
        this.vy += 0.1;
    }
    draw() {
        ctx.globalAlpha = this.life;
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;
        ctx.fillStyle = this.color;
        ctx.fillRect(this.x, this.y, this.size, this.size);
        ctx.globalAlpha = 1;
    }
}

class Player {
    constructor() {
        this.reset();
    }
    reset() {
        this.x = 150;
        this.y = height - CONFIG.groundHeight - CONFIG.playerSize;
        this.vy = 0;
        this.isGrounded = true;
        this.canDoubleJump = true;
        this.lastGroundedTime = 0;
        this.lastJumpRequestTime = 0;
        this.particles = [];
        this.trail = [];
        this.shake = 0;
        this.rotation = 0;
    }
    jump() {
        const now = Date.now();
        const canCoyote = now - this.lastGroundedTime < CONFIG.coyoteTime;
        
        if (this.isGrounded || canCoyote) {
            this.vy = CONFIG.jumpForce;
            this.isGrounded = false;
            this.createJumpParticles('#00ffff');
            this.shake = 5;
        } else if (this.canDoubleJump) {
            this.vy = CONFIG.jumpForce * 0.85;
            this.canDoubleJump = false;
            this.createJumpParticles('#ff00ff');
            this.shake = 8;
        } else {
            this.lastJumpRequestTime = now;
        }
    }
    createJumpParticles(color) {
        for(let i=0; i<15; i++) this.particles.push(new Particle(this.x + CONFIG.playerSize/2, this.y + CONFIG.playerSize, color, 'explosion'));
    }
    update(dt) {
        this.vy += CONFIG.gravity;
        this.y += this.vy;

        const groundY = height - CONFIG.groundHeight - CONFIG.playerSize;
        if (this.y > groundY) {
            this.y = groundY;
            this.vy = 0;
            if (!this.isGrounded) {
                this.isGrounded = true;
                this.canDoubleJump = true;
                this.lastGroundedTime = Date.now();
                this.rotation = 0;
                if (Date.now() - this.lastJumpRequestTime < CONFIG.jumpBuffer) this.jump();
            }
        } else {
            this.isGrounded = false;
            this.rotation += 0.15;
        }

        this.trail.push({x: this.x, y: this.y, life: 1.0});
        if (this.trail.length > 15) this.trail.shift();
        this.trail.forEach(t => t.life -= 0.07);

        if (Math.random() > 0.3) {
            this.particles.push(new Particle(this.x, this.y + CONFIG.playerSize/2, '#00ffff'));
        }
        this.particles.forEach((p, i) => {
            p.update();
            if (p.life <= 0) this.particles.splice(i, 1);
        });

        if (this.shake > 0) this.shake *= 0.9;
    }
    draw() {
        this.trail.forEach(t => {
            ctx.globalAlpha = t.life * 0.3;
            ctx.fillStyle = '#00ffff';
            ctx.fillRect(t.x, t.y, CONFIG.playerSize, CONFIG.playerSize);
        });
        ctx.globalAlpha = 1;

        this.particles.forEach(p => p.draw());
        
        ctx.save();
        if (this.shake > 0.5) {
            ctx.translate((Math.random()-0.5)*this.shake, (Math.random()-0.5)*this.shake);
        }
        
        ctx.translate(this.x + CONFIG.playerSize/2, this.y + CONFIG.playerSize/2);
        ctx.rotate(this.rotation);
        
        ctx.shadowBlur = 25;
        ctx.shadowColor = '#00ffff';
        ctx.strokeStyle = '#00ffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(-CONFIG.playerSize/2, -CONFIG.playerSize/2, CONFIG.playerSize, CONFIG.playerSize);
        
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
        ctx.fillRect(-CONFIG.playerSize/2, -CONFIG.playerSize/2, CONFIG.playerSize, CONFIG.playerSize);
        ctx.restore();
    }
}

class Obstacle {
    constructor(x, type) {
        this.x = x;
        this.type = type;
        this.width = 40 + Math.random() * 50;
        this.height = type === 0 ? 50 + Math.random() * 80 : 40 + Math.random() * 40;
        this.y = type === 0 ? height - CONFIG.groundHeight - this.height : height - CONFIG.groundHeight - 160 - Math.random() * 120;
        this.color = '#ff00ff';
        this.pulse = 0;
    }
    update(speed) {
        this.x -= speed;
        this.pulse += 0.1;
    }
    draw() {
        const glow = 15 + Math.sin(this.pulse) * 10;
        ctx.shadowBlur = glow;
        ctx.shadowColor = this.color;
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 3;
        ctx.strokeRect(this.x, this.y, this.width, this.height);
        
        ctx.fillStyle = 'rgba(255, 0, 255, 0.15)';
        ctx.fillRect(this.x, this.y, this.width, this.height);
        
        ctx.beginPath();
        ctx.moveTo(this.x, this.y);
        ctx.lineTo(this.x + this.width, this.y + this.height);
        ctx.stroke();
    }
}

class Bonus {
    constructor(x) {
        this.x = x;
        this.y = height - CONFIG.groundHeight - 180 - Math.random() * 150;
        this.size = 25;
        this.collected = false;
        this.angle = 0;
    }
    update(speed) {
        this.x -= speed;
        this.angle += 0.15;
        this.y += Math.sin(this.angle) * 2;
    }
    draw() {
        if (this.collected) return;
        ctx.save();
        ctx.translate(this.x + this.size/2, this.y + this.size/2);
        ctx.rotate(this.angle);
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#ffd700';
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 3;
        ctx.strokeRect(-this.size/2, -this.size/2, this.size, this.size);
        ctx.strokeRect(-this.size/4, -this.size/4, this.size/2, this.size/2);
        ctx.restore();
    }
}

let player, obstacles, bonuses, currentSpeed, bgParticles = [];

function init() {
    resize();
    player = new Player();
    obstacles = [];
    bonuses = [];
    bgParticles = [];
    for(let i=0; i<50; i++) bgParticles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: Math.random() * 2,
        speed: Math.random() * 2 + 1
    });
    currentSpeed = CONFIG.speed;
    score = 0;
    scoreVal.textContent = '0';
}

function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
}

window.addEventListener('resize', resize);

function spawnManager() {
    const minGap = 400 - (currentSpeed * 10);
    if (obstacles.length === 0 || width - obstacles[obstacles.length-1].x > minGap + Math.random() * 400) {
        obstacles.push(new Obstacle(width + 100, Math.random() > 0.6 ? 1 : 0));
    }
    if (Math.random() < 0.008) {
        bonuses.push(new Bonus(width + 100));
    }
}

function checkCollision(rect1, rect2) {
    const padding = 5;
    return rect1.x + padding < rect2.x + rect2.width &&
           rect1.x + rect1.width - padding > rect2.x &&
           rect1.y + padding < rect2.y + rect2.height &&
           rect1.y + rect1.height - padding > rect2.y;
}

function gameOver() {
    gameState = 'DEAD';
    deathScreen.classList.remove('hidden');
    finalScore.textContent = `SCORE: ${Math.floor(score)}`;
    if (score > highScore) {
        highScore = Math.floor(score);
        localStorage.setItem('neon_high_score_v2', highScore);
        highScoreVal.textContent = highScore;
    }
}

function update(dt) {
    if (gameState !== 'PLAYING') return;

    currentSpeed = Math.min(CONFIG.maxSpeed, currentSpeed + CONFIG.acceleration * dt);
    score += currentSpeed * 0.05;
    scoreVal.textContent = Math.floor(score);

    player.update(dt);
    spawnManager();

    bgParticles.forEach(p => {
        p.x -= p.speed * (currentSpeed / 5);
        if (p.x < 0) p.x = width;
    });

    obstacles.forEach((obs, i) => {
        obs.update(currentSpeed);
        if (checkCollision({x: player.x, y: player.y, width: CONFIG.playerSize, height: CONFIG.playerSize}, obs)) {
            player.shake = 30;
            for(let j=0; j<40; j++) player.particles.push(new Particle(player.x, player.y, '#ff00ff', 'explosion'));
            setTimeout(gameOver, 100);
        }
        if (obs.x + obs.width < -100) obstacles.splice(i, 1);
    });

    bonuses.forEach((b, i) => {
        b.update(currentSpeed);
        if (!b.collected && checkCollision({x: player.x, y: player.y, width: CONFIG.playerSize, height: CONFIG.playerSize}, {x: b.x, y: b.y, width: b.size, height: b.size})) {
            b.collected = true;
            score += 1000;
            player.shake = 10;
            player.createJumpParticles('#ffd700');
        }
        if (b.x + b.size < -100) bonuses.splice(i, 1);
    });
}

function draw() {
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, width, height);

    // Background Stars
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    bgParticles.forEach(p => ctx.fillRect(p.x, p.y, p.size, p.size));

    // Ground Glow
    const gradient = ctx.createLinearGradient(0, height - CONFIG.groundHeight, 0, height);
    gradient.addColorStop(0, 'rgba(0, 255, 255, 0.3)');
    gradient.addColorStop(1, 'rgba(0, 255, 255, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, height - CONFIG.groundHeight, width, CONFIG.groundHeight);

    // Ground Line
    ctx.shadowBlur = 20;
    ctx.shadowColor = '#00ffff';
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(0, height - CONFIG.groundHeight);
    ctx.lineTo(width, height - CONFIG.groundHeight);
    ctx.stroke();

    // Scanlines
    ctx.fillStyle = 'rgba(18, 16, 16, 0.1)';
    for(let i=0; i<height; i+=4) ctx.fillRect(0, i, width, 1);

    obstacles.forEach(obs => obs.draw());
    bonuses.forEach(b => b.draw());
    player.draw();
}

function loop(timestamp) {
    if (!lastTime) lastTime = timestamp;
    const dt = Math.min(timestamp - lastTime, 32);
    lastTime = timestamp;

    update(dt);
    draw();
    requestAnimationFrame(loop);
}

function handleInput(e) {
    if (e && e.type === 'keydown' && e.code !== 'Space') return;
    
    if (gameState === 'START') {
        gameState = 'PLAYING';
        startScreen.classList.add('hidden');
        init();
    } else if (gameState === 'PLAYING') {
        player.jump();
    } else if (gameState === 'DEAD') {
        gameState = 'PLAYING';
        deathScreen.classList.add('hidden');
        init();
    }
}

window.addEventListener('keydown', handleInput);
window.addEventListener('touchstart', e => { 
    if (e.target.tagName !== 'BUTTON') {
        e.preventDefault(); 
        handleInput(); 
    }
}, {passive: false});
window.addEventListener('mousedown', handleInput);

init();
requestAnimationFrame(loop);
