class Particle {
  /** * @param {HTMLCanvasElement} canvas
   * @param {HTMLCanvasElement} canvas
   * @param {number} radius
   * @param {number} x
   * @param {number} y
   * @param {number} dx
   * @param {number} dy
   * @param {string} color
   * @param {number} opacity
   */
  constructor(canvas, radius, x, y, dx, dy, color, opacity) {
    this.radius = radius;
    this.x = x;
    this.y = y;
    this.dx = dx;
    this.dy = dy;
    this.color = color;
    this.opacity = opacity;
    this.canvas = canvas;
  }

  draw(ctx) {
    // Draw glow effect
    const gradient = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.radius * 3);
    gradient.addColorStop(0, this.color);
    gradient.addColorStop(0.5, `${this.color}40`); // Add transparency to hex
    gradient.addColorStop(1, `${this.color}00`);

    ctx.globalAlpha = this.opacity * 0.3;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius * 3, 0, 2 * Math.PI);
    ctx.fill();

    // Draw main particle
    ctx.globalAlpha = this.opacity;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  update() {
    if (this.x < this.radius || this.x > this.canvas.width - this.radius) {
      this.dx *= -1;
    }

    if (this.y < this.radius || this.y > this.canvas.height - this.radius) {
      this.dy *= -1;
    }

    this.x += this.dx;
    this.y += this.dy;
  }
}

/**
 * Initializes the background animation with particles and connections.
 * @param {HTMLCanvasElement} canvas
 */
export default function background(canvas) {
  canvas.width = window.innerWidth * 2;
  canvas.height = window.innerHeight * 2;

  const ctx = canvas.getContext('2d');

  let particles = null;
  let reqId = null;
  let wasConnected = false;

  init();

  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth * 2;
    canvas.height = window.innerHeight * 2;

    init();
  });

  function init() {
    const numParticles = Math.min(150, Math.round((canvas.width * canvas.height) / 9500));

    particles = [];

    // Dramatic color palette: electric blues, cyans, and deep purples
    const colors = [
      '#00d4ff', // Electric cyan
      '#0099ff', // Bright blue
      '#3366ff', // Deep blue
      '#6b5bff', // Purple-blue
      '#00ffcc', // Aqua
      '#1a8fff', // Ocean blue
    ];

    for (let i = 0; i < numParticles; ++i) {
      const r = Math.random() * 2.5 + 1.5; // Slightly larger particles
      const x = Math.random() * (canvas.width - r) + r;
      const y = Math.random() * (canvas.height - r) + r;
      const dx = (Math.random() > 0.5 ? 1 : -1) * Math.random() * 1.2;
      const dy = (Math.random() > 0.5 ? 1 : -1) * Math.random() * 1.2;
      const color = colors[Math.floor(Math.random() * colors.length)];
      const opacity = Math.random() * 0.5 + 0.4; // 0.4 to 0.9 - more visible

      particles.push(new Particle(canvas, r, x, y, dx, dy, color, opacity));
    }

    if (reqId != null) cancelAnimationFrame(reqId);

    animate();
  }

  function animate() {
    if (wasConnected && !canvas.isConnected) {
      particles = null;
      cancelAnimationFrame(reqId);
      return;
    }

    wasConnected = canvas.isConnected;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const p of particles) {
      p.draw(ctx);
      p.update();
    }

    connect();
    reqId = requestAnimationFrame(animate);
  }

  function connect() {
    for (const p1 of particles) {
      for (const p2 of particles) {
        const distance = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);

        if (distance < 140) {
          // Create gradient line from p1 to p2
          const gradient = ctx.createLinearGradient(p1.x, p1.y, p2.x, p2.y);
          gradient.addColorStop(0, p1.color);
          gradient.addColorStop(0.5, '#00aaff'); // Electric blue middle
          gradient.addColorStop(1, p2.color);

          ctx.strokeStyle = gradient;
          // More visible connections with better opacity curve
          const opacityFactor = 1 - distance / 140;
          ctx.globalAlpha = opacityFactor * opacityFactor * 0.5; // Quadratic falloff
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }
  }
}
