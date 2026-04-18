/* ═══════════════════════════════════════════════════════════════════
   BESPOKE L&D COACHING PAGE — bespoke-coaching.js
═══════════════════════════════════════════════════════════════════ */

// Scroll reveal
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -60px 0px' });

document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach((el, i) => {
  // Stagger children of .stagger parents
  const parent = el.closest('.stagger');
  if (parent) {
    const siblings = [...parent.querySelectorAll('.reveal, .reveal-left, .reveal-right')];
    el.style.transitionDelay = (siblings.indexOf(el) * 0.12) + 's';
  }
  observer.observe(el);
});

// Animate transfer bars on scroll
const barObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      document.getElementById('barLow').style.width = '12%';
      document.getElementById('barHigh').style.width = '60%';
      barObserver.disconnect();
    }
  });
}, { threshold: 0.5 });

const barSection = document.querySelector('.transfer-stats');
if (barSection) barObserver.observe(barSection);

// Header shrink on scroll
const header = document.querySelector('.site-header');
window.addEventListener('scroll', () => {
  if (window.scrollY > 80) {
    header.style.padding = '12px 6vw';
  } else {
    header.style.padding = '20px 6vw';
  }
}, { passive: true });