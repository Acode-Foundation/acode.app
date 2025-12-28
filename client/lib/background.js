class Particle {
  /** * @param {HTMLCanvasElement} canvas
   * @param {HTMLCanvasElement} canvas
   * @param {number} radius
   * @param {number} x
   * @param {number} y
   * @param {number} dx
   * @param {number} dy
   * @param {string} color
   */
  constructor(canvas, radius, x, y, dx, dy, color) {
    this.radius = radius;
    this.x = x;
    this.y = y;
    this.dx = dx;
    this.dy = dy;
    this.color = color;
    this.canvas = canvas;
  }

  draw(ctx) {
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
    ctx.fillStyle = this.color;
    ctx.fill();
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

    for (let i = 0; i < numParticles; ++i) {
      const r = Math.random() * 3 + 1;
      const x = Math.random() * (canvas.width - r) + r;
      const y = Math.random() * (canvas.height - r) + r;
      const dx = (Math.random() > 0.5 ? 1 : -1) * Math.random() * 1.5;
      const dy = (Math.random() > 0.5 ? 1 : -1) * Math.random() * 1.5;

      particles.push(new Particle(canvas, r, x, y, dx, dy, '#606060'));
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

        if (distance < 100) {
          ctx.beginPath();
          ctx.strokeStyle = '#606060';
          ctx.lineWidth = 1;
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      }
    }
  }
}
