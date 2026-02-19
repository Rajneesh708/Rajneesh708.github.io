/* ═══════════════════════════════════════════════════════════════════
   MECULS HOMEPAGE - CONSOLIDATED JAVASCRIPT
   homepage.js — Sections 1, 8, 9 + Blog carousel (Section 10)
   ═══════════════════════════════════════════════════════════════════ */


/* ═══════════════════════════════════════════════════════════════════
   SECTION 1 JS
   ═══════════════════════════════════════════════════════════════════ */

// ═══ SMOOTH SCROLL ═══
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const href = this.getAttribute('href');
        if (href === '#' || href === '') return;

        e.preventDefault();
        const target = document.querySelector(href);

        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// ═══ SCROLL INDICATOR FADE ═══
const scrollIndicator = document.querySelector('.scroll-indicator');

window.addEventListener('scroll', () => {
    if (scrollIndicator) {
        const scrolled = window.pageYOffset;
        const opacity = Math.max(0, 1 - (scrolled / 300));
        scrollIndicator.style.opacity = opacity;
    }
});

console.log('✅ MECULS Section 1 loaded successfully');


/* ═══════════════════════════════════════════════════════════════════
   SECTION 8 JS
   ═══════════════════════════════════════════════════════════════════ */

(function() {
    'use strict';

    // ===== CONFIGURATION =====
    const CONFIG_S8 = {
        observerOptions: {
            threshold: 0.15,
            rootMargin: '0px 0px -100px 0px'
        },
        parallaxIntensity: 0.3,
        hoverEffectRadius: 150
    };

    // ===== UTILITY FUNCTIONS =====
    const utils = {
        debounce(func, wait) {
            let timeout;
            return function executedFunction(...args) {
                const later = () => {
                    clearTimeout(timeout);
                    func(...args);
                };
                clearTimeout(timeout);
                timeout = setTimeout(later, wait);
            };
        },
        throttle(func, limit) {
            let inThrottle;
            return function(...args) {
                if (!inThrottle) {
                    func.apply(this, args);
                    inThrottle = true;
                    setTimeout(() => inThrottle = false, limit);
                }
            };
        }
    };

    // ===== INTERSECTION OBSERVER FOR ANIMATIONS =====
    const initScrollAnimations_S8 = () => {
        const cards = document.querySelectorAll('.context-card');
        const cta = document.querySelector('.section-cta');

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.animationPlayState = 'running';
                    observer.unobserve(entry.target);
                }
            });
        }, CONFIG_S8.observerOptions);

        cards.forEach(card => {
            card.style.animationPlayState = 'paused';
            observer.observe(card);
        });

        if (cta) {
            cta.style.animationPlayState = 'paused';
            observer.observe(cta);
        }
    };

    // ===== PARALLAX SCROLL EFFECT =====
    const initParallax_S8 = () => {
        const orbs = document.querySelectorAll('.gradient-orb');
        const radialAccent = document.querySelector('.radial-accent');
        let ticking = false;

        const updateParallax = (scrollY) => {
            orbs.forEach((orb, index) => {
                const speed = (index + 1) * CONFIG_S8.parallaxIntensity;
                const yPos = scrollY * speed;
                orb.style.transform = `translate3d(0, ${yPos}px, 0)`;
            });
            if (radialAccent) {
                const accentSpeed = scrollY * 0.15;
                radialAccent.style.transform = `translate(-50%, calc(-50% + ${accentSpeed}px))`;
            }
            ticking = false;
        };

        const requestTick = () => {
            if (!ticking) {
                window.requestAnimationFrame(() => {
                    updateParallax(window.scrollY);
                });
                ticking = true;
            }
        };

        window.addEventListener('scroll', requestTick, { passive: true });
    };

    // ===== 3D TILT EFFECT FOR CARDS =====
    const init3DTilt_S8 = () => {
        const cards = document.querySelectorAll('.context-card');

        cards.forEach(card => {
            let tiltTimeout;

            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                const rotateX = ((y - centerY) / centerY) * 4;
                const rotateY = ((centerX - x) / centerX) * 4;

                clearTimeout(tiltTimeout);
                card.style.transform = `
                    perspective(1000px)
                    rotateX(${rotateX}deg)
                    rotateY(${rotateY}deg)
                    translateY(-12px)
                    scale3d(1.02, 1.02, 1.02)
                `;
            });

            card.addEventListener('mouseleave', () => {
                tiltTimeout = setTimeout(() => {
                    card.style.transform = '';
                }, 100);
            });
        });
    };

    // ===== CARD CATEGORY FILTER =====
    const initCategoryFilter_S8 = () => {
        const cards = document.querySelectorAll('.context-card');
        cards.forEach(card => {
            const category = card.dataset.category;
            card.setAttribute('aria-label', `${category} context card`);
        });
    };

    // ===== DYNAMIC CARD GLOW EFFECT =====
    const initDynamicGlow_S8 = () => {
        const cards = document.querySelectorAll('.context-card');
        cards.forEach(card => {
            const glow = card.querySelector('.card-glow');
            if (!glow) return;

            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;
                glow.style.background = `
                    radial-gradient(
                        circle at ${x}% ${y}%,
                        rgba(212, 175, 55, 0.15) 0%,
                        transparent 50%
                    )
                `;
            });

            card.addEventListener('mouseleave', () => {
                glow.style.background = '';
            });
        });
    };

    // ===== SMOOTH SCROLL TO ANCHOR =====
    const initSmoothScroll_S8 = () => {
        const ctaButton = document.querySelector('.s8-cta');
        if (ctaButton && ctaButton.getAttribute('href') && ctaButton.getAttribute('href').startsWith('#')) {
            ctaButton.addEventListener('click', (e) => {
                const targetId = ctaButton.getAttribute('href').substring(1);
                const targetElement = document.getElementById(targetId);
                if (targetElement) {
                    e.preventDefault();
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        }
    };

    // ===== PROGRESSIVE IMAGE LOADING =====
    const initProgressiveLoading_S8 = () => {
        const images = document.querySelectorAll('img[loading="lazy"]');
        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.classList.add('loaded');
                        imageObserver.unobserve(img);
                    }
                });
            });
            images.forEach(img => imageObserver.observe(img));
        }
    };

    // ===== CARD INTERACTION TRACKING =====
    const initInteractionTracking_S8 = () => {
        const cards = document.querySelectorAll('.context-card');
        cards.forEach((card, index) => {
            card.addEventListener('click', () => {
                const category = card.dataset.category;
                console.log(`Card clicked: ${category} (Index: ${index + 1})`);
            });
        });
    };

    // ===== KEYBOARD NAVIGATION ENHANCEMENT =====
    const initKeyboardNav_S8 = () => {
        const cards = document.querySelectorAll('.context-card');
        const ctaButton = document.querySelector('.s8-cta');

        cards.forEach((card, index) => {
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'article');

            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    card.click();
                    card.style.transform = 'scale(0.98)';
                    setTimeout(() => { card.style.transform = ''; }, 150);
                }
                if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const nextCard = cards[index + 1] || cards[0];
                    nextCard.focus();
                }
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prevCard = cards[index - 1] || cards[cards.length - 1];
                    prevCard.focus();
                }
            });
        });

        if (ctaButton) {
            ctaButton.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    ctaButton.click();
                }
            });
        }
    };

    // ===== CARD NUMBER ANIMATION ON SCROLL =====
    const initCardNumberAnimation_S8 = () => {
        const cards = document.querySelectorAll('.context-card');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const number = entry.target.querySelector('.card-number');
                    if (number) {
                        number.style.animation = 'numberPulse 0.6s ease-out';
                    }
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.5 });
        cards.forEach(card => observer.observe(card));
    };

    // ===== ACCESSIBILITY ENHANCEMENTS =====
    const initAccessibility_S8 = () => {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') { document.body.classList.add('user-is-tabbing'); }
        });
        document.addEventListener('mousedown', () => {
            document.body.classList.remove('user-is-tabbing');
        });
        const cards = document.querySelectorAll('.context-card');
        cards.forEach((card, index) => {
            if (!card.getAttribute('aria-label')) {
                const title = card.querySelector('.card-title') ? card.querySelector('.card-title').textContent : `Card ${index + 1}`;
                card.setAttribute('aria-label', title);
            }
        });
    };

    // ===== RESPONSIVE LAYOUT ADJUSTMENTS =====
    const initResponsiveAdjustments_S8 = () => {
        const adjustLayout = () => {
            const width = window.innerWidth;
            const cards = document.querySelectorAll('.context-card');
            if (width < 768) {
                cards.forEach(card => { card.style.willChange = 'opacity, transform'; });
            } else {
                cards.forEach(card => { card.style.willChange = 'transform, box-shadow'; });
            }
        };
        adjustLayout();
        window.addEventListener('resize', utils.debounce(adjustLayout, 250));
    };

    // ===== INITIALIZE =====
    const initSection8 = () => {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initSection8);
            return;
        }
        initScrollAnimations_S8();
        initParallax_S8();
        init3DTilt_S8();
        initCategoryFilter_S8();
        initDynamicGlow_S8();
        initSmoothScroll_S8();
        initProgressiveLoading_S8();
        initInteractionTracking_S8();
        initKeyboardNav_S8();
        initCardNumberAnimation_S8();
        initAccessibility_S8();
        initResponsiveAdjustments_S8();
        console.log('✨ Section 8 (Where We Work) initialized successfully');
    };

    initSection8();

    // ===== DYNAMIC STYLES =====
    const s8Style = document.createElement('style');
    s8Style.textContent = `
        @keyframes numberPulse {
            0% { transform: scale(1); opacity: 0.15; }
            50% { transform: scale(1.2); opacity: 0.4; }
            100% { transform: scale(1); opacity: 0.15; }
        }
        .user-is-tabbing .context-card:focus,
        .user-is-tabbing .s8-cta:focus {
            outline: 3px solid #d4af37 !important;
            outline-offset: 4px;
        }
        @media (prefers-reduced-motion: reduce) {
            .context-card, .section-cta {
                animation: none !important;
                transition: none !important;
            }
        }
    `;
    document.head.appendChild(s8Style);

    window.MECULSSection8 = { version: '1.0.0', reinit: initSection8, config: CONFIG_S8 };

})();


/* ═══════════════════════════════════════════════════════════════════
   SECTION 9 JS
   ═══════════════════════════════════════════════════════════════════ */

(function() {
    'use strict';

    const CONFIG_S9 = {
        observerOptions: { threshold: 0.15, rootMargin: '0px 0px -100px 0px' },
        parallaxIntensity: 0.3,
        cursorEffectRadius: 150
    };

    // ===== INTERSECTION OBSERVER =====
    const observeCards_S9 = () => {
        const cards = document.querySelectorAll('.explore-card');
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.style.animationPlayState = 'running';
                    observer.unobserve(entry.target);
                }
            });
        }, CONFIG_S9.observerOptions);
        cards.forEach(card => {
            card.style.animationPlayState = 'paused';
            observer.observe(card);
        });
    };

    // ===== PARALLAX SCROLL =====
    const initParallax_S9 = () => {
        const orbs = document.querySelectorAll('.orb-1, .orb-2');
        let ticking = false;
        const updateParallax = (scrollY) => {
            orbs.forEach((orb, index) => {
                const speed = (index + 1) * CONFIG_S9.parallaxIntensity;
                const yPos = scrollY * speed;
                orb.style.transform = `translate3d(0, ${yPos}px, 0)`;
            });
            ticking = false;
        };
        window.addEventListener('scroll', () => {
            if (!ticking) {
                window.requestAnimationFrame(() => { updateParallax(window.scrollY); });
                ticking = true;
            }
        }, { passive: true });
    };

    // ===== 3D CARD TILT =====
    const init3DTilt_S9 = () => {
        const cards = document.querySelectorAll('.explore-card');
        cards.forEach(card => {
            const cardInner = card.querySelector('.card-inner');
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                const rotateX = ((y - centerY) / centerY) * 5;
                const rotateY = ((centerX - x) / centerX) * 5;
                cardInner.style.transform = `
                    perspective(1000px)
                    rotateX(${rotateX}deg)
                    rotateY(${rotateY}deg)
                    translateY(-12px)
                    scale3d(1.02, 1.02, 1.02)
                `;
            });
            card.addEventListener('mouseleave', () => {
                cardInner.style.transform = '';
            });
        });
    };

    // ===== MAGNETIC CURSOR EFFECT =====
    const initMagneticCursor_S9 = () => {
        const cards = document.querySelectorAll('.explore-card');
        cards.forEach(card => {
            const cardLink = card.querySelector('.card-link');
            if (!cardLink) return;
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const linkRect = cardLink.getBoundingClientRect();
                const linkX = linkRect.left - rect.left + linkRect.width / 2;
                const linkY = linkRect.top - rect.top + linkRect.height / 2;
                const distance = Math.hypot(x - linkX, y - linkY);
                if (distance < CONFIG_S9.cursorEffectRadius) {
                    const angle = Math.atan2(y - linkY, x - linkX);
                    const force = Math.max(0, 1 - distance / CONFIG_S9.cursorEffectRadius);
                    const offsetX = Math.cos(angle) * force * 10;
                    const offsetY = Math.sin(angle) * force * 10;
                    cardLink.style.transform = `translate(${-offsetX}px, ${-offsetY}px)`;
                } else {
                    cardLink.style.transform = '';
                }
            });
            card.addEventListener('mouseleave', () => {
                cardLink.style.transform = '';
            });
        });
    };

    // ===== SMOOTH SCROLL =====
    const initSmoothScroll_S9 = () => {
        const cards = document.querySelectorAll('.explore-card');
        cards.forEach(card => {
            card.addEventListener('click', (e) => {
                const cardTitle = card.querySelector('h3') ? card.querySelector('h3').textContent : '';
                console.log(`Navigating to: ${cardTitle}`);
                card.style.transform = 'scale(0.98)';
                setTimeout(() => { card.style.transform = ''; }, 150);
            });
        });
    };

    // ===== GRADIENT FOLLOW MOUSE =====
    const initGradientFollow_S9 = () => {
        const cards = document.querySelectorAll('.explore-card');
        cards.forEach(card => {
            const cardInner = card.querySelector('.card-inner');
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = ((e.clientX - rect.left) / rect.width) * 100;
                const y = ((e.clientY - rect.top) / rect.height) * 100;
                cardInner.style.setProperty('--mouse-x', `${x}%`);
                cardInner.style.setProperty('--mouse-y', `${y}%`);
                cardInner.style.background = `
                    radial-gradient(circle 300px at ${x}% ${y}%, rgba(212, 175, 55, 0.08), transparent),
                    linear-gradient(135deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.02) 100%)
                `;
            });
            card.addEventListener('mouseleave', () => {
                cardInner.style.background = '';
            });
        });
    };

    // ===== ACCESSIBILITY =====
    const initAccessibility_S9 = () => {
        const cards = document.querySelectorAll('.explore-card');
        cards.forEach((card, index) => {
            card.setAttribute('role', 'article');
            card.setAttribute('tabindex', '0');
            card.setAttribute('aria-label', `Explore card ${index + 1}`);
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    card.click();
                }
            });
        });
    };

    // ===== INITIALIZE =====
    const initSection9 = () => {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initSection9);
            return;
        }
        observeCards_S9();
        initParallax_S9();
        init3DTilt_S9();
        initMagneticCursor_S9();
        initSmoothScroll_S9();
        initGradientFollow_S9();
        initAccessibility_S9();
        console.log('✨ MECULS Section 9 initialized successfully');
    };

    initSection9();
    window.MECULSExplore = { version: '1.0.0', reinit: initSection9, config: CONFIG_S9 };

})();


/* ═══════════════════════════════════════════════════════════════════
   SECTION 10 JS - BLOG CAROUSEL
   ═══════════════════════════════════════════════════════════════════ */

(function() {
    'use strict';

    const initBlogCarousel = () => {
        const carousel = document.querySelector('.blog-carousel');
        const prevBtn = document.querySelector('.nav-arrow.prev');
        const nextBtn = document.querySelector('.nav-arrow.next');

        if (!carousel || !prevBtn || !nextBtn) return;

        const cardWidth = () => {
            const card = carousel.querySelector('.blog-card');
            if (!card) return 360;
            const gap = parseInt(window.getComputedStyle(carousel).gap) || 48;
            return card.offsetWidth + gap;
        };

        nextBtn.addEventListener('click', () => {
            carousel.scrollBy({ left: cardWidth(), behavior: 'smooth' });
        });

        prevBtn.addEventListener('click', () => {
            carousel.scrollBy({ left: -cardWidth(), behavior: 'smooth' });
        });

        console.log('✅ Section 10 (Blog Carousel) initialized successfully');
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBlogCarousel);
    } else {
        initBlogCarousel();
    }

})();
