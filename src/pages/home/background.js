export default function background(canvas) {
  class Particle {
    constructor(radius, x, y, dx, dy, color) {
      this.radius = radius;
      this.x = x;
      this.y = y;
      this.dx = dx;
      this.dy = dy;
      this.color = color;
    }

    draw(ctx) {
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.radius, 0, 2 * Math.PI);
      ctx.fillStyle = this.color;
      ctx.fill();
    }

    update() {
      if (this.x < this.radius || this.x > canvas.width - this.radius) {
        this.dx *= -1;
      }

      if (this.y < this.radius || this.y > canvas.height - this.radius) {
        this.dy *= -1;
      }

      this.x += this.dx;
      this.y += this.dy;
    }
  }

  canvas.width = window.innerWidth * 2;
  canvas.height = window.innerHeight * 2;

  const ctx = canvas.getContext('2d');

  let particles = null;
  let reqId = null;

  init();

  window.addEventListener('resize', () => {
    canvas.width = window.innerWidth * 2;
    canvas.height = window.innerHeight * 2;

    init();
  });

  function init() {
    let numParticles = Math.min(
      150,
      Math.round((canvas.width * canvas.height) / 9500)
    );

    particles = [];

    for (let i = 0; i < numParticles; ++i) {
      let r = Math.random() * 3 + 1;
      let x = Math.random() * (canvas.width - r) + r;
      let y = Math.random() * (canvas.height - r) + r;
      let dx = (Math.random() > 0.5 ? 1 : -1) * Math.random() * 1.5;
      let dy = (Math.random() > 0.5 ? 1 : -1) * Math.random() * 1.5;

      particles.push(new Particle(r, x, y, dx, dy, '#606060'));
    }

    if (reqId != null) cancelAnimationFrame(reqId);

    animate();
  }

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (let p of particles) {
      p.draw(ctx);
      p.update();
    }

    connect();
    reqId = requestAnimationFrame(animate);
  }

  function connect() {
    for (let p1 of particles) {
      for (let p2 of particles) {
        let distance = Math.sqrt(
          Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
        );

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
